/**
 * Скрипт исправления кириллических символов в названиях цветов.
 *
 * Исправляет обе базы:
 *   1. diski_sait.db  — VSE4.color
 *   2. disc-catalog dev.db — Color.index (справочник)
 *
 * После исправления пересчитывает VSE4.color_code по обновлённому справочнику.
 *
 * Запуск: node scripts/fix-cyrillic-colors.js
 */

import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VSE4_DB    = path.resolve(__dirname, '../diski_sait.db');
const CATALOG_DB = path.resolve(__dirname, '../../disc-catalog/prisma/prisma/dev.db');

/** Карта замен: кириллический символ → похожий латинский */
const CYRILLIC_TO_LATIN = {
  'а': 'a', // U+0430
  'В': 'B', // U+0412
  'с': 'c', // U+0441
  'Е': 'E', // U+0415
  'е': 'e', // U+0435
  'М': 'M', // U+041C
  'о': 'o', // U+043E
  'О': 'O', // U+041E
  'р': 'p', // U+0440
  'С': 'C', // U+0421
};

function replaceCyrillic(str) {
  if (!str) return str;
  return str.split('').map(ch => CYRILLIC_TO_LATIN[ch] ?? ch).join('');
}

function hasCyrillic(str) {
  if (!str) return false;
  return str.split('').some(ch => ch in CYRILLIC_TO_LATIN);
}

function openDb(filePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, err => {
      if (err) return reject(err);
      resolve({
        all: promisify(db.all.bind(db)),
        run: promisify(db.run.bind(db)),
        close: promisify(db.close.bind(db)),
        serialize: (fn) => db.serialize(fn),
      });
    });
  });
}

// ── 1. Справочник Color в disc-catalog ────────────────────────────────────────

console.log('=== Справочник Color (disc-catalog) ===');
const catalogDb = await openDb(CATALOG_DB);
const colorRows = await catalogDb.all('SELECT id, name, `index` FROM Color');

let colorFixed = 0;
for (const row of colorRows) {
  if (hasCyrillic(row.index)) {
    const cleaned = replaceCyrillic(row.index);
    await catalogDb.run('UPDATE Color SET `index` = ? WHERE id = ?', [cleaned, row.id]);
    console.log(`  ${row.name}: "${row.index}" → "${cleaned}"`);
    row.index = cleaned;
    colorFixed++;
  }
}
console.log(`Исправлено Color.index: ${colorFixed} из ${colorRows.length}\n`);
await catalogDb.close();

// Актуальный справочник после очистки
const colorTable = colorRows; // уже обновлены in-place

// ── 2. VSE4.color в diski_sait.db ─────────────────────────────────────────────

console.log('=== VSE4.color (diski_sait.db) ===');
const vse4Db = await openDb(VSE4_DB);
const vse4Rows = await vse4Db.all('SELECT ID, color FROM VSE4 WHERE color IS NOT NULL');

function findCode(colorName) {
  if (!colorName) return null;
  const needle = colorName.toLowerCase().trim();
  return colorTable.find(c => c.index.toLowerCase().trim() === needle)?.name ?? null;
}

let vse4ColorFixed = 0, codeSet = 0;
const codeMissed = [];

await vse4Db.run('BEGIN TRANSACTION');
try {
  for (const row of vse4Rows) {
    let color = row.color;

    // Исправляем кириллицу в названии
    if (hasCyrillic(color)) {
      const cleaned = replaceCyrillic(color);
      await vse4Db.run('UPDATE VSE4 SET color = ? WHERE ID = ?', [cleaned, row.ID]);
      console.log(`  ${row.ID}: "${color}" → "${cleaned}"`);
      color = cleaned;
      vse4ColorFixed++;
    }

    // Пересчитываем color_code
    const code = findCode(color);
    await vse4Db.run('UPDATE VSE4 SET color_code = ? WHERE ID = ?', [code, row.ID]);
    if (code) codeSet++;
    else codeMissed.push(color);
  }
  await vse4Db.run('COMMIT');
} catch (err) {
  await vse4Db.run('ROLLBACK');
  await vse4Db.close();
  throw err;
}

await vse4Db.close();

console.log(`\nИсправлено VSE4.color: ${vse4ColorFixed}`);
console.log(`Заполнено VSE4.color_code: ${codeSet} из ${vse4Rows.length}`);

const uniqueMissed = [...new Set(codeMissed)];
if (uniqueMissed.length) {
  console.log(`\nНе найдены в справочнике (color_code = NULL):`);
  uniqueMissed.forEach(c => console.log(`  - "${c}"`));
  console.log('\nДобавьте эти цвета в таблицу Color каталога или оставьте NULL для ручной привязки.');
}

console.log('\nГотово.');
