/**
 * Генератор текста для объявлений Avito.
 *
 * GET  /api/text-gen/config           — получить конфиг генератора
 * PUT  /api/text-gen/config           — сохранить конфиг
 * POST /api/text-gen/generate         — сгенерировать текст для одной строки
 * POST /api/text-gen/generate-batch   — сгенерировать текст для всех строк батча
 */

import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';
import { getNewItems, updateNewItem, ensureNewTable } from '../../db/newItemsDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../../../text-gen-config.json');

const DEFAULT_CONFIG = {
  probability: 30,
  sentences: [],
};

// ── Гомоглифы кириллица → латиница ───────────────────────────────────────────

const CYR_TO_LAT = {
  'а':'a','е':'e','о':'o','р':'p','с':'c','х':'x','у':'y',
  'А':'A','В':'B','С':'C','Е':'E','Н':'H','К':'K','М':'M','О':'O','Р':'P','Т':'T','Х':'X',
};

function applyHomoglyphs(text, probabilityPct) {
  if (!probabilityPct) return text;
  return text.split('').map(ch => {
    const lat = CYR_TO_LAT[ch];
    return (lat && Math.random() * 100 < probabilityPct) ? lat : ch;
  }).join('');
}

// ── Конфиг ────────────────────────────────────────────────────────────────────

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// ── Генерация текста для одной строки ─────────────────────────────────────────

// Поля таблицы, которые можно вставлять в предложение
const SOURCE_FIELDS = {
  color: { label: 'Цвет',        defaultPrefix: 'Цвет - ' },
  name:  { label: 'Наименование', defaultPrefix: ''        },
};

function generateTextForItem(item, cfg) {
  const parts = (cfg.sentences || []).map(s => {
    let text;
    // Нормализация старого формата isColor → sourceField
    const sourceField = s.sourceField ?? (s.isColor ? 'color' : 'text_replace');
    if (SOURCE_FIELDS[sourceField]) {
      // Поле из таблицы (color, name, …) — замена не применяется
      const prefix = s.prefix ?? SOURCE_FIELDS[sourceField].defaultPrefix;
      text = `${prefix}${item[sourceField] ?? ''}`;
    } else {
      const variants = s.variants || [];
      if (variants.length === 0) return '';
      text = variants[Math.floor(Math.random() * variants.length)];
      // Замена только для типа text_replace ('' — обратная совместимость)
      if (sourceField === 'text_replace' || sourceField === '') {
        text = applyHomoglyphs(text, cfg.probability ?? 0);
      }
    }
    // Поддержка как массива тегов, так и старого формата одного тега
    const tags = Array.isArray(s.tags) ? s.tags : (s.tag ? [s.tag] : []);
    for (const tag of tags.slice().reverse()) {
      text = `<${tag}>${text}</${tag}>`;
    }
    return text;
  }).filter(Boolean);

  return parts.join('\n');
}

// ── Роуты ─────────────────────────────────────────────────────────────────────

const router = Router();

router.get('/config', (_req, res) => {
  res.json(loadConfig());
});

router.put('/config', (req, res) => {
  const cfg = req.body;
  if (!cfg || typeof cfg !== 'object') {
    return res.status(400).json({ error: 'Ожидается объект конфига' });
  }
  try {
    saveConfig(cfg);
    res.json({ ok: true });
  } catch (err) {
    logger.error('text-gen/config PUT: ошибка', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate', async (req, res) => {
  const { alias, rowid, dbPath } = req.body;
  if (!alias || !rowid || !dbPath) {
    return res.status(400).json({ error: 'alias, rowid, dbPath обязательны' });
  }

  try {
    const cfg = loadConfig();
    await ensureNewTable(dbPath, alias);
    const items = await getNewItems(dbPath, alias);
    const item = items.find(i => i.rowid === parseInt(rowid));
    if (!item) return res.status(404).json({ error: 'Строка не найдена' });

    const text = generateTextForItem(item, cfg);
    await updateNewItem(dbPath, alias, parseInt(rowid), { text_avito: text });
    res.json({ ok: true, text });
  } catch (err) {
    logger.error('text-gen/generate: ошибка', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate-batch', async (req, res) => {
  const { alias, dbPath, batchId } = req.body;
  if (!alias || !dbPath) {
    return res.status(400).json({ error: 'alias, dbPath обязательны' });
  }

  try {
    const cfg = loadConfig();
    await ensureNewTable(dbPath, alias);
    const items = await getNewItems(dbPath, alias, batchId || null);

    let count = 0;
    for (const item of items) {
      if (item.error_message) continue;
      const text = generateTextForItem(item, cfg);
      await updateNewItem(dbPath, alias, item.rowid, { text_avito: text });
      count++;
    }

    res.json({ ok: true, count });
  } catch (err) {
    logger.error('text-gen/generate-batch: ошибка', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
