/**
 * API routes для мониторинга
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { parseAvitoPage } from '../../parser/avitoParser.js';
import { compare } from '../../compare/comparisonEngine.js';
import { mapUrlToSellerId } from '../../utils/sellerMapping.js';
import { loadAvitoSources, getUrlByAlias } from '../../config/avitoSources.js';
import { loadConfig } from '../../config/configManager.js';
import { openDatabase } from '../../db/dbOperations.js';
import { saveMonitorResults, loadMonitorSnapshot } from '../../db/monitorResults.js';
import { logger } from '../logger.js';

const router = express.Router();

export let lastMonitoringResult = null;

/**
 * POST /api/monitor/run
 * Тело: { avitoUrl? } или { alias? } — при alias URL берётся из источников по псевдониму
 */
router.post('/run', async (req, res) => {
  let dbPathUsed = null;
  try {
    const { avitoUrl: urlFromBody, alias, headless = false } = req.body;
    const cleanAlias = alias ? String(alias).trim() : null;

    const config = await loadConfig();
    let dbPath = config.dbPath || './data/products.db';
    if (!path.isAbsolute(dbPath)) {
      dbPath = path.resolve(process.cwd(), dbPath);
    }
    dbPathUsed = dbPath;
    logger.info('Monitoring using DB', { dbPath: dbPathUsed });

    if (!fs.existsSync(dbPath)) {
      return res.status(400).json({
        error: 'Файл базы данных не найден',
        details: `Путь: ${dbPath}. В Настройках укажите полный путь к файлу .db и нажмите «Сохранить конфигурацию».`
      });
    }

    // ── ВЕТКА: Baikal ─────────────────────────────────────────────────────────
    if (cleanAlias === 'baikal') {
      const sources = await loadAvitoSources();
      const baikalSrc = sources.find(s => s.alias === 'baikal');
      const baikalUrl = urlFromBody || baikalSrc?.url;
      if (!baikalUrl) {
        return res.status(400).json({ error: 'Не указан URL источника baikal. Добавьте источник в Настройках.' });
      }

      logger.info('BaikalParser: start', { baikalUrl });
      const { parseBaikalPages } = await import('../../parser/baikalParser.js');
      const { compareBaikal, ensureBaikalTable } = await import('../../db/baikalDb.js');

      await ensureBaikalTable(dbPath);
      const parsedItems = await parseBaikalPages(baikalUrl);
      logger.info('BaikalParser: done', { count: parsedItems.length });

      if (!parsedItems || parsedItems.length === 0) {
        return res.status(400).json({ error: 'Парсер не вернул данных с сайта Baikal Wheels.' });
      }

      const comparisonResult = await compareBaikal(parsedItems, dbPath);
      logger.info('Baikal comparison done', { ...comparisonResult.summary });

      const runId = new Date().toISOString();
      lastMonitoringResult = {
        timestamp: runId,
        sourceType: 'baikal',
        baikalUrl,
        runId,
        alias: cleanAlias,
        items: parsedItems.map(i => ({ name: i.name, price: i.price, url: i.url })),
        ...comparisonResult
      };

      try {
        await saveMonitorResults(dbPath, {
          runId,
          alias: cleanAlias,
          sellerId: null,
          priceChanges: comparisonResult.priceChanges || [],
          removedItems: comparisonResult.removedItems || [],
          newItems: comparisonResult.newItems || [],
          noChangeItems: comparisonResult.noChangeItems || [],
          backOnSaleItems: comparisonResult.backOnSaleItems || []
        });
      } catch (e) {
        logger.error('Failed to persist baikal monitor results', { error: e.message });
      }

      return res.json(lastMonitoringResult);
    }

    // ── ВЕТКА: Avito / VSE4 ──────────────────────────────────────────────────
    let avitoUrl = urlFromBody;
    if (!avitoUrl && cleanAlias) {
      const sources = await loadAvitoSources();
      avitoUrl = getUrlByAlias(sources, cleanAlias);
    }
    if (!avitoUrl) {
      return res.status(400).json({ error: 'Укажите avitoUrl или alias источника' });
    }
    try {
      new URL(avitoUrl);
    } catch (e) {
      return res.status(400).json({ error: 'Невалидный URL' });
    }

    let sellerId;
    try {
      sellerId = mapUrlToSellerId(avitoUrl);
    } catch (e) {
      return res.status(400).json({ error: `Ошибка извлечения Seller ID: ${e.message}` });
    }

    logger.info('Parsing started', { avitoUrl: avitoUrl.slice(0, 60) + '...', headless });

    const rawAvitoItems = await parseAvitoPage(avitoUrl, { headless });
    logger.info('Parsing completed', { count: rawAvitoItems.length });

    let avitoItems = [];
    try {
      const db = await openDatabase(dbPath);
      try {
        await db.run('DROP TABLE IF EXISTS temp_parsed');
        await db.run(`
          CREATE TEMPORARY TABLE temp_parsed (
            url TEXT PRIMARY KEY,
            url_normalized TEXT,
            name TEXT,
            price REAL
          )
        `);
        const { normalizeUrl } = await import('../../parser/normalizers.js');
        const insertStmt = await db.prepare(`
          INSERT OR IGNORE INTO temp_parsed (url, url_normalized, name, price)
          VALUES (?, ?, ?, ?)
        `);
        for (const item of rawAvitoItems) {
          const urlNormalized = normalizeUrl(item.url);
          await insertStmt.run(item.url, urlNormalized, item.name, item.price);
        }
        await insertStmt.finalize();
        avitoItems = await db.all(`SELECT url_normalized as url, name, price FROM temp_parsed`);
        logger.info('Normalization completed', { raw: rawAvitoItems.length, afterPrimaryKeyDedup: avitoItems.length });
      } finally {
        await db.close();
      }
    } catch (dbError) {
      throw new Error(`Ошибка работы с БД: ${dbError.message}`);
    }

    if (dbPath && dbPath.includes('diski_sait')) {
      process.env.DB_TABLE = 'VSE4';
    }

    if (!avitoItems || avitoItems.length === 0) {
      return res.status(400).json({
        error: 'После нормализации не осталось товаров',
        details: `Спарсено: ${rawAvitoItems.length}, после нормализации: 0. Проверьте данные парсинга.`
      });
    }

    logger.info('Comparison started', { sellerId, itemsCount: avitoItems.length });
    const comparisonResult = await compare(avitoItems, dbPath, sellerId);
    logger.info('Comparison completed', { ...comparisonResult.summary });

    const items = avitoItems.map(it => ({ name: it.name, price: it.price, url: it.url }));
    const runId = new Date().toISOString();
    lastMonitoringResult = {
      timestamp: runId,
      sourceType: 'VSE4',
      avitoUrl,
      sellerId,
      runId,
      alias: cleanAlias,
      items,
      ...comparisonResult
    };

    try {
      await saveMonitorResults(dbPath, {
        runId,
        alias: cleanAlias || null,
        sellerId,
        priceChanges: comparisonResult.priceChanges || [],
        removedItems: comparisonResult.removedItems || [],
        newItems: comparisonResult.newItems || [],
        noChangeItems: comparisonResult.noChangeItems || [],
        backOnSaleItems: comparisonResult.backOnSaleItems || []
      });
      logger.info('Monitor results persisted', { alias: cleanAlias, runId });
    } catch (persistError) {
      logger.error('Failed to persist monitor results', { error: persistError.message });
    }

    res.json(lastMonitoringResult);

  } catch (error) {
    logger.error('Monitoring failed', { error: error.message, dbPathUsed });
    let details = error.message;
    if (dbPathUsed) details += ` Использовалась БД: ${dbPathUsed}`;
    if (error.message && error.message.includes('SQLITE_CANTOPEN')) {
      details = 'Файл БД не найден или нет доступа.';
    }
    res.status(500).json({ error: 'Ошибка выполнения мониторинга', details, dbPathUsed: dbPathUsed || undefined });
  }
});

