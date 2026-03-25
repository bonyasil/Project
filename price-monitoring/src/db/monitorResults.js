/**
 * Хранение результатов мониторинга (парсинг + сравнение) в общей таблице monitor_results.
 */

import { openDatabase } from './dbOperations.js';

const TABLE_NAME = 'monitor_results';

async function ensureTable(dbPath) {
  const db = await openDatabase(dbPath);
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        alias TEXT,
        seller_id TEXT,
        section TEXT NOT NULL,
        name TEXT,
        url TEXT,
        old_price REAL,
        new_price REAL,
        nacenka REAL,
        price_ow REAL,
        for_site INTEGER,
        db_id TEXT,
        status TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Миграция: добавляем колонку status, если таблица уже была создана раньше
    const columns = await db.all(`PRAGMA table_info(${TABLE_NAME})`);
    const hasStatus = columns.some(col => col.name === 'status');
    if (!hasStatus) {
      await db.run(`ALTER TABLE ${TABLE_NAME} ADD COLUMN status TEXT`);
    }
  } finally {
    await db.close();
  }
}

/**
 * Сохраняет результаты одного запуска мониторинга в таблицу monitor_results.
 * Перед вставкой очищает прошлые записи для данного alias.
 */
export async function saveMonitorResults(dbPath, {
  runId,
  alias,
  sellerId,
  priceChanges,
  removedItems,
  newItems,
  noChangeItems,
  backOnSaleItems
}) {
  await ensureTable(dbPath);
  const db = await openDatabase(dbPath);

  const insertSql = `
    INSERT INTO ${TABLE_NAME} (
      run_id, alias, seller_id, section,
      name, url, old_price, new_price, nacenka,
      price_ow, for_site, db_id, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const toRows = (status, items, mapFn) =>
    (items || []).map(item => {
      const r = mapFn(item);
      return [
        runId,
        alias || null,
        sellerId || null,
        status,           // section = status для единообразия
        r.name || null,
        r.url || null,
        r.oldPrice ?? null,
        r.newPrice ?? null,
        r.nacenka ?? null,
        r.priceOw ?? null,
        r.forSite ?? null,
        r.dbId ?? null,
        status
      ];
    });

  const allRows = [
    ...toRows('price_change', priceChanges, item => ({
      name: item.name, url: item.url,
      oldPrice: item.oldPrice, newPrice: item.newPrice,
      nacenka: item.nacenka, priceOw: item.priceOw,
      forSite: item.forSite, dbId: item.id
    })),
    ...toRows('removed', removedItems, item => ({
      name: item.name, url: item.url,
      oldPrice: item.price, newPrice: null,
      nacenka: null, priceOw: null,
      forSite: item.forSite, dbId: item.id
    })),
    ...toRows('new', newItems, item => ({
      name: item.name, url: item.url,
      oldPrice: null, newPrice: item.price,
      nacenka: null, priceOw: null,
      forSite: null, dbId: null
    })),
    ...toRows('no_change', noChangeItems, item => ({
      name: item.name, url: item.url,
      oldPrice: item.price, newPrice: item.price,
      nacenka: item.nacenka, priceOw: item.priceOw,
      forSite: item.forSite, dbId: item.id
    })),
    ...toRows('back_on_sale', backOnSaleItems, item => ({
      name: item.name, url: item.url,
      oldPrice: item.oldPrice, newPrice: item.newPrice,
      nacenka: item.nacenka, priceOw: item.priceOw,
      forSite: item.forSite, dbId: item.id
    }))
  ];

  console.log(`[saveMonitorResults] rows to save: ${allRows.length} | price_change:${(priceChanges||[]).length} removed:${(removedItems||[]).length} new:${(newItems||[]).length} no_change:${(noChangeItems||[]).length} back_on_sale:${(backOnSaleItems||[]).length}`);

  let savedCount = 0;
  try {
    await db.run('BEGIN TRANSACTION');

    if (alias) {
      await db.run(`DELETE FROM ${TABLE_NAME} WHERE alias = ?`, [alias]);
    } else {
      // Без alias очищаем по run_id чтобы не накапливать дубли
      // (run_id уникален для каждого запуска — здесь новая запись, старых нет)
    }

    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];
      try {
        await db.run(insertSql, row);
        savedCount++;
      } catch (rowErr) {
        console.error(`[saveMonitorResults] row #${i} insert error (status=${row[3]}):`, rowErr.message, '| data:', JSON.stringify(row));
      }
    }

    await db.run('COMMIT');
    console.log(`[saveMonitorResults] committed ${savedCount}/${allRows.length} rows`);
  } catch (e) {
    console.error('[saveMonitorResults] transaction error, rolling back:', e.message);
    try { await db.run('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    await db.close();
  }
}

/**
 * Читает сохранённый срез мониторинга по alias и (опционально) runId.
 * Если runId не задан, берётся последний по времени.
 */
export async function loadMonitorSnapshot(dbPath, alias, runId) {
  await ensureTable(dbPath);
  const db = await openDatabase(dbPath);
  try {
    let finalRunId = runId;
    if (!finalRunId) {
      const row = await db.get(
        `SELECT run_id FROM ${TABLE_NAME} WHERE alias = ? ORDER BY created_at DESC LIMIT 1`,
        [alias]
      );
      if (!row) return null;
      finalRunId = row.run_id;
    }

    const rows = await db.all(
      `SELECT * FROM ${TABLE_NAME} WHERE alias = ? AND run_id = ? ORDER BY id`,
      [alias, finalRunId]
    );

    const priceChanges = [];
    const removedItems = [];
    const newItems = [];
    const noChangeItems = [];
    const backOnSaleItems = [];

    for (const row of rows) {
      const s = row.status || row.section;
      if (s === 'price_change') {
        priceChanges.push({
          id: row.db_id,
          name: row.name,
          url: row.url,
          oldPrice: row.old_price,
          newPrice: row.new_price,
          nacenka: row.nacenka,
          priceOw: row.price_ow,
          forSite: row.for_site
        });
      } else if (s === 'removed') {
        removedItems.push({
          id: row.db_id,
          name: row.name,
          url: row.url,
          price: row.old_price,
          forSite: row.for_site
        });
      } else if (s === 'new') {
        newItems.push({
          name: row.name,
          url: row.url,
          price: row.new_price
        });
      } else if (s === 'no_change' || s === 'all') {
        noChangeItems.push({
          id: row.db_id,
          name: row.name,
          url: row.url,
          price: row.old_price,
          nacenka: row.nacenka,
          priceOw: row.price_ow,
          forSite: row.for_site
        });
      } else if (s === 'back_on_sale') {
        backOnSaleItems.push({
          id: row.db_id,
          name: row.name,
          url: row.url,
          oldPrice: row.old_price,
          newPrice: row.new_price,
          nacenka: row.nacenka,
          priceOw: row.price_ow,
          forSite: row.for_site
        });
      }
    }

    return {
      runId: finalRunId,
      alias,
      priceChanges,
      removedItems,
      newItems,
      noChangeItems,
      backOnSaleItems
    };
  } finally {
    await db.close();
  }
}

/**
 * После применения изменений цен переводит строки price_change → no_change
 * для указанных db_id.
 */
export async function markPriceChangesApplied(dbPath, dbIds) {
  if (!dbIds || dbIds.length === 0) return;
  await ensureTable(dbPath);
  const db = await openDatabase(dbPath);
  try {
    const placeholders = dbIds.map(() => '?').join(',');
    await db.run(
      `UPDATE ${TABLE_NAME}
       SET status = 'no_change', section = 'no_change',
           old_price = new_price
       WHERE status = 'price_change'
         AND db_id IN (${placeholders})`,
      dbIds.map(String)
    );
  } finally {
    await db.close();
  }
}

