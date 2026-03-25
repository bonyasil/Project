/**
 * API routes для раздела Наценка (работа с таблицей VSE4: nacenka, price_ow)
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
  if (dbPath.includes('diski_sait')) {
    process.env.DB_TABLE = 'VSE4';
  }
  return dbPath;
}

/** Миграция: добавляет колонку nacenka если её нет, заполняет price_ow - price_vse */
async function ensureNacenkaColumn(db) {
  const cols = await db.all('PRAGMA table_info(VSE4)');
  const hasNacenka = cols.some(c => c.name === 'nacenka');
  if (!hasNacenka) {
    await db.run('ALTER TABLE VSE4 ADD COLUMN nacenka REAL');
    logger.info('VSE4: nacenka column added');
  }
  // Заполняем пустые nacenka из price_ow - price_vse
  await db.run(`
    UPDATE VSE4
    SET nacenka = ROUND(COALESCE(price_ow, 0) - COALESCE(price_vse, 0), 2)
    WHERE nacenka IS NULL
  `);
}

/**
 * GET /api/nacenka/items
 * Фильтры (query): maker, model, diam, search (по name/ID)
 */
router.get('/items', async (req, res) => {
  try {
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      await ensureNacenkaColumn(db);

      const { maker, model, diam, search } = req.query;
      const conditions = [];
      const params = [];

      if (maker) { conditions.push('maker = ?'); params.push(maker); }
      if (model) { conditions.push('model = ?'); params.push(model); }
      if (diam)  { conditions.push('CAST(diam AS REAL) = CAST(? AS REAL)'); params.push(diam); }
      if (search) {
        conditions.push('(name LIKE ? OR ID LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.all(
        `SELECT ID, name, maker, model, diam, price_vse, nacenka,
                ROUND(COALESCE(price_vse, 0) + COALESCE(nacenka, 0), 2) AS price_ow_calc
         FROM VSE4
         ${where}
         ORDER BY ID`,
        params
      );

      // Уникальные значения для фильтров
      const makers = await db.all('SELECT DISTINCT maker FROM VSE4 WHERE maker IS NOT NULL ORDER BY maker');
      const models = await db.all('SELECT DISTINCT model FROM VSE4 WHERE model IS NOT NULL ORDER BY model');
      const diams  = await db.all('SELECT DISTINCT diam FROM VSE4 WHERE diam IS NOT NULL ORDER BY diam');

      res.json({
        items: rows,
        filters: {
          makers: makers.map(r => r.maker),
          models: models.map(r => r.model),
          diams:  diams.map(r => r.diam)
        }
      });
    } finally {
      await db.close();
    }
  } catch (error) {
    logger.error('nacenka/items failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/nacenka/update
 * Тело: { items: [{id, nacenka}] }
 * Обновляет nacenka и пересчитывает price_ow = price_vse + nacenka
 */
router.post('/update', async (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items обязателен' });
  }

  try {
    const dbPath = await getDbPath();
    const db = await openDatabase(dbPath);
    try {
      await ensureNacenkaColumn(db);
      await db.run('BEGIN TRANSACTION');

      let updated = 0;
      for (const item of items) {
        const nacenka = parseFloat(item.nacenka);
        if (isNaN(nacenka)) continue;
        await db.run(
          `UPDATE VSE4
           SET nacenka = ?,
               price_ow = ROUND(COALESCE(price_vse, 0) + ?, 2)
           WHERE ID = ?`,
          [nacenka, nacenka, String(item.id)]
        );
        updated++;
      }

      await db.run('COMMIT');
      logger.info('nacenka updated', { updated });
      res.json({ success: true, updated });
    } catch (e) {
      await db.run('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      await db.close();
    }
  } catch (error) {
    logger.error('nacenka/update failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
