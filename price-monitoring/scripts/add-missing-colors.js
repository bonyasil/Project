/**
 * Добавляет недостающие цвета в справочник каталога
 * и заполняет color_code в VSE4 для всех оставшихся NULL-записей.
 *
 * Запуск: node scripts/add-missing-colors.js
 */

import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VSE4_DB    = path.resolve(__dirname, '../diski_sait.db');
const CATALOG_DB = path.resolve(__dirname, '../../disc-catalog/prisma/prisma/dev.db');

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, err => {
      if (err) return reject(err);
      resolve({
        all:   promisify(db.all.bind(db)),
        run:   promisify(db.run.bind(db)),
        close: promisify(db.close.bind(db)),
      });
    });
  });
}

// cuid-подобный ID для совместимости с Prisma
function makeId() {
  return 'c' + randomBytes(11).toString('base64url').slice(0, 24);
}

// ── 1. Новые цвета в справочник каталога ──────────────────────────────────────

const NEW_COLORS = [
  { name: 'HSML',  index: 'Hyper Silver Machine Lip' },
  { name: 'BML',   index: 'Black Machine Lip' },
  { name: 'DGM',   index: 'Dark Gunmetal' },
  { name: 'DGMMF', index: 'Dark Gunmetal Machine Face' },
];

console.log('=== Добавление цветов в справочник (disc-catalog) ===');
const catalogDb = await openDb(CATALOG_DB);

for (const color of NEW_COLORS) {
  const exists = await catalogDb.all('SELECT id FROM Color WHERE name = ?', [color.name]);
  if (exists.length > 0) {
    console.log(`  SKIP  ${color.name} — уже существует`);
    continue;
  }
  const id = makeId();
  const now = Date.now();
  await catalogDb.run(
    'INSERT INTO Color (id, name, `index`, createdAt) VALUES (?, ?, ?, ?)',
    [id, color.name, color.index, now]
  );
  console.log(`  ADD   ${color.name} | ${color.index}`);
}

await catalogDb.close();

// ── 2. Обновление color_code в VSE4 ───────────────────────────────────────────

/**
 * Правила сопоставления для оставшихся NULL-записей.
 * Ключ — нормализованное название (lower + trim), значение — код.
 */
const MANUAL_MAPPINGS = {
  'matte black':                    'MBL',   // то же что Matt Black
  'hyper silver machine lip':       'HSML',
  'black machine lip':              'BML',
  'dark gunmetal':                  'DGM',
  'dark gunmetal machine face':     'DGMMF',
  'black machine face clear coat':  'BMFCC', // исправленная запись
};

console.log('\n=== Обновление VSE4.color_code ===');
const vse4Db = await openDb(VSE4_DB);

const nullRows = await vse4Db.all(
  'SELECT ID, color FROM VSE4 WHERE color_code IS NULL AND color IS NOT NULL'
);

let updated = 0, skipped = [];

await vse4Db.run('BEGIN TRANSACTION');
try {
  for (const row of nullRows) {
    const key = row.color.toLowerCase().trim();
    const code = MANUAL_MAPPINGS[key] ?? null;
    if (code) {
      await vse4Db.run('UPDATE VSE4 SET color_code = ? WHERE ID = ?', [code, row.ID]);
      console.log(`  ${row.ID}: "${row.color}" → ${code}`);
      updated++;
    } else {
      skipped.push(row.color);
    }
  }
  await vse4Db.run('COMMIT');
} catch (err) {
  await vse4Db.run('ROLLBACK');
  await vse4Db.close();
  throw err;
}

await vse4Db.close();

console.log(`\nОбновлено: ${updated}`);
if (skipped.length) {
  const unique = [...new Set(skipped)];
  console.log(`Остались без кода (${unique.length}):`);
  unique.forEach(c => console.log(`  - "${c}"`));
}

console.log('\nГотово.');
