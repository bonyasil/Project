/**
 * Роуты для работы с каталогом дисков.
 *
 * GET  /api/catalog/vse4-list          — список VSE4 с индикатором привязки каталога
 * GET  /api/catalog/search             — поиск в каталоге по maker+model+holes+color_code
 * GET  /api/catalog/disc/:id           — детали диска + фото из каталога
 * GET  /api/catalog/algorithms         — список алгоритмов подбора фото
 * POST /api/catalog/bind               — привязать диск каталога к строке VSE4 + загрузить фото в R2
 * DELETE /api/catalog/unbind/:vseId    — снять привязку
 */

import { Router } from 'express';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import { loadConfig } from '../../config/configManager.js';
import { uploadFile } from '../../utils/r2.js';
import { logger } from '../logger.js';

const router = Router();

function openDb(filePath, mode = sqlite3.OPEN_READONLY) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, mode, err => {
      if (err) return reject(new Error(`Ошибка открытия БД ${filePath}: ${err.message}`));
      resolve({
        all:   promisify(db.all.bind(db)),
        get:   promisify(db.get.bind(db)),
        run:   promisify(db.run.bind(db)),
        close: promisify(db.close.bind(db)),
      });
    });
  });
}

// ── GET /vse4-list ─────────────────────────────────────────────────────────────

