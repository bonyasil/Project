/**
 * БД-операции для временных таблиц vse4_new и baikal_new.
 * Таблицы создаются автоматически при первом обращении.
 */

import sqlite3 from 'sqlite3';
import { promisify } from 'util';

function openDb(dbPath, mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, mode, err => {
      if (err) return reject(new Error(`Ошибка открытия БД: ${err.message}`));
      const w = {
        run: promisify(db.run.bind(db)),
        get: promisify(db.get.bind(db)),
        all: promisify(db.all.bind(db)),
        close: promisify(db.close.bind(db)),
      };
      resolve(w);
    });
  });
}

// ── DDL ───────────────────────────────────────────────────────────────────────

const DDL_VSE4_NEW = `
CREATE TABLE IF NOT EXISTS vse4_new (
  rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    TEXT,
  url_vse     TEXT,
  url_corr    TEXT,
  name        TEXT,
  condition   TEXT,
  type_good   TEXT,
  maker       TEXT,
  model       TEXT,
  width       REAL,
  diam        REAL,
  vylet       REAL,
  count_otv   REAL,
  diam_otv    REAL,
  centr_otv   REAL,
  type_disk   TEXT,
  color       TEXT,
  color_code  TEXT,
  specifications TEXT,
  price_vse   REAL,
  nacenka     REAL,
  price_ow    REAL,
  link_foto   TEXT,
  text_avito  TEXT,
  photo_status  TEXT DEFAULT 'not_attached',
  site_status   TEXT DEFAULT 'not_sent',
  local_status  TEXT DEFAULT 'not_transferred',
  error_message TEXT,
  created_at  TEXT DEFAULT (datetime('now','localtime'))
)`;

const DDL_BAIKAL_NEW = `
CREATE TABLE IF NOT EXISTS baikal_new (
  rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    TEXT,
  url_bai     TEXT,
  url_corr    TEXT,
  name        TEXT,
  condition   TEXT,
  type_good   TEXT,
  maker       TEXT,
  model       TEXT,
  width       TEXT,
  diam        TEXT,
  vylet       TEXT,
  count_otv   TEXT,
  diam_otv    TEXT,
  centr_otv   TEXT,
  type_disk   TEXT,
  color       TEXT,
  specifications TEXT,
  price_bai   REAL,
  nacenka     REAL,
  price_ow    REAL,
  link_foto   TEXT,
  text_avito  TEXT,
  photo_status  TEXT DEFAULT 'not_attached',
  site_status   TEXT DEFAULT 'not_sent',
  local_status  TEXT DEFAULT 'not_transferred',
  error_message TEXT,
  created_at  TEXT DEFAULT (datetime('now','localtime'))
)`;

function tableName(alias) {
  return alias.toLowerCase() === 'baikal' ? 'baikal_new' : 'vse4_new';
}


/** Создаёт таблицу *_new если её нет; добавляет недостающие столбцы в уже существующие таблицы */
export async function ensureNewTable(dbPath, alias) {
  const db = await openDb(dbPath);
  const table = tableName(alias);
  try {
    const ddl = alias.toLowerCase() === 'baikal' ? DDL_BAIKAL_NEW : DDL_VSE4_NEW;
    await db.run(ddl);
    // Миграция: добавить text_avito если отсутствует
    try { await db.run(`ALTER TABLE ${table} ADD COLUMN text_avito TEXT`); } catch { /* уже есть */ }
    // Миграция: добавить color_code если отсутствует
    try { await db.run(`ALTER TABLE ${table} ADD COLUMN color_code TEXT`); } catch { /* уже есть */ }
  } finally {
    await db.close();
  }
}

// ── Запись результатов парсинга ───────────────────────────────────────────────

/**
 * Вставляет спарсенные строки в *_new.
 * @param {string} dbPath
 * @param {string} alias  - 'VSE4' или 'baikal'
 * @param {string} batchId
 * @param {Object[]} items - результаты parseAvitoListing()
 * @returns {Promise<number>} - количество вставленных строк
 */
