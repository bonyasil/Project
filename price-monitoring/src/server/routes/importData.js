/**
 * API routes для импорта данных в локальную БД
 */

import express from 'express';
import path from 'path';
import { openDatabase } from '../../db/dbOperations.js';
import { loadConfig } from '../../config/configManager.js';
import { logger } from '../logger.js';

const router = express.Router();

async function getDbPath() {
  const config = await loadConfig();
  let dbPath = config.dbPath || './data/products.db';
  if (!path.isAbsolute(dbPath)) {
    dbPath = path.resolve(process.cwd(), dbPath);
  }
  return dbPath;
}

async function ensureAvitoIdColumn(db) {
  const cols = await db.all('PRAGMA table_info(VSE4)');
  if (!cols.some(c => c.name === 'avito_id')) {
    await db.run('ALTER TABLE VSE4 ADD COLUMN avito_id TEXT');
    logger.info('VSE4: avito_id column added');
  }
}

/**
 * POST /api/import/avito-id
 * Тело: { rows: [{ id: string, avitoId: string }] }
 */
router.post('/avito-id', async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows обязателен и не должен быть пустым' });
  }

  try {
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      await ensureAvitoIdColumn(db);

      // Получаем все существующие ID из VSE4
      const existingRows = await db.all('SELECT ID FROM VSE4');
      const existingIds = new Set(existingRows.map(r => String(r.ID)));

      const matching = rows.filter(r => r.id && existingIds.has(String(r.id)));
      const notFound = rows.length - matching.length;

      if (matching.length > 0) {
        await db.run('BEGIN TRANSACTION');
        for (const row of matching) {
          await db.run(
            'UPDATE VSE4 SET avito_id = ? WHERE ID = ?',
            [String(row.avitoId ?? ''), String(row.id)]
          );
        }
        await db.run('COMMIT');
      }

      logger.info('avito_id import done', { updated: matching.length, notFound });
      res.json({ success: true, updated: matching.length, notFound, total: rows.length });
    } catch (e) {
      await db.run('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      await db.close();
    }
  } catch (error) {
    logger.error('import/avito-id failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

async function ensureImageUrlsColumn(db) {
  const cols = await db.all('PRAGMA table_info(VSE4)');
  if (!cols.some(c => c.name === 'ImageUrls')) {
    await db.run('ALTER TABLE VSE4 ADD COLUMN ImageUrls TEXT');
    logger.info('VSE4: ImageUrls column added');
  }
}

/**
 * POST /api/import/image-urls
 * Тело: { rows: [{ id: string, imageUrls: string }] }
 */
router.post('/image-urls', async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows обязателен и не должен быть пустым' });
  }

  try {
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      await ensureImageUrlsColumn(db);

      const existingRows = await db.all('SELECT ID FROM VSE4');
      const existingIds = new Set(existingRows.map(r => String(r.ID)));

      const matching = rows.filter(r => r.id && existingIds.has(String(r.id)));
      const notFound = rows.length - matching.length;

      if (matching.length > 0) {
        await db.run('BEGIN TRANSACTION');
        for (const row of matching) {
          await db.run(
            'UPDATE VSE4 SET ImageUrls = ? WHERE ID = ?',
            [String(row.imageUrls ?? ''), String(row.id)]
          );
        }
        await db.run('COMMIT');
      }

      logger.info('ImageUrls import done', { updated: matching.length, notFound });
      res.json({ success: true, updated: matching.length, notFound, total: rows.length });
    } catch (e) {
      await db.run('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      await db.close();
    }
  } catch (error) {
    logger.error('import/image-urls failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

async function ensureTextAvitoColumn(db) {
  const cols = await db.all('PRAGMA table_info(VSE4)');
  if (!cols.some(c => c.name === 'text_avito')) {
    await db.run('ALTER TABLE VSE4 ADD COLUMN text_avito TEXT');
    logger.info('VSE4: text_avito column added');
  }
}

/**
 * POST /api/import/text
 * Тело: { rows: [{ id: string, description: string }] }
 */
router.post('/text', async (req, res) => {
  const { rows } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows обязателен и не должен быть пустым' });
  }

  try {
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      await ensureTextAvitoColumn(db);

      const existingRows = await db.all('SELECT ID FROM VSE4');
      const existingIds = new Set(existingRows.map(r => String(r.ID)));

      const matching = rows.filter(r => r.id && existingIds.has(String(r.id)));
      const notFound = rows.length - matching.length;

      if (matching.length > 0) {
        await db.run('BEGIN TRANSACTION');
        for (const row of matching) {
          await db.run(
            'UPDATE VSE4 SET text_avito = ? WHERE ID = ?',
            [String(row.description ?? ''), String(row.id)]
          );
        }
        await db.run('COMMIT');
      }

      logger.info('text_avito import done', { updated: matching.length, notFound });
      res.json({ success: true, updated: matching.length, notFound, total: rows.length });
    } catch (e) {
      await db.run('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      await db.close();
    }
  } catch (error) {
    logger.error('import/text failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/import/fix-decimals
 * Заменяет запятые на точки в столбцах centr_otv, diam_otv, width таблицы VSE4
 */
router.post('/fix-decimals', async (req, res) => {
  try {
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const cols = ['centr_otv', 'diam_otv', 'width'];
      const results = {};
      // Считаем строки с запятыми до обновления
      for (const col of cols) {
        const row = await db.get(
          `SELECT COUNT(*) as cnt FROM VSE4 WHERE CAST(${col} AS TEXT) LIKE '%,%'`
        );
        results[col] = row ? row.cnt : 0;
      }
      await db.run('BEGIN TRANSACTION');
      for (const col of cols) {
        await db.run(
          `UPDATE VSE4 SET ${col} = REPLACE(CAST(${col} AS TEXT), ',', '.') WHERE CAST(${col} AS TEXT) LIKE '%,%'`
        );
      }
      await db.run('COMMIT');
      logger.info('fix-decimals done', results);
      res.json({ success: true, results });
    } catch (e) {
      await db.run('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      await db.close();
    }
  } catch (error) {
    logger.error('fix-decimals failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/import/yd-image-urls
 * Заполняет ImageUrls из link_foto: заменяет указанный префикс на yandex_disk://, \ → /
 * Тело: { prefix: string, table: 'VSE4'|'baikal' }
 */
router.post('/yd-image-urls', async (req, res) => {
  const { prefix = '', table = 'VSE4' } = req.body;
  const targetTable = table === 'baikal' ? 'baikal' : 'VSE4';
  const idCol       = targetTable === 'baikal' ? 'id' : 'ID';

  try {
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      await ensureImageUrlsColumn(db);

      const rows = await db.all(
        `SELECT ${idCol} AS id, link_foto FROM ${targetTable}
         WHERE link_foto IS NOT NULL AND link_foto != ''
           AND (ImageUrls IS NULL OR ImageUrls = '')`
      );

      let updated = 0;
      for (const row of rows) {
        const imageUrls = row.link_foto
          .split('|')
          .map(p => {
            let s = prefix ? p.replace(prefix, 'yandex_disk://') : p;
            s = s.replaceAll('\\', '/');
            return s;
          })
          .join('|');

        await db.run(
          `UPDATE ${targetTable} SET ImageUrls = ? WHERE ${idCol} = ?`,
          [imageUrls, row.id]
        );
        updated++;
      }

      logger.info('yd-image-urls done', { table: targetTable, updated });
      res.json({ ok: true, updated });
    } finally {
      await db.close();
    }
  } catch (error) {
    logger.error('yd-image-urls failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/import/check-statuses
 * Тело: { ids: string[] } — список ID из файла Авито (активные объявления)
 * Возвращает: { removed: [{id, name}], notPublished: [{id, name}] }
 */
router.post('/check-statuses', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const placeholders = ids.map(() => '?').join(',');
      // Проверка 1: есть в файле авито, но в БД помечены как removed
      const removed = await db.all(
        `SELECT ID as id, name FROM VSE4 WHERE ID IN (${placeholders}) AND status_avito = 'removed'`,
        ids
      );
      // Проверка 2: в БД активные (не removed), но нет в файле авито
      const notPublished = await db.all(
        `SELECT ID as id, name FROM VSE4 WHERE (status_avito IS NULL OR status_avito != 'removed') AND ID NOT IN (${placeholders})`,
        ids
      );
      res.json({ removed, notPublished });
    } finally {
      await db.close();
    }
  } catch (error) {
    logger.error('check-statuses failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// BAIKAL endpoints — те же операции для таблицы baikal
// ============================================================================

async function ensureBaikalImageUrlsColumn(db) {
  const cols = await db.all('PRAGMA table_info(baikal)');
  if (!cols.some(c => c.name === 'ImageUrls')) {
    await db.run('ALTER TABLE baikal ADD COLUMN ImageUrls TEXT');
    logger.info('baikal: ImageUrls column added');
  }
}

/** Возвращает Set существующих id из таблицы baikal */
async function getBaikalExistingIds(db) {
  const rows = await db.all('SELECT id FROM baikal');
  return new Set(rows.map(r => String(r.id)));
}

/** POST /api/import/baikal/text — обновляет text_avito в таблице baikal */
router.post('/baikal/text', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows required' });
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const existingIds = await getBaikalExistingIds(db);
      const matching = rows.filter(r => r.id && existingIds.has(String(r.id)));
      const notFound = rows.length - matching.length;
      if (matching.length > 0) {
        await db.run('BEGIN TRANSACTION');
        for (const row of matching) {
          await db.run('UPDATE baikal SET text_avito = ? WHERE id = ?', [String(row.text ?? ''), String(row.id)]);
        }
        await db.run('COMMIT');
      }
      res.json({ success: true, updated: matching.length, notFound, total: rows.length });
    } catch (e) { await db.run('ROLLBACK').catch(() => {}); throw e; }
    finally { await db.close(); }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/import/baikal/image-urls — обновляет ImageUrls в таблице baikal */
router.post('/baikal/image-urls', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows required' });
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      await ensureBaikalImageUrlsColumn(db);
      const existingIds = await getBaikalExistingIds(db);
      const matching = rows.filter(r => r.id && existingIds.has(String(r.id)));
      const notFound = rows.length - matching.length;
      if (matching.length > 0) {
        await db.run('BEGIN TRANSACTION');
        for (const row of matching) {
          await db.run('UPDATE baikal SET ImageUrls = ? WHERE id = ?', [String(row.imageUrls ?? ''), String(row.id)]);
        }
        await db.run('COMMIT');
      }
      res.json({ success: true, updated: matching.length, notFound, total: rows.length });
    } catch (e) { await db.run('ROLLBACK').catch(() => {}); throw e; }
    finally { await db.close(); }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/import/baikal/fix-decimals — запятые → точки в centr_otv, diam_otv, width */
router.post('/baikal/fix-decimals', async (req, res) => {
  try {
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const cols = ['centr_otv', 'diam_otv', 'width'];
      const results = {};
      for (const col of cols) {
        const row = await db.get(`SELECT COUNT(*) as cnt FROM baikal WHERE CAST(${col} AS TEXT) LIKE '%,%'`);
        results[col] = row ? row.cnt : 0;
      }
      await db.run('BEGIN TRANSACTION');
      for (const col of cols) {
        await db.run(`UPDATE baikal SET ${col} = REPLACE(CAST(${col} AS TEXT), ',', '.') WHERE CAST(${col} AS TEXT) LIKE '%,%'`);
      }
      await db.run('COMMIT');
      res.json({ success: true, results });
    } catch (e) { await db.run('ROLLBACK').catch(() => {}); throw e; }
    finally { await db.close(); }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/import/baikal/avito-id — обновляет avito_id в таблице baikal */
router.post('/baikal/avito-id', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows required' });
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const existingIds = await getBaikalExistingIds(db);
      const matching = rows.filter(r => r.id && existingIds.has(String(r.id)));
      const notFound = rows.length - matching.length;
      if (matching.length > 0) {
        await db.run('BEGIN TRANSACTION');
        for (const row of matching) {
          await db.run('UPDATE baikal SET avito_id = ? WHERE id = ?', [String(row.avitoId ?? ''), String(row.id)]);
        }
        await db.run('COMMIT');
      }
      res.json({ success: true, updated: matching.length, notFound, total: rows.length });
    } catch (e) { await db.run('ROLLBACK').catch(() => {}); throw e; }
    finally { await db.close(); }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/import/baikal/url-bai — обновляет url_bai в таблице baikal */
router.post('/baikal/url-bai', async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows required' });
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const existingIds = await getBaikalExistingIds(db);
      const matching = rows.filter(r => r.id && existingIds.has(String(r.id)));
      const notFound = rows.length - matching.length;
      if (matching.length > 0) {
        await db.run('BEGIN TRANSACTION');
        for (const row of matching) {
          await db.run('UPDATE baikal SET url_bai = ? WHERE id = ?', [String(row.urlBai ?? ''), String(row.id)]);
        }
        await db.run('COMMIT');
      }
      res.json({ success: true, updated: matching.length, notFound, total: rows.length });
    } catch (e) { await db.run('ROLLBACK').catch(() => {}); throw e; }
    finally { await db.close(); }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /api/import/baikal/check-statuses — проверка статусов для таблицы baikal */
router.post('/baikal/check-statuses', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      const placeholders = ids.map(() => '?').join(',');
      const removed = await db.all(
        `SELECT id, name FROM baikal WHERE id IN (${placeholders}) AND status_avito = 'removed'`, ids
      );
      const notPublished = await db.all(
        `SELECT id, name FROM baikal WHERE (status_avito IS NULL OR status_avito != 'removed') AND id NOT IN (${placeholders})`, ids
      );
      res.json({ removed, notPublished });
    } finally { await db.close(); }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

