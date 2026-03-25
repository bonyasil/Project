/**
 * API routes для применения изменений
 */

import express from 'express';
import { updatePrices, updateStatus, getProductsByIds } from '../../db/dbOperations.js';
import { markPriceChangesApplied } from '../../db/monitorResults.js';
import { syncMultipleProducts, deleteProductFromSite } from '../../sync/siteSync.js';
import { loadConfig } from '../../config/configManager.js';
import { setLastPriceUpdates, setLastStatusUpdates, setLastSyncResults, getLastAppliedChanges } from '../appliedChangesStore.js';
import { lastMonitoringResult } from './monitoring.js';
import { logger } from '../logger.js';

const router = express.Router();

/**
 * GET /api/apply/changes
 * Возвращает списки последних внесённых изменений в локальную БД (для раздела «Внести изменения»)
 */
router.get('/changes', (req, res) => {
  res.json(getLastAppliedChanges());
});

/**
 * POST /api/apply/prices
 * Применяет изменения цен и синхронизирует с сайтом
 */
router.post('/prices', async (req, res) => {
  try {
    const { items, tableType } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Параметр items обязателен и должен быть непустым массивом'
      });
    }

    const config = await loadConfig();
    const dbPath = config.dbPath;

    // ── ВЕТКА: Baikal ──────────────────────────────────────────────────────
    if (tableType === 'baikal') {
      const { updateBaikalPrices } = await import('../../db/baikalDb.js');
      logger.info('Applying baikal prices', { count: items.length });
      // items для baikal: [{url, newPrice, nacenka}]
      const updatedCount = await updateBaikalPrices(dbPath, items);
      logger.info('Baikal prices updated', { updatedCount });
      return res.json({ success: true, updated: updatedCount, sync: { total: 0, success: 0, failed: 0 } });
    }

    // ── ВЕТКА: VSE4 ────────────────────────────────────────────────────────
    for (const item of items) {
      if (!item.id || typeof item.newPrice !== 'number') {
        return res.status(400).json({
          error: 'Каждый элемент должен содержать id и newPrice'
        });
      }
    }

    if (dbPath && dbPath.includes('diski_sait')) {
      process.env.DB_TABLE = 'VSE4';
    }
    logger.info('Applying prices', { count: items.length });
    const updatedCount = await updatePrices(dbPath, items);
    logger.info('Prices updated', { updatedCount });

    // Переводим строки в monitor_results из price_change → no_change
    const ids = items.map(item => item.id);
    await markPriceChangesApplied(dbPath, ids).catch(e =>
      logger.warn('markPriceChangesApplied failed', { error: e.message })
    );

    // Обновляем in-memory результат чтобы UI сразу отразил изменение
    if (lastMonitoringResult && lastMonitoringResult.priceChanges) {
      const appliedSet = new Set(ids.map(String));
      const moved = lastMonitoringResult.priceChanges.filter(i => appliedSet.has(String(i.id)));
      lastMonitoringResult.priceChanges = lastMonitoringResult.priceChanges.filter(i => !appliedSet.has(String(i.id)));
      moved.forEach(i => {
        lastMonitoringResult.noChangeItems = lastMonitoringResult.noChangeItems || [];
        lastMonitoringResult.noChangeItems.push({ ...i, price: i.newPrice });
      });
    }
    const products = await getProductsByIds(dbPath, ids);
    const priceUpdateList = items.map(it => {
      const row = products.find(p => p.ID === it.id);
      return { id: it.id, name: row ? row.name_ow : it.id, newPrice: it.newPrice };
    });
    setLastPriceUpdates(priceUpdateList);

    let syncResult = { total: 0, success: 0, failed: 0, results: [] };
    if (config.siteApiUrl && config.bearerToken) {
      logger.info('Syncing to site');
      syncResult = await syncMultipleProducts(products, config.siteApiUrl, config.bearerToken);
      logger.info('Sync completed', syncResult);
    }
    setLastSyncResults(syncResult);
    res.json({ success: true, updated: updatedCount, sync: syncResult });
  } catch (error) {
    logger.error('Apply prices failed', { error: error.message });
    res.status(500).json({ 
      error: 'Ошибка применения изменений цен',
      details: error.message 
    });
  }
});

/**
 * POST /api/apply/status
 * Применяет изменение статуса и синхронизирует с сайтом
 */
router.post('/status', async (req, res) => {
  try {
    const { ids, salesStatus, tableType } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Параметр ids обязателен и должен быть непустым массивом' });
    }
    if (salesStatus === undefined) {
      return res.status(400).json({ error: 'Параметр salesStatus обязателен' });
    }

    const config = await loadConfig();
    const dbPath = config.dbPath;

    // ── ВЕТКА: Baikal (ids — это url_bai) ──────────────────────────────────
    if (tableType === 'baikal') {
      const { updateBaikalStatus } = await import('../../db/baikalDb.js');
      logger.info('Applying baikal status', { count: ids.length, salesStatus });
      const updatedCount = await updateBaikalStatus(dbPath, ids, salesStatus);
      logger.info('Baikal status updated', { updatedCount });
      return res.json({ success: true, updated: updatedCount, sync: { total: 0, success: 0, failed: 0 } });
    }

    // ── ВЕТКА: VSE4 ────────────────────────────────────────────────────────
    if (dbPath && dbPath.includes('diski_sait')) {
      process.env.DB_TABLE = 'VSE4';
    }
    logger.info('Applying status', { count: ids.length, salesStatus });
    const updatedCount = await updateStatus(dbPath, ids, salesStatus);
    logger.info('Status updated', { updatedCount });
    
    const products = await getProductsByIds(dbPath, ids);
    const statusUpdateList = products.map(row => ({
      id: row.ID,
      name: row.name_ow || row.ID,
      salesStatus
    }));
    setLastStatusUpdates(statusUpdateList);

    let syncResult = { total: 0, success: 0, failed: 0, results: [] };
    if (config.siteApiUrl && config.bearerToken) {
      logger.info('Syncing to site');
      syncResult = await syncMultipleProducts(products, config.siteApiUrl, config.bearerToken);
      logger.info('Sync completed', syncResult);
    }
    setLastSyncResults(syncResult);
    res.json({ success: true, updated: updatedCount, sync: syncResult });
  } catch (error) {
    logger.error('Apply status failed', { error: error.message });
    res.status(500).json({ 
      error: 'Ошибка применения изменений статуса',
      details: error.message 
    });
  }
});

/**
 * POST /api/apply/delete-site
 * Удаляет карточку товара с сайта по ID
 */
router.post('/delete-site', async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ error: 'Параметр productId обязателен' });
    }

    const config = await loadConfig();
    if (!config.siteApiUrl || !config.bearerToken) {
      return res.status(400).json({ error: 'Не настроен siteApiUrl или bearerToken. Проверьте Настройки.' });
    }

    logger.info('Deleting product from site', { productId });
    const result = await deleteProductFromSite(productId, config.siteApiUrl, config.bearerToken);
    logger.info('Delete result', result);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true, productId });
  } catch (error) {
    logger.error('Delete from site failed', { error: error.message });
    res.status(500).json({ error: 'Ошибка удаления', details: error.message });
  }
});

export default router;