/**
 * GET /api/monitor/results
 * Возвращает результаты последнего мониторинга (в памяти)
 */
router.get('/results', (req, res) => {
  if (!lastMonitoringResult) {
    return res.status(404).json({
      error: 'Результаты мониторинга отсутствуют. Запустите мониторинг сначала.'
    });
  }
  res.json(lastMonitoringResult);
});

/**
 * GET /api/monitor/stored
 * alias (обязательный), runId (опциональный) — результаты из таблицы monitor_results
 */
router.get('/stored', async (req, res) => {
  try {
    const { alias, runId } = req.query;
    if (!alias) {
      return res.status(400).json({ error: 'Укажите alias источника' });
    }

    const config = await loadConfig();
    let dbPath = config.dbPath || './data/products.db';
    if (!path.isAbsolute(dbPath)) {
      dbPath = path.resolve(process.cwd(), dbPath);
    }

    const snapshot = await loadMonitorSnapshot(dbPath, String(alias).trim(), runId ? String(runId) : undefined);
    if (!snapshot) {
      return res.status(404).json({
        error: 'Сохранённых результатов для этого alias не найдено'
      });
    }

    res.json({
      timestamp: snapshot.runId,
      runId: snapshot.runId,
      alias: snapshot.alias,
      priceChanges: snapshot.priceChanges,
      removedItems: snapshot.removedItems,
      newItems: snapshot.newItems,
      noChangeItems: snapshot.noChangeItems,
      backOnSaleItems: snapshot.backOnSaleItems,
      summary: {
        priceChanges: snapshot.priceChanges.length,
        removed: snapshot.removedItems.length,
        new: snapshot.newItems.length,
        noChange: snapshot.noChangeItems.length,
        backOnSale: snapshot.backOnSaleItems.length,
        total: snapshot.priceChanges.length + snapshot.removedItems.length +
               snapshot.newItems.length + snapshot.noChangeItems.length +
               snapshot.backOnSaleItems.length
      }
    });
  } catch (error) {
    logger.error('Load stored monitoring failed', { error: error.message });
    res.status(500).json({
      error: 'Ошибка загрузки сохранённых результатов',
      details: error.message
    });
  }
});

