/**
 * API routes для работы с БД сайта через SSH/SCP
 */

import express from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDatabase } from '../../db/dbOperations.js';
import { loadConfig } from '../../config/configManager.js';
import { logger } from '../logger.js';

const router = express.Router();

// Таблицы доступные для синхронизации (в порядке отображения в UI)
export const SYNCABLE_TABLES = ['VSE4', 'photo', 'blog_posts', 'blog_images', 'gallery', 'demo_auto'];

function runCmd(cmd, timeout = 60000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve(stdout.trim());
    });
  });
}

async function getSshCfg() {
  const config = await loadConfig();
  const { sshHost, sshUser, sshKeyPath, sshDbPath, dbPath } = config;
  if (!sshHost || !sshUser || !sshKeyPath || !sshDbPath) {
    throw new Error('SSH не настроен. Заполните Host, User, Key Path и Remote DB Path в Настройках.');
  }
  if (!dbPath) throw new Error('Локальный путь к БД (DB Path) не указан в Настройках.');
  return config;
}

/**
 * Генерирует SQL для замены содержимого одной таблицы.
 * Использует DELETE + INSERT в транзакции — не трогает схему таблицы на удалённом сервере.
 */
async function buildTableSql(dbPath, tableName, excludeCols = []) {
  const db = await openDatabase(dbPath);
  try {
    const rows = await db.all(`SELECT * FROM "${tableName}"`);
    if (rows.length === 0) {
      return `-- ${tableName}: нет данных\nDELETE FROM "${tableName}";\n`;
    }

    // Фильтруем исключённые столбцы
    const allCols = Object.keys(rows[0]);
    const cols = allCols.filter(c => !excludeCols.includes(c));

    const lines = [`DELETE FROM "${tableName}";`];

    for (const row of rows) {
      const values = cols.map(c => {
        const v = row[c];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      lines.push(`INSERT INTO "${tableName}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});`);
    }

    return lines.join('\n') + '\n';
  } finally {
    await db.close();
  }
}

/**
 * GET /api/site-db/tables
 * Возвращает список таблиц доступных для синхронизации
 */
router.get('/tables', (req, res) => {
  res.json({ tables: SYNCABLE_TABLES });
});

/**
 * POST /api/site-db/test
 * Проверяет SSH-соединение
 */
router.post('/test', async (req, res) => {
  try {
    const cfg = await getSshCfg();
    const key = cfg.sshKeyPath.replace(/\\/g, '/');
    const port = cfg.sshPort || 22;
    const cmd = `ssh -i "${key}" -p ${port} -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=10 ${cfg.sshUser}@${cfg.sshHost} "echo ok"`;
    await runCmd(cmd, 15000);
    res.json({ success: true, message: `Соединение с ${cfg.sshHost} установлено успешно` });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Получает список колонок таблицы на удалённой БД через SSH.
 * Копирует Python-скрипт файлом через SCP (избегает проблем с экранированием).
 * Возвращает Set<string> или null при ошибке.
 */
async function getRemoteTableCols(cfg, tableName) {
  const key  = cfg.sshKeyPath.replace(/\\/g, '/');
  const port = cfg.sshPort || 22;
  const target = `${cfg.sshUser}@${cfg.sshHost}`;
  const sshBase = `-i "${key}" -p ${port} -o StrictHostKeyChecking=no -o BatchMode=yes`;
  const tmpScript  = path.join(os.tmpdir(), `cols_${Date.now()}.py`);
  const remoteTmp  = `/tmp/cols_${Date.now()}.py`;
  try {
    const script = [
      'import sqlite3',
      `conn = sqlite3.connect(${JSON.stringify(cfg.sshDbPath)})`,
      `rows = conn.execute('PRAGMA table_info("${tableName}")').fetchall()`,
      `print(",".join(r[1] for r in rows))`,
      'conn.close()'
    ].join('\n');
    fs.writeFileSync(tmpScript, script, 'utf8');
    await runCmd(`scp -i "${key}" -P ${port} -o StrictHostKeyChecking=no -o BatchMode=yes "${tmpScript}" "${target}:${remoteTmp}"`, 15000);
    const out = await runCmd(`ssh ${sshBase} ${target} "python3 '${remoteTmp}'; rm -f '${remoteTmp}'"`, 15000);
    const cols = out.trim().split(',').map(c => c.trim()).filter(Boolean);
    if (cols.length === 0) return null;
    logger.info('getRemoteTableCols', { table: tableName, cols });
    return new Set(cols);
  } catch (e) {
    logger.warn('getRemoteTableCols failed', { table: tableName, error: e.message });
    return null;
  } finally {
    try { fs.unlinkSync(tmpScript); } catch (_) {}
  }
}

/**
 * POST /api/site-db/sync-tables
 * Синхронизирует выбранные таблицы: генерирует SQL дамп локально,
 * копирует на сервер через SCP, выполняет через SSH.
 * Body: { tables: ['VSE4', ...] }
 */
router.post('/sync-tables', async (req, res) => {
  const { tables } = req.body || {};
  const excludeCols = [];
  if (!tables || !Array.isArray(tables) || tables.length === 0) {
    return res.status(400).json({ error: 'Укажите массив tables для синхронизации' });
  }

  // Проверяем что запрошены только разрешённые таблицы
  const invalid = tables.filter(t => !SYNCABLE_TABLES.includes(t));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Недопустимые таблицы: ${invalid.join(', ')}` });
  }

  try {
    const cfg = await getSshCfg();
    const key  = cfg.sshKeyPath.replace(/\\/g, '/');
    const port = cfg.sshPort || 22;
    const target = `${cfg.sshUser}@${cfg.sshHost}`;
    const sshBase = `-i "${key}" -p ${port} -o StrictHostKeyChecking=no -o BatchMode=yes`;
    const localSiteDbPath = cfg.localSiteDbPath || '';

    // Открываем локальную БД сайта если путь задан
    let localSiteDb = null;
    if (localSiteDbPath && fs.existsSync(localSiteDbPath)) {
      localSiteDb = await openDatabase(localSiteDbPath);
    }

    const results = [];

    try {
      for (const table of tables) {
        logger.info('Sync table: generating SQL', { table });
        try {
          // 1. Определяем столбцы удалённой таблицы и исключаем лишние
          const remoteCols = await getRemoteTableCols(cfg, table);
          let tableExcludeCols = excludeCols;
          if (remoteCols && remoteCols.size > 0) {
            const localDb = await openDatabase(cfg.dbPath);
            let localCols = [];
            try {
              const row = await localDb.get(`SELECT * FROM "${table}" LIMIT 1`);
              localCols = row ? Object.keys(row) : [];
            } finally {
              await localDb.close();
            }
            tableExcludeCols = localCols.filter(c => !remoteCols.has(c));
            if (tableExcludeCols.length > 0) {
              logger.info('Sync table: auto-excluding cols missing on remote', { table, excluded: tableExcludeCols });
            }
          }

          // 2. Генерируем SQL для таблицы
          const sql = `BEGIN TRANSACTION;\n${await buildTableSql(cfg.dbPath, table, tableExcludeCols)}\nCOMMIT;\n`;
          const rowCount = (sql.match(/^INSERT /gm) || []).length;

          // 2. Синхронизируем на VPS через SCP + SSH
          const tmpFile = path.join(os.tmpdir(), `sync_${table}_${Date.now()}.sql`);
          fs.writeFileSync(tmpFile, sql, 'utf8');
          try {
            const remoteTmp = `/tmp/sync_${table}_${Date.now()}.sql`;
            await runCmd(`scp -i "${key}" -P ${port} -o StrictHostKeyChecking=no -o BatchMode=yes "${tmpFile}" "${target}:${remoteTmp}"`, 60000);
            await runCmd(`ssh ${sshBase} ${target} "python3 -c \\"import sqlite3,sys; conn=sqlite3.connect('${cfg.sshDbPath}'); conn.executescript(open('${remoteTmp}').read()); conn.commit(); conn.close()\\" && rm '${remoteTmp}'"`, 60000);
          } finally {
            try { fs.unlinkSync(tmpFile); } catch (_) {}
          }

          // 3. Синхронизируем в локальную БД сайта (если настроена)
          if (localSiteDb) {
            const rows = await (await openDatabase(cfg.dbPath)).all(`SELECT * FROM "${table}"`);
            const localDb = localSiteDb;
            await localDb.run('BEGIN TRANSACTION');
            try {
              await localDb.run(`DELETE FROM "${table}"`);
              if (rows.length > 0) {
                const cols = Object.keys(rows[0]).filter(c => !tableExcludeCols.includes(c));
                for (const row of rows) {
                  const values = cols.map(c => {
                    const v = row[c];
                    if (v === null || v === undefined) return null;
                    return v;
                  });
                  const placeholders = cols.map(() => '?').join(', ');
                  await localDb.run(
                    `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
                    values
                  );
                }
              }
              await localDb.run('COMMIT');
            } catch (e) {
              await localDb.run('ROLLBACK');
              throw e;
            }
            logger.info('Sync table: local site DB updated', { table, rows: rows.length });
          }

          logger.info('Sync table: done', { table, rows: rowCount });
          results.push({ table, success: true, rows: rowCount });
        } catch (tableErr) {
          logger.error('Sync table failed', { table, error: tableErr.message });
          results.push({ table, success: false, error: tableErr.message });
        }
      }
    } finally {
      if (localSiteDb) await localSiteDb.close().catch(() => {});
    }

    // Перегенерируем products-db.json и копируем на VPS
    let jsonRegenerated = false;
    if (tables.includes('VSE4')) {
      try {
        // 1. Генерируем JSON локально (если есть скрипт)
        let localJsonPath = null;
        if (localSiteDbPath) {
          const scriptPath = path.join(path.dirname(localSiteDbPath), 'scripts', 'export_products_json.py');
          if (fs.existsSync(scriptPath)) {
            await runCmd(`python "${scriptPath}"`, 30000);
            localJsonPath = path.join(path.dirname(localSiteDbPath), 'lib', 'products-db.json');
            logger.info('products-db.json regenerated locally');
          }
        }

        // 2. Копируем JSON на VPS
        if (localJsonPath && fs.existsSync(localJsonPath)) {
          const localJson = localJsonPath.replace(/\\/g, '/');
          const remoteJson = cfg.sshDbPath.replace('diski_sait.db', 'lib/products-db.json');
          await runCmd(`scp -i "${key}" -P ${port} -o StrictHostKeyChecking=no -o BatchMode=yes "${localJson}" "${target}:${remoteJson}"`, 30000);
          logger.info('products-db.json uploaded to VPS', { remoteJson });
        }

        jsonRegenerated = true;
      } catch (e) {
        logger.warn('Failed to regenerate/upload products-db.json', { error: e.message });
      }
    }

    // Перезапускаем Next.js на VPS через pm2
    let pm2Restarted = false;
    if (tables.includes('VSE4')) {
      try {
        const sshBase = `-i "${key}" -p ${port} -o StrictHostKeyChecking=no -o BatchMode=yes`;
        await runCmd(`ssh ${sshBase} ${target} "pm2 restart all --silent"`, 20000);
        pm2Restarted = true;
        logger.info('pm2 restarted on VPS');
      } catch (e) {
        logger.warn('pm2 restart failed', { error: e.message });
      }
    }

    const failed = results.filter(r => !r.success);
    const extras = [
      localSiteDb ? 'локальный сайт' : '',
      jsonRegenerated ? 'JSON обновлён' : '',
      pm2Restarted ? 'сайт перезапущен' : ''
    ].filter(Boolean).join(', ');

    res.json({
      success: failed.length === 0,
      results,
      localSynced: !!localSiteDb,
      jsonRegenerated,
      pm2Restarted,
      message: failed.length === 0
        ? `✅ Синхронизировано таблиц: ${results.length}${extras ? ` (${extras})` : ''}`
        : `Ошибка в таблицах: ${failed.map(r => r.table).join(', ')}`
    });
  } catch (e) {
    logger.error('Sync tables failed', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

export default router;