export async function insertNewItems(dbPath, alias, batchId, items) {
  const db = await openDb(dbPath);
  const isBaikal = alias.toLowerCase() === 'baikal';
  let inserted = 0;

  try {
    await db.run('BEGIN TRANSACTION');

    for (const item of items) {
      if (isBaikal) {
        await db.run(`
          INSERT INTO baikal_new
            (batch_id, url_bai, url_corr, name, condition, type_good, maker, model,
             width, diam, vylet, count_otv, diam_otv, centr_otv, type_disk, color,
             specifications, price_bai, error_message)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
          batchId,
          item.url_vse ?? item.url_bai ?? null,
          item.url_corr ?? null,
          item.name, item.condition, item.type_good,
          item.maker, item.model,
          item.width, item.diam, item.vylet,
          item.count_otv, item.diam_otv, item.centr_otv,
          item.type_disk, item.color, item.specifications,
          item.price_vse ?? item.price_bai ?? null,
          item._error ?? null,
        ]);
      } else {
        await db.run(`
          INSERT INTO vse4_new
            (batch_id, url_vse, url_corr, name, condition, type_good, maker, model,
             width, diam, vylet, count_otv, diam_otv, centr_otv, type_disk, color,
             specifications, price_vse, error_message)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
          batchId,
          item.url_vse ?? null,
          item.url_corr ?? null,
          item.name, item.condition, item.type_good,
          item.maker, item.model,
          item.width, item.diam, item.vylet,
          item.count_otv, item.diam_otv, item.centr_otv,
          item.type_disk, item.color, item.specifications,
          item.price_vse ?? null,
          item._error ?? null,
        ]);
      }
      inserted++;
    }

    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  } finally {
    await db.close();
  }

  return inserted;
}

// ── Чтение ────────────────────────────────────────────────────────────────────

/**
 * Возвращает все строки из *_new, опционально фильтруя по batch_id.
 */
export async function getNewItems(dbPath, alias, batchId = null) {
  const db = await openDb(dbPath);
  const table = tableName(alias);
  try {
    if (batchId) {
      return await db.all(
        `SELECT * FROM ${table} WHERE batch_id = ? ORDER BY rowid`,
        [batchId]
      );
    }
    return await db.all(`SELECT * FROM ${table} ORDER BY rowid DESC`);
  } finally {
    await db.close();
  }
}

/**
 * Список уникальных batch_id с датами и количеством строк.
 */
export async function getBatches(dbPath, alias) {
  const db = await openDb(dbPath);
  const table = tableName(alias);
  try {
    return await db.all(`
      SELECT batch_id,
             MIN(created_at) AS created_at,
             COUNT(*) AS total,
             SUM(CASE WHEN error_message IS NULL THEN 1 ELSE 0 END) AS ok,
             SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) AS errors
      FROM ${table}
      GROUP BY batch_id
      ORDER BY MIN(created_at) DESC
    `);
  } finally {
    await db.close();
  }
}

// ── Обновление ────────────────────────────────────────────────────────────────

/**
 * Обновляет поля строки по rowid.
 */
export async function updateNewItem(dbPath, alias, rowid, fields) {
  const db = await openDb(dbPath);
  const table = tableName(alias);
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  try {
    await db.run(
      `UPDATE ${table} SET ${setClause} WHERE rowid = ?`,
      [...Object.values(fields), rowid]
    );
  } finally {
    await db.close();
  }
}

// ── Экспорт в основную таблицу ────────────────────────────────────────────────

/**
 * Экспортирует выбранные строки из *_new в основную таблицу (VSE4 / baikal).
 * Генерирует ID, вставляет, затем удаляет из *_new.
 * @returns {Promise<{exported: number, ids: string[]}>}
 */