router.get('/vse4-list', async (req, res) => {
  try {
    const config = await loadConfig();
    const { search = '', page = '1', limit = '50', linked } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const db = await openDb(config.dbPath, sqlite3.OPEN_READONLY);
    try {
      let where = '1=1';
      const params = [];

      if (search) {
        where += ' AND (ID LIKE ? OR name LIKE ? OR maker LIKE ? OR model LIKE ?)';
        const q = `%${search}%`;
        params.push(q, q, q, q);
      }
      if (linked === 'true')  { where += ' AND catalog_disc_id IS NOT NULL'; }
      if (linked === 'false') { where += ' AND catalog_disc_id IS NULL'; }

      const total = await db.get(`SELECT COUNT(*) as n FROM VSE4 WHERE ${where}`, params);
      const rows  = await db.all(
        `SELECT ID, name, maker, model, count_otv, color, color_code, catalog_disc_id, photo_algo_id, ImageUrls
         FROM VSE4 WHERE ${where}
         ORDER BY ID
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      );
      res.json({ total: total.n, rows });
    } finally {
      await db.close();
    }
  } catch (err) {
    logger.error('catalog/vse4-list error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /search ───────────────────────────────────────────────────────────────

router.get('/search', async (req, res) => {
  try {
    const config = await loadConfig();
    if (!config.catalogDbPath) return res.status(400).json({ error: 'CATALOG_DB_PATH не настроен' });

    const { maker = '', model = '', holes, color_code = '' } = req.query;

    const db = await openDb(config.catalogDbPath);
    try {
      const conditions = [];
      const params = [];

      if (maker) { conditions.push('LOWER(manufacturer) = LOWER(?)'); params.push(maker); }
      if (model) { conditions.push('LOWER(model) = LOWER(?)');        params.push(model); }
      if (holes) { conditions.push('holes = ?');                       params.push(parseInt(holes)); }
      if (color_code) { conditions.push('LOWER(color) = LOWER(?)');   params.push(color_code); }

      const where = conditions.length ? conditions.join(' AND ') : '1=1';

      const discs = await db.all(
        `SELECT id, article, articVse4, manufacturer, model, holes, color, createdAt
         FROM Disc WHERE ${where}
         ORDER BY manufacturer, model, color`,
        params
      );

      // Для каждого диска — одно превью фото (AVITO_MAIN)
      const result = await Promise.all(discs.map(async disc => {
        const photo = await db.get(
          `SELECT filePath, filename FROM Photo
           WHERE discId = ? AND category = 'AVITO_MAIN'
           ORDER BY sortOrder LIMIT 1`,
          [disc.id]
        );
        return {
          ...disc,
          previewUrl: photo ? `${config.catalogBaseUrl}${photo.filePath}` : null,
        };
      }));

      res.json(result);
    } finally {
      await db.close();
    }
  } catch (err) {
    logger.error('catalog/search error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /disc/:id ─────────────────────────────────────────────────────────────

router.get('/disc/:id', async (req, res) => {
  try {
    const config = await loadConfig();
    if (!config.catalogDbPath) return res.status(400).json({ error: 'CATALOG_DB_PATH не настроен' });

    const db = await openDb(config.catalogDbPath);
    try {
      const disc = await db.get(
        'SELECT id, article, articVse4, manufacturer, model, holes, color FROM Disc WHERE id = ?',
        [req.params.id]
      );
      if (!disc) return res.status(404).json({ error: 'Диск не найден' });

      const photos = await db.all(
        `SELECT id, category, subcategory, filePath, filename, sortOrder
         FROM Photo WHERE discId = ? ORDER BY category, sortOrder`,
        [disc.id]
      );

      res.json({
        ...disc,
        photos: photos.map(p => ({
          ...p,
          url: `${config.catalogBaseUrl}${p.filePath}`,
        })),
      });
    } finally {
      await db.close();
    }
  } catch (err) {
    logger.error('catalog/disc error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /algorithms ───────────────────────────────────────────────────────────

router.get('/algorithms', async (_req, res) => {
  try {
    const config = await loadConfig();
    const db = await openDb(config.dbPath);
    try {
      const algos = await db.all('SELECT * FROM photo_algorithm ORDER BY name');
      res.json(algos);
    } finally {
      await db.close();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /bind ────────────────────────────────────────────────────────────────

router.post('/bind', async (req, res) => {
  const { vseId, catalogDiscId, algoId } = req.body;

  if (!vseId || !catalogDiscId || !algoId) {
    return res.status(400).json({ error: 'vseId, catalogDiscId, algoId обязательны' });
  }

  try {
    const config = await loadConfig();

    // 1. Загрузить алгоритм
    const vse4Db = await openDb(config.dbPath, sqlite3.OPEN_READWRITE);
    const algo = await vse4Db.get('SELECT * FROM photo_algorithm WHERE id = ?', [algoId]);
    if (!algo) { await vse4Db.close(); return res.status(404).json({ error: 'Алгоритм не найден' }); }

    // 2. Получить фото из каталога по алгоритму
    const catDb = await openDb(config.catalogDbPath);
    const selectedPhotos = await selectPhotosByAlgorithm(catDb, catalogDiscId, algo);
    await catDb.close();

    if (selectedPhotos.length === 0) {
      await vse4Db.close();
      return res.status(422).json({ error: 'В каталоге нет фотографий для выбранного диска' });
    }

    // 3. Загрузить фото в R2
    const catalogPublicDir = path.join(config.catalogDbPath, '../../..', 'public');
    const uploadedUrls = [];

    for (const photo of selectedPhotos) {
      const localPath = path.resolve(catalogPublicDir, photo.filePath.replace(/^\//, ''));
      const key = `vse4/${vseId}/${photo.filename}`;
      try {
        const url = await uploadFile(config, localPath, key);
        uploadedUrls.push(url);
        logger.info('R2 upload ok', { key, url });
      } catch (uploadErr) {
        logger.error('R2 upload failed', { key, error: uploadErr.message });
        // Продолжаем с остальными фото
      }
    }

    if (uploadedUrls.length === 0) {
      await vse4Db.close();
      return res.status(500).json({ error: 'Не удалось загрузить ни одного фото в R2' });
    }

    // 4. Сохранить в VSE4
    const imageUrls = uploadedUrls.join(' | ');
    await vse4Db.run(
      'UPDATE VSE4 SET catalog_disc_id = ?, photo_algo_id = ?, ImageUrls = ? WHERE ID = ?',
      [catalogDiscId, algoId, imageUrls, vseId]
    );
    await vse4Db.close();

    logger.info('catalog/bind success', { vseId, catalogDiscId, algoId, photos: uploadedUrls.length });
    res.json({ success: true, vseId, catalogDiscId, algoId, photos: uploadedUrls.length, imageUrls });

  } catch (err) {
    logger.error('catalog/bind error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /unbind/:vseId ─────────────────────────────────────────────────────

router.delete('/unbind/:vseId', async (req, res) => {
  try {
    const config = await loadConfig();
    const db = await openDb(config.dbPath, sqlite3.OPEN_READWRITE);
    await db.run(
      'UPDATE VSE4 SET catalog_disc_id = NULL, photo_algo_id = NULL WHERE ID = ?',
      [req.params.vseId]
    );
    await db.close();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Вспомогательная: отбор фото по алгоритму ─────────────────────────────────

async function selectPhotosByAlgorithm(catDb, discId, algo) {
  const selected = [];

  const categoryMap = [
    { category: 'AVITO_MAIN',       count: algo.avito_main },
    { category: 'AVITO_EXTRA_MAIN', count: algo.avito_extra_main },
    { category: 'AVITO_EXTRA',      count: algo.avito_extra },
    { category: 'SITE',             count: algo.site },
  ];

  for (const { category, count } of categoryMap) {
    if (!count) continue;

    const photos = await catDb.all(
      `SELECT id, category, subcategory, filePath, filename
       FROM Photo WHERE discId = ? AND category = ?
       ORDER BY RANDOM()`,
      [discId, category]
    );

    selected.push(...photos.slice(0, count));
  }

  return selected;
}

export default router;
