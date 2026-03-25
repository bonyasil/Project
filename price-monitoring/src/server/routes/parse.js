/**
 * API: только парсинг страницы Avito (без сравнения с БД)
 * POST /api/parse/run { alias } → { items: [{ name, price, url }] }
 */

import express from 'express';
import { loadAvitoSources, getUrlByAlias } from '../../config/avitoSources.js';
import { parseAvitoPage } from '../../parser/avitoParser.js';
import { logger } from '../logger.js';

const router = express.Router();

router.post('/run', async (req, res) => {
  try {
    const { alias, avitoUrl: urlFromBody, headless = false } = req.body;
    let url = urlFromBody && typeof urlFromBody === 'string' ? urlFromBody.trim() : null;
    if (!url && alias && typeof alias === 'string' && alias.trim()) {
      const sources = await loadAvitoSources();
      url = getUrlByAlias(sources, alias.trim());
    }
    if (!url) {
      return res.status(400).json({
        error: 'Укажите псевдоним (alias) и сохраните конфигурацию или передайте ссылку (avitoUrl).'
      });
    }
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Невалидный URL страницы Avito.' });
    }
    logger.info('Parse run', { alias: alias || null, headless });
    const avitoItems = await parseAvitoPage(url, { headless });
    const items = avitoItems.map(it => ({ name: it.name, price: it.price, url: it.url }));
    logger.info('Parse completed', { alias, total: items.length });
    res.json({ items, total: items.length });
  } catch (error) {
    logger.error('Parse failed', { alias: req.body?.alias, error: error.message });
    res.status(500).json({
      error: 'Ошибка парсинга страницы Avito',
      details: error.message
    });
  }
});

export default router;