export async function exportNewItems(dbPath, alias, rowids) {
  if (!rowids || rowids.length === 0) return { exported: 0, ids: [] };

  const db = await openDb(dbPath);
  const srcTable = tableName(alias);
  const isBaikal  = alias.toLowerCase() === 'baikal';
  const dstTable  = isBaikal ? 'baikal' : 'VSE4';
  const prefix    = isBaikal ? 'BAI' : 'VSE';
  const idCol     = isBaikal ? 'id' : 'ID';

  try {
    // Получаем строки для экспорта
    const placeholders = rowids.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT * FROM ${srcTable} WHERE rowid IN (${placeholders})`,
      rowids
    );
    if (rows.length === 0) return { exported: 0, ids: [] };

    // Определяем следующий свободный номер ID
    const maxRow = await db.get(
      `SELECT MAX(CAST(SUBSTR(${idCol}, ${prefix.length + 1}) AS INTEGER)) AS mx FROM ${dstTable}
       WHERE ${idCol} LIKE '${prefix}%' AND TYPEOF(CAST(SUBSTR(${idCol}, ${prefix.length + 1}) AS INTEGER)) = 'integer'`
    );
    let nextN = (maxRow?.mx ?? 0) + 1;

    await db.run('BEGIN TRANSACTION');
    const ids = [];

    for (const row of rows) {
      const newId = `${prefix}${nextN++}`;
      ids.push(newId);

      if (isBaikal) {
        await db.run(`
          INSERT OR IGNORE INTO baikal
            (id, name, condition, type_good, maker, model,
             width, diam, vylet, count_otv, diam_otv, centr_otv,
             type_disk, color, specifications, price_bai, nacenka, price_ow,
             url_bai, text_avito, link_foto, status_avito)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
          newId, row.name, row.condition, row.type_good, row.maker, row.model,
          row.width, row.diam, row.vylet, row.count_otv, row.diam_otv, row.centr_otv,
          row.type_disk, row.color, row.specifications,
          row.price_bai ?? row.price_vse ?? null, row.nacenka, row.price_ow,
          row.url_bai ?? row.url_vse ?? null,
          row.text_avito, row.link_foto, 'active',
        ]);
      } else {
        await db.run(`
          INSERT OR IGNORE INTO VSE4
            (ID, name, condition, type_good, maker, model,
             width, diam, vylet, count_otv, diam_otv, centr_otv,
             type_disk, color, specifications, price_vse, nacenka, price_ow,
             url_vse, url_corr, text_avito, link_foto, status_avito)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
          newId, row.name, row.condition, row.type_good, row.maker, row.model,
          row.width, row.diam, row.vylet, row.count_otv, row.diam_otv, row.centr_otv,
          row.type_disk, row.color, row.specifications,
          row.price_vse, row.nacenka, row.price_ow,
          row.url_vse, row.url_corr,
          row.text_avito, row.link_foto, 'active',
        ]);
      }
    }

    // Удаляем экспортированные строки из *_new
    await db.run(`DELETE FROM ${srcTable} WHERE rowid IN (${placeholders})`, rowids);

    await db.run('COMMIT');
    return { exported: ids.length, ids };

  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  } finally {
    await db.close();
  }
}

// ── Очистка ───────────────────────────────────────────────────────────────────

/**
 * Удаляет из *_new строки, которые успешно перенесены (local_status = 'transferred').
 * Если передан batchId — только для этого пакета.
 */
export async function clearTransferredItems(dbPath, alias, batchId = null) {
  const db = await openDb(dbPath);
  const table = tableName(alias);
  try {
    const condition = batchId
      ? `local_status = 'transferred' AND batch_id = ?`
      : `local_status = 'transferred'`;
    const params = batchId ? [batchId] : [];
    const res = await db.run(`DELETE FROM ${table} WHERE ${condition}`, params);
    return res.changes ?? 0;
  } finally {
    await db.close();
  }
}
