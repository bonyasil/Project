/**
 * Роуты для раздела «Новые объявления».
 *
 * POST   /api/new-items/parse              — запуск парсера по списку URL
 * POST   /api/new-items/attach-photos      — прикрепить папку с фото к строке
 * GET    /api/new-items/list/:alias        — строки из *_new (все или по batch_id)
 * GET    /api/new-items/batches/:alias     — список пакетов (batch_id + статистика)
 * PATCH  /api/new-items/item/:alias/:rowid — обновить поля строки
 * DELETE /api/new-items/clear/:alias       — удалить успешно перенесённые строки
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { readdirSync, statSync } from 'fs';
import { logger } from '../logger.js';
import { parseAvitoListings, deduplicateUrls } from '../../parser/avitoListingParser.js';
import {
  ensureNewTable,
  insertNewItems,
  getNewItems,
  getBatches,
  updateNewItem,
  clearTransferredItems,
  exportNewItems,
} from '../../db/newItemsDb.js';

const router = Router();

// Активная сессия парсинга (только одна одновременно)
let activeParseJob = null;

// ── POST /parse ───────────────────────────────────────────────────────────────

router.post('/parse', async (req, res) => {
  const { alias, urls, dbPath } = req.body;

  if (!alias || !['VSE4', 'baikal'].includes(alias)) {
    return res.status(400).json({ error: 'alias должен быть VSE4 или baikal' });
  }
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls: непустой массив строк' });
  }
  if (!dbPath) {
    return res.status(400).json({ error: 'dbPath обязателен' });
  }
  if (activeParseJob) {
    return res.status(409).json({ error: 'Парсинг уже запущен. Дождитесь завершения.' });
  }

  const deduplicated = deduplicateUrls(urls);
  const batchId = randomUUID();

  logger.info('new-items/parse: старт', { alias, total: deduplicated.length, batchId });

  activeParseJob = batchId;

  // Запускаем асинхронно, чтобы не блокировать HTTP-соединение
  // Результат записывается в БД по мере парсинга
  const jobPromise = (async () => {
    await ensureNewTable(dbPath, alias);

    const results = await parseAvitoListings(
      deduplicated.map(u => u.original),
      (current, total, item) => {
        logger.info(`new-items/parse: ${current}/${total}`, {
          url: item.url_vse ?? item.url_bai,
          name: item.name,
          error: item._error,
        });
      }
    );

    await insertNewItems(dbPath, alias, batchId, results);
    logger.info('new-items/parse: завершён', { batchId, inserted: results.length });
    return results;
  })();

  // Отвечаем сразу — клиент будет поллить /list для получения результатов
  res.json({
    ok: true,
    batchId,
    total: deduplicated.length,
    message: `Парсинг запущен. batch_id: ${batchId}`,
  });

  // После завершения сбрасываем флаг
  jobPromise.catch(err => {
    logger.error('new-items/parse: ошибка', { error: err.message });
  }).finally(() => {
    activeParseJob = null;
  });
});

// ── POST /attach-photos ───────────────────────────────────────────────────────

router.post('/attach-photos', async (req, res) => {
  const { alias, rowid, dbPath, folderPath } = req.body;

  if (!alias || !['VSE4', 'baikal'].includes(alias)) {
    return res.status(400).json({ error: 'alias должен быть VSE4 или baikal' });
  }
  if (!rowid) return res.status(400).json({ error: 'rowid обязателен' });
  if (!dbPath) return res.status(400).json({ error: 'dbPath обязателен' });
  if (!folderPath) return res.status(400).json({ error: 'folderPath обязателен' });

  const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);

  let filePaths;
  try {
    const sep = folderPath.includes('\\') ? '\\' : '/';
    filePaths = readdirSync(folderPath).filter(name => {
      const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
      try {
        return IMAGE_EXT.has(ext) && statSync(`${folderPath}${sep}${name}`).isFile();
      } catch {
        return false;
      }
    }).map(name => `${folderPath}${sep}${name}`);
  } catch (err) {
    return res.status(400).json({ error: `Не удалось прочитать папку: ${err.message}` });
  }

  if (filePaths.length === 0) {
    return res.status(400).json({ error: 'В папке не найдено файлов изображений (jpg, png, webp …)' });
  }

  try {
    await updateNewItem(dbPath, alias, parseInt(rowid), {
      link_foto: filePaths.join('|'),
      photo_status: 'attached',
    });
    res.json({ ok: true, files: filePaths });
  } catch (err) {
    logger.error('new-items/attach-photos: ошибка', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /status — текущий статус парсинга ─────────────────────────────────────

router.get('/status', (_req, res) => {
  res.json({ running: !!activeParseJob, batchId: activeParseJob });
});

// ── GET /list/:alias ──────────────────────────────────────────────────────────

router.get('/list/:alias', async (req, res) => {
  const { alias } = req.params;
  const { dbPath, batchId } = req.query;

  if (!dbPath) return res.status(400).json({ error: 'dbPath обязателен' });

  try {
    await ensureNewTable(dbPath, alias);
    const items = await getNewItems(dbPath, alias, batchId || null);
    res.json({ items });
  } catch (err) {
    logger.error('new-items/list: ошибка', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /batches/:alias ───────────────────────────────────────────────────────

router.get('/batches/:alias', async (req, res) => {
  const { alias } = req.params;
  const { dbPath } = req.query;

  if (!dbPath) return res.status(400).json({ error: 'dbPath обязателен' });

  try {
    await ensureNewTable(dbPath, alias);
    const batches = await getBatches(dbPath, alias);
    res.json({ batches });
  } catch (err) {
    logger.error('new-items/batches: ошибка', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /item/:alias/:rowid ─────────────────────────────────────────────────

router.patch('/item/:alias/:rowid', async (req, res) => {
  const { alias, rowid } = req.params;
  const { dbPath, fields } = req.body;

  if (!dbPath) return res.status(400).json({ error: 'dbPath обязателен' });
  if (!fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'fields: объект с обновляемыми полями' });
  }

  // Белый список полей, которые разрешено обновлять через этот эндпоинт
  const ALLOWED = new Set([
    'nacenka', 'price_ow', 'link_foto', 'text_avito',
    'photo_status', 'site_status', 'local_status', 'error_message',
    'color', 'condition', 'name', 'maker', 'model',
    'width', 'diam', 'vylet', 'count_otv', 'diam_otv', 'centr_otv',
    'type_disk', 'type_good', 'price_vse', 'price_bai',
  ]);

  const filtered = Object.fromEntries(
    Object.entries(fields).filter(([k]) => ALLOWED.has(k))
  );

  if (Object.keys(filtered).length === 0) {
    return res.status(400).json({ error: 'Нет допустимых полей для обновления' });
  }

  try {
    await updateNewItem(dbPath, alias, parseInt(rowid), filtered);
    res.json({ ok: true });
  } catch (err) {
    logger.error('new-items/item PATCH: ошибка', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /export/:alias ───────────────────────────────────────────────────────

router.post('/export/:alias', async (req, res) => {
  const { alias } = req.params;
  const { dbPath, rowids } = req.body;

  if (!dbPath) return res.status(400).json({ error: 'dbPath обязателен' });
  if (!Array.isArray(rowids) || rowids.length === 0) {
    return res.status(400).json({ error: 'rowids: непустой массив' });
  }

  try {
    const result = await exportNewItems(dbPath, alias, rowids.map(Number));
    logger.info('new-items/export: завершён', { alias, exported: result.exported });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('new-items/export: ошибка', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /clear/:alias ──────────────────────────────────────────────────────

router.delete('/clear/:alias', async (req, res) => {
  const { alias } = req.params;
  const { dbPath, batchId } = req.body;

  if (!dbPath) return res.status(400).json({ error: 'dbPath обязателен' });

  try {
    const deleted = await clearTransferredItems(dbPath, alias, batchId || null);
    res.json({ ok: true, deleted });
  } catch (err) {
    logger.error('new-items/clear: ошибка', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
