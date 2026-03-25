/**
 * API routes для генерации Excel-файла автозагрузки Авито
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { openDatabase } from '../../db/dbOperations.js';
import { loadConfig } from '../../config/configManager.js';
import { logger } from '../logger.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SETTINGS_PATH = path.join(__dirname, '../../../data/avito-settings.json');

// Порядок и маппинг столбцов итогового файла
const COLUMN_ORDER = [
  'Id', 'AvitoId', 'AvitoStatus', 'AvitoDateEnd', 'ListingFee',
  'Category', 'GoodsType', 'ProductType', 'Title', 'Description',
  'Condition', 'Price', 'ImageUrls', 'AddressID', 'Address',
  'EMail', 'ContactPhone', 'ContactMethod', 'AdType', 'CompanyName',
  'MultiItem', 'Quantity', 'RimBolts', 'RimBoltsDiameter', 'RimBrand',
  'RimDIA', 'RimDiameter', 'RimModel', 'RimOffset', 'RimType',
  'RimWidth', 'TargetAudience', 'TypeID'
];

// Поля из БД для таблицы VSE4
const DB_FIELDS_VSE4 = {
  Id:               'ID',
  AvitoId:          'avito_id',
  Title:            'name',
  Description:      'text_avito',
  Price:            'price_ow',
  ImageUrls:        'ImageUrls',
  RimBolts:         'count_otv',
  RimBoltsDiameter: 'diam_otv',
  RimBrand:         'maker',
  RimDIA:           'centr_otv',
  RimDiameter:      'diam',
  RimModel:         'model',
  RimOffset:        'vylet',
  RimType:          'type_disk',
  RimWidth:         'width',
};

// Поля из БД для таблицы baikal
const DB_FIELDS_BAIKAL = {
  Id:               'id',
  AvitoId:          'avito_id',
  Title:            'name',
  Description:      'text_avito',
  Price:            'price_ow',
  ImageUrls:        'ImageUrls',
  RimBolts:         'count_otv',
  RimBoltsDiameter: 'diam_otv',
  RimBrand:         'maker',
  RimDIA:           'centr_otv',
  RimDiameter:      'diam',
  RimModel:         'model',
  RimOffset:        'vylet',
  RimType:          'type_disk',
  RimWidth:         'width',
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveSettings(data) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * GET /api/avito-export/settings
 */
router.get('/settings', (req, res) => {
  res.json(loadSettings());
});

/**
 * PUT /api/avito-export/settings
 */
router.put('/settings', (req, res) => {
  try {
    const settings = req.body || {};
    saveSettings(settings);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/avito-export/export?table=VSE4|baikal
 * Генерирует Excel-файл и отдаёт его клиенту
 */
function mapRows(rows, DB_FIELDS, settings) {
  return rows.map(row => {
    const record = {};
    for (const col of COLUMN_ORDER) {
      if (DB_FIELDS[col]) {
        const val = row[DB_FIELDS[col]];
        record[col] = val !== null && val !== undefined ? val : '';
      } else {
        record[col] = settings[col] !== undefined ? settings[col] : '';
      }
    }
    return record;
  });
}

router.get('/export', async (req, res) => {
  try {
    const tableParam = req.query.table;
    const config = await loadConfig();
    let dbPath = config.dbPath || './data/products.db';
    if (!path.isAbsolute(dbPath)) dbPath = path.resolve(process.cwd(), dbPath);

    const db = await openDatabase(dbPath);
    let records;
    try {
      if (tableParam === 'all') {
        const [vse4Rows, baikalRows] = await Promise.all([
          db.all(`
            SELECT ID, avito_id, name, text_avito, price_ow, ImageUrls,
                   count_otv, diam_otv, maker, centr_otv, diam, model, vylet, type_disk, width
            FROM VSE4
            WHERE status_avito IS NULL OR status_avito != 'removed'
            ORDER BY ID
          `),
          db.all(`
            SELECT id, avito_id, name, text_avito, price_ow, ImageUrls,
                   count_otv, diam_otv, maker, centr_otv, diam, model, vylet, type_disk, width
            FROM baikal
            WHERE status_avito IS NULL OR status_avito != 'removed'
            ORDER BY id
          `)
        ]);
        const settings = loadSettings();
        records = [
          ...mapRows(vse4Rows, DB_FIELDS_VSE4, settings),
          ...mapRows(baikalRows, DB_FIELDS_BAIKAL, settings)
        ];
      } else {
        const table = tableParam === 'baikal' ? 'baikal' : 'VSE4';
        const DB_FIELDS = table === 'baikal' ? DB_FIELDS_BAIKAL : DB_FIELDS_VSE4;
        const rows = await db.all(table === 'baikal'
          ? `SELECT id, avito_id, name, text_avito, price_ow, ImageUrls,
                    count_otv, diam_otv, maker, centr_otv, diam, model, vylet, type_disk, width
             FROM baikal WHERE status_avito IS NULL OR status_avito != 'removed' ORDER BY id`
          : `SELECT ID, avito_id, name, text_avito, price_ow, ImageUrls,
                    count_otv, diam_otv, maker, centr_otv, diam, model, vylet, type_disk, width
             FROM VSE4 WHERE status_avito IS NULL OR status_avito != 'removed' ORDER BY ID`
        );
        records = mapRows(rows, DB_FIELDS, loadSettings());
      }
    } finally {
      await db.close();
    }

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Объявления');

    ws.columns = COLUMN_ORDER.map(col => ({
      header: col,
      key: col,
      width: col.length < 10 ? 12 : col.length + 4
    }));
    ws.getRow(1).font = { bold: true };
    for (const record of records) ws.addRow(record);

    const label = tableParam === 'all' ? 'all' : (tableParam === 'baikal' ? 'baikal' : 'VSE4');
    const filename = `avito_${label}_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();

    logger.info('avito-export done', { table: label, rows: records.length });
  } catch (e) {
    logger.error('avito-export failed', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

export default router;
