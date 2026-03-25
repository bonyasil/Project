/**
 * Модуль операций с базой данных
 */

import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import { getTableName, getSalesStatusColumn, getSelectColumnsForIds } from './dbSchema.js';

/**
 * Открывает соединение с БД и возвращает промисифицированный объект
 * @param {string} dbPath - Путь к БД
 * @returns {Promise<Object>} Объект БД с промисифицированными методами
 */
export async function openDatabase(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(new Error(`Ошибка подключения к БД: ${err.message}`));
        return;
      }
      
      // Промисифицируем методы
      const dbWrapper = {
        run: promisify(db.run.bind(db)),
        get: promisify(db.get.bind(db)),
        all: promisify(db.all.bind(db)),
        prepare: (sql) => {
          const stmt = db.prepare(sql);
          return {
            run: promisify(stmt.run.bind(stmt)),
            get: promisify(stmt.get.bind(stmt)),
            all: promisify(stmt.all.bind(stmt)),
            finalize: promisify(stmt.finalize.bind(stmt))
          };
        },
        close: promisify(db.close.bind(db))
      };
      
      resolve(dbWrapper);
    });
  });
}

/**
 * Обновляет цены товаров в БД
 * @param {string} dbPath - Путь к БД
 * @param {Array} items - Массив товаров [{id, newPrice, nacenka}]
 * @returns {Promise<number>} Количество обновлённых записей
 */
export async function updatePrices(dbPath, items) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
      if (err) {
        reject(new Error(`Ошибка подключения к БД: ${err.message}`));
        return;
      }
    });
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          db.close();
          reject(new Error(`Ошибка начала транзакции: ${err.message}`));
          return;
        }
      });
      
      let updatedCount = 0;
      let hasError = false;
      
      const updatePromises = items.map((item) => {
        return new Promise((resolveUpdate, rejectUpdate) => {
          // Расчёт price_ow = price_vse + nacenka
          const priceOw = item.newPrice + (item.nacenka || 0);
          
          const table = getTableName();
          const query = `
            UPDATE ${table}
            SET price_vse = ?, price_ow = ?
            WHERE ID = ?
          `;
          
          db.run(query, [item.newPrice, priceOw, item.id], function(err) {
            if (err) {
              rejectUpdate(err);
            } else {
              updatedCount += this.changes;
              resolveUpdate();
            }
          });
        });
      });
      
      Promise.all(updatePromises)
        .then(() => {
          db.run('COMMIT', (err) => {
            db.close();
            if (err) {
              reject(new Error(`Ошибка коммита транзакции: ${err.message}`));
            } else {
              resolve(updatedCount);
            }
          });
        })
        .catch((err) => {
          db.run('ROLLBACK', () => {
            db.close();
            reject(new Error(`Ошибка обновления цен: ${err.message}`));
          });
        });
    });
  });
}

/**
 * Обновляет статус продажи товаров
 * @param {string} dbPath - Путь к БД
 * @param {Array<string>} ids - Массив ID товаров
 * @param {string} salesStatus - Новый статус (например, 'removed')
 * @returns {Promise<number>} Количество обновлённых записей
 */
export async function updateStatus(dbPath, ids, salesStatus) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
      if (err) {
        reject(new Error(`Ошибка подключения к БД: ${err.message}`));
        return;
      }
    });
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          db.close();
          reject(new Error(`Ошибка начала транзакции: ${err.message}`));
          return;
        }
      });
      
      const table = getTableName();
      const statusCol = getSalesStatusColumn();
      const placeholders = ids.map(() => '?').join(',');
      const query = `
        UPDATE ${table}
        SET ${statusCol} = ?
        WHERE ID IN (${placeholders})
      `;
      
      db.run(query, [salesStatus, ...ids], function(err) {
        if (err) {
          db.run('ROLLBACK', () => {
            db.close();
            reject(new Error(`Ошибка обновления статуса: ${err.message}`));
          });
        } else {
          const updatedCount = this.changes;
          db.run('COMMIT', (err) => {
            db.close();
            if (err) {
              reject(new Error(`Ошибка коммита транзакции: ${err.message}`));
            } else {
              resolve(updatedCount);
            }
          });
        }
      });
    });
  });
}

/**
 * Получает товары по ID для синхронизации с сайтом
 * @param {string} dbPath - Путь к БД
 * @param {Array<string>} ids - Массив ID товаров
 * @returns {Promise<Array>} Массив товаров
 */
export async function getProductsByIds(dbPath, ids) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        reject(new Error(`Ошибка подключения к БД: ${err.message}`));
        return;
      }
    });
    
    const table = getTableName();
    const cols = getSelectColumnsForIds();
    const placeholders = ids.map(() => '?').join(',');
    const query = `
      SELECT ${cols}
      FROM ${table}
      WHERE ID IN (${placeholders})
    `;
    
    db.all(query, ids, (err, rows) => {
      db.close();
      if (err) {
        reject(new Error(`Ошибка запроса товаров: ${err.message}`));
      } else {
        resolve(rows);
      }
    });
  });
}
