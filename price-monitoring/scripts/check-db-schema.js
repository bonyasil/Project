/**
 * Проверка структуры БД: список таблиц и колонок
 * Запуск: node scripts/check-db-schema.js <path-to-db>
 */
import sqlite3 from 'sqlite3';

const dbPath = process.argv[2] || 'C:\\Users\\PC\\Desktop\\Project\\b_ZLmTCuIHnIf-1772217503700\\diski_sait.db';

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Open error:', err.message);
    process.exit(1);
  }
});

db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
  if (err) {
    console.error(err.message);
    db.close();
    process.exit(1);
  }
  console.log('Tables:', tables.map(t => t.name).join(', '));
  if (tables.length === 0) {
    db.close();
    return;
  }
  const first = tables[0].name;
  db.all(`PRAGMA table_info(${first})`, (err2, cols) => {
    if (err2) {
      console.error(err2.message);
      db.close();
      return;
    }
    console.log(`Columns of "${first}":`, cols.map(c => c.name).join(', '));
    db.close();
  });
});