/**
 * POST /api/monitor/recalculate
 * Повторное сравнение с БД без повторного парсинга Avito.
 * Использует avitoItems из памяти или реконструирует из сохранённого снапшота.
 */
router.post('/recalculate', async (req, res) => {
  const { alias } = req.body || {};

  try {
    const config = await loadConfig();
    let dbPath = config.dbPath || './data/products.db';
    if (!path.isAbsolute(dbPath)) {
      dbPath = path.resolve(process.cwd(), dbPath);
    }
    if (dbPath && dbPath.includes('diski_sait')) {
      process.env.DB_TABLE = 'VSE4';
    }

    let avitoItems;
    let sellerId;

    if (lastMonitoringResult && lastMonitoringResult.items && lastMonitoringResult.items.length > 0) {
      // Используем данные из памяти
      avitoItems = lastMonitoringResult.items;
      sellerId = lastMonitoringResult.sellerId;
    } else {
      // Реконструируем avitoItems из сохранённого снапшота в БД
      const aliasToLoad = alias || null;
      if (!aliasToLoad) {
        return res.status(404).json({
          error: 'Нет данных парсинга в памяти. Запустите мониторинг или укажите alias.'
        });
      }
      const snapshot = await loadMonitorSnapshot(dbPath, aliasToLoad);
      if (!snapshot) {
        return res.status(404).json({
          error: `Нет сохранённых результатов для «${aliasToLoad}». Запустите мониторинг сначала.`
        });
      }
      // Avito items = всё кроме removed (они из БД, не с Avito)
      avitoItems = [
        ...(snapshot.priceChanges || []).map(i => ({ url: i.url, name: i.name, price: i.newPrice })),
        ...(snapshot.noChangeItems || []).map(i => ({ url: i.url, name: i.name, price: i.price })),
        ...(snapshot.newItems || []).map(i => ({ url: i.url, name: i.name, price: i.price })),
        ...(snapshot.backOnSaleItems || []).map(i => ({ url: i.url, name: i.name, price: i.newPrice }))
      ].filter(i => i.url);

      // Извлекаем sellerId из источников
      try {
        const sources = await loadAvitoSources();
        const src = sources.find(s => s.alias === aliasToLoad);
        if (src) sellerId = mapUrlToSellerId(src.url);
      } catch (_) { sellerId = null; }

      logger.info('Recalculate: reconstructed avitoItems from snapshot', { count: avitoItems.length, alias: aliasToLoad });
    }

    logger.info('Recalculate: re-comparing with DB', { items: avitoItems.length, sellerId });

    const isBaikal = (lastMonitoringResult && lastMonitoringResult.sourceType === 'baikal') || alias === 'baikal';
    let comparisonResult;
    if (isBaikal) {
      const { compareBaikal } = await import('../../db/baikalDb.js');
      comparisonResult = await compareBaikal(avitoItems, dbPath);
    } else {
      comparisonResult = await compare(avitoItems, dbPath, sellerId);
    }
    logger.info('Recalculate completed', { ...comparisonResult.summary });

    // Обновляем in-memory результат
    lastMonitoringResult = {
      ...(lastMonitoringResult || {}),
      items: avitoItems,
      sellerId,
      alias: alias || (lastMonitoringResult && lastMonitoringResult.alias) || null,
      runId: (lastMonitoringResult && lastMonitoringResult.runId) || new Date().toISOString(),
      ...comparisonResult
    };

    // Сохраняем обновлённые результаты в БД
    const resolvedAlias = lastMonitoringResult.alias || null;
    const runId = lastMonitoringResult.runId;
    await saveMonitorResults(dbPath, {
      runId,
      alias: resolvedAlias,
      sellerId,
      priceChanges: comparisonResult.priceChanges || [],
      removedItems: comparisonResult.removedItems || [],
      newItems: comparisonResult.newItems || [],
      noChangeItems: comparisonResult.noChangeItems || [],
      backOnSaleItems: comparisonResult.backOnSaleItems || []
    }).catch(e => logger.warn('Recalculate save failed', { error: e.message }));

    res.json(lastMonitoringResult);
  } catch (error) {
    logger.error('Recalculate failed', { error: error.message });
    res.status(500).json({ error: 'Ошибка пересчёта', details: error.message });
  }
});

