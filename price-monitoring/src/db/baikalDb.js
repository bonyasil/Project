/**
 * Операции с таблицей baikal (сайт irkutsk.baikalwheels.ru).
 * Схема: url_bai TEXT PK, name TEXT, price_bai REAL, nacenka REAL, status_avito TEXT
 */

import { openDatabase } from './dbOperations.js';

/**
 * Создаёт таблицу baikal, если не существует.
 */
export async function ensureBaikalTable(dbPath) {
  // Таблица baikal уже существует — только проверяем наличие нужных столбцов
  const db = await openDatabase(dbPath);
  try {
    const cols = await db.all(`PRAGMA table_info(baikal)`);
    const names = cols.map(c => c.name);
    if (!names.includes('status_avito')) await db.run(`ALTER TABLE baikal ADD COLUMN status_avito TEXT`);
    if (!names.includes('url_bai'))    await db.run(`ALTER TABLE baikal ADD COLUMN url_bai TEXT`);
    if (!names.includes('price_bai'))  await db.run(`ALTER TABLE baikal ADD COLUMN price_bai TEXT`);
    if (!names.includes('nacenka'))    await db.run(`ALTER TABLE baikal ADD COLUMN nacenka TEXT`);
  } finally {
    await db.close();
  }
}

/**
 * Сравнивает спарсенные позиции с таблицей baikal.
 * @param {Array<{url, name, price}>} parsedItems - результат парсинга сайта
 * @param {string} dbPath
 * @returns {Promise<Object>} comparisonResult
 */
export async function compareBaikal(parsedItems, dbPath) {
  const db = await openDatabase(dbPath);
  try {
    const dbRows = await db.all(
      `SELECT id, url_bai, name, CAST(price_bai AS REAL) as price_bai, CAST(nacenka AS REAL) as nacenka, status_avito FROM baikal`
    );

    function norm(u) {
      return (u || '').trim().replace(/\/+$/, '').toLowerCase();
    }

    // Map: normalized_url → [dbRow, ...] (несколько строк могут иметь одинаковый url_bai)
    const dbMap = new Map();
    dbRows.forEach(row => {
      if (!row.url_bai) return;
      const key = norm(row.url_bai);
      if (!dbMap.has(key)) dbMap.set(key, []);
      dbMap.get(key).push(row);
    });

    // Set: normalized URLs с сайта
    const siteUrlSet = new Set(parsedItems.map(i => norm(i.url)));

    const priceChanges = [];
    const noChangeItems = [];
    const backOnSaleItems = [];
    const newItems = [];
    const removedItems = [];

    for (const item of parsedItems) {
      const key = norm(item.url);
      const dbRowList = dbMap.get(key);

      if (!dbRowList) {
        newItems.push({ url: item.url, name: item.name, price: item.price });
        continue;
      }

      for (const dbRow of dbRowList) {
        if (dbRow.status_avito === 'removed') {
          backOnSaleItems.push({
            id: dbRow.id,
            url: item.url,
            name: item.name,
            oldPrice: dbRow.price_bai,
            newPrice: item.price,
            nacenka: dbRow.nacenka || 0,
          });
          continue;
        }

        if (dbRow.price_bai !== item.price) {
          priceChanges.push({
            id: dbRow.id,
            url: item.url,
            name: item.name,
            oldPrice: dbRow.price_bai,
            newPrice: item.price,
            nacenka: dbRow.nacenka || 0,
          });
        } else {
          noChangeItems.push({
            id: dbRow.id,
            url: item.url,
            name: item.name,
            price: item.price,
            nacenka: dbRow.nacenka || 0,
          });
        }
      }
    }

    // Снятые с продажи: url_bai заполнен, не removed, нет на сайте
    for (const row of dbRows) {
      if (!row.url_bai) continue;
      if (row.status_avito === 'removed') continue;
      if (!siteUrlSet.has(norm(row.url_bai))) {
        removedItems.push({
          id: row.id,
          url: row.url_bai,
          name: row.name,
          price: row.price_bai,
        });
      }
    }

    return {
      priceChanges,
      removedItems,
      newItems,
      noChangeItems,
      backOnSaleItems,
      summary: {
        totalSite: parsedItems.length,
        totalDb: dbRows.filter(r => r.url_bai).length,
        priceChanges: priceChanges.length,
        removed: removedItems.length,
        new: newItems.length,
        noChange: noChangeItems.length,
        backOnSale: backOnSaleItems.length,
      }
    };
  } finally {
    await db.close();
  }
}

/**
 * Обновляет price_bai и nacenka в таблице baikal.
 * @param {string} dbPath
 * @param {Array<{url, newPrice, nacenka}>} items
 */
/**
 * Обновляет price_bai и nacenka по id.
 * items: [{id, newPrice, nacenka}]
 */
export async function updateBaikalPrices(dbPath, items) {
  const db = await openDatabase(dbPath);
  try {
    await db.run('BEGIN TRANSACTION');
    let count = 0;
    for (const item of items) {
      const priceOw = (item.newPrice || 0) + (item.nacenka || 0);
      await db.run(
        `UPDATE baikal SET price_bai = ?, nacenka = ?, price_ow = ? WHERE id = ?`,
        [item.newPrice, item.nacenka ?? null, priceOw, item.id]
      );
      count++;
    }
    await db.run('COMMIT');
    return count;
  } catch (e) {
    await db.run('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await db.close();
  }
}

/**
 * Обновляет status_avito для списка id.
 */
export async function updateBaikalStatus(dbPath, ids, status) {
  const db = await openDatabase(dbPath);
  try {
    await db.run('BEGIN TRANSACTION');
    for (const id of ids) {
      await db.run(`UPDATE baikal SET status_avito = ? WHERE id = ?`, [status, id]);
    }
    await db.run('COMMIT');
    return ids.length;
  } catch (e) {
    await db.run('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await db.close();
  }
}

/**
 * Вставляет новые позиции в таблицу baikal (INSERT OR IGNORE).
 * @param {string} dbPath
 * @param {Array<{url, name, price}>} items
 */
export async function insertNewBaikalItems(dbPath, items) {
  if (!items.length) return 0;
  const db = await openDatabase(dbPath);
  try {
    await db.run('BEGIN TRANSACTION');
    const stmt = await db.prepare(
      `INSERT OR IGNORE INTO baikal (url_bai, name, price_bai, status_avito) VALUES (?, ?, ?, NULL)`
    );
    let count = 0;
    for (const item of items) {
      await stmt.run(item.url, item.name, item.price);
      count++;
    }
    await stmt.finalize();
    await db.run('COMMIT');
    return count;
  } catch (e) {
    await db.run('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await db.close();
  }
}