/**
 * GET /api/monitor/export-parsed
 * Выгружает спарсенные с Avito данные последнего мониторинга в Excel.
 * Помогает отладить расхождения (например, почему позиции попали в "Снятые").
 */
router.get('/export-parsed', async (req, res) => {
  if (!lastMonitoringResult || !lastMonitoringResult.items || lastMonitoringResult.items.length === 0) {
    return res.status(404).json({ error: 'Нет данных парсинга. Сначала запустите мониторинг.' });
  }

  try {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'price-monitoring';
    wb.created = new Date();

    // Лист 1: все позиции спарсенные с Avito
    const wsAvito = wb.addWorksheet('Спарсено с Avito');
    wsAvito.columns = [
      { header: '№',        key: 'num',   width: 6  },
      { header: 'Название', key: 'name',  width: 60 },
      { header: 'Цена',     key: 'price', width: 14 },
      { header: 'URL',      key: 'url',   width: 80 },
    ];
    wsAvito.getRow(1).font = { bold: true };
    lastMonitoringResult.items.forEach((item, i) => {
      wsAvito.addRow({ num: i + 1, name: item.name, price: item.price, url: item.url });
    });

    // Лист 2: снятые с продажи (для сравнения — есть ли их URL на листе 1)
    const wsRemoved = wb.addWorksheet('Снятые с продажи');
    wsRemoved.columns = [
      { header: '№',        key: 'num',   width: 6  },
      { header: 'ID БД',    key: 'dbId',  width: 10 },
      { header: 'Название', key: 'name',  width: 60 },
      { header: 'Цена БД',  key: 'price', width: 14 },
      { header: 'URL БД',   key: 'url',   width: 80 },
    ];
    wsRemoved.getRow(1).font = { bold: true };
    (lastMonitoringResult.removedItems || []).forEach((item, i) => {
      wsRemoved.addRow({ num: i + 1, dbId: item.dbId, name: item.name, price: item.price, url: item.url });
    });

    // Лист 3: без изменений
    const wsNoChange = wb.addWorksheet('Без изменений');
    wsNoChange.columns = [
      { header: '№',        key: 'num',   width: 6  },
      { header: 'ID БД',    key: 'dbId',  width: 10 },
      { header: 'Название', key: 'name',  width: 60 },
      { header: 'Цена',     key: 'price', width: 14 },
      { header: 'URL',      key: 'url',   width: 80 },
    ];
    wsNoChange.getRow(1).font = { bold: true };
    (lastMonitoringResult.noChangeItems || []).forEach((item, i) => {
      wsNoChange.addRow({ num: i + 1, dbId: item.dbId, name: item.name, price: item.price, url: item.url });
    });

    const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '-');
    const filename = `avito_parsed_${ts}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error('Export parsed failed', { error: err.message });
    res.status(500).json({ error: 'Ошибка экспорта', details: err.message });
  }
});

export default router;
