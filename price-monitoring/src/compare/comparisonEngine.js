/**
 * Движок сравнения данных Avito с локальной БД
 */

import sqlite3 from 'sqlite3';
import { getTableName, getSelectColumnsForCompare } from '../db/dbSchema.js';

/**
 * Сравнивает данные из Avito с локальной БД
 * @param {Array} avitoItems - Массив товаров с Avito [{url, name, price}]
 * @param {string} dbPath - Путь к БД SQLite
 * @param {string} sellerId - Seller_ID для фильтрации
 * @returns {Promise<Object>} ComparisonResult
 */
export async function compare(avitoItems, dbPath, sellerId) {
  console.log('🔍 Compare: dbPath =', dbPath);
  
  return new Promise((resolve, reject) => {
    // Подключение к БД в readonly режиме
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        reject(new Error(`Ошибка подключения к БД: ${err.message}`));
        return;
      }
      console.log('✅ Compare: Подключено к БД:', dbPath);
    });
    
    const table = getTableName();
    const cols = getSelectColumnsForCompare();
    console.log('📊 Compare: table =', table);
    console.log('📊 Compare: cols =', cols);
    
    // VSE4 (diski_sait): ID не префикс продавца — загружаем все строки, сопоставление только по URL
    const isVSE4 = table.toUpperCase() === 'VSE4';
    const query = isVSE4
      ? `SELECT ${cols} FROM ${table}`
      : `SELECT ${cols} FROM ${table} WHERE substr(CAST(ID AS TEXT), 1, 3) = ?`;
    const queryParams = isVSE4 ? [] : [sellerId];
    
    console.log('📊 Compare: query =', query);

    db.all(query, queryParams, (err, dbRows) => {
      if (err) {
        db.close();
        reject(new Error(`Ошибка запроса к БД: ${err.message}`));
        return;
      }
      
      // Сопоставление: используем url_corr (нормализованный URL) для точного сравнения
      const dbItems = dbRows.map(row => ({
        id: row.ID,
        name: row.name_ow,
        url: row.url_vse != null ? String(row.url_vse).trim() : '',
        urlCorr: row.url_corr != null ? String(row.url_corr).trim() : '',
        price: row.price_vse,
        nacenka: row.nacenka,
        priceOw: row.price_ow,
        salesStatus: row.sales_status,
        forSite: row.for_site
      }));

      // Создаем Map для быстрого поиска по url_corr
      const dbItemsByUrl = new Map();
      dbItems.forEach(item => {
        if (item.urlCorr) {
          dbItemsByUrl.set(item.urlCorr, item);
        }
      });

      /** Найти запись БД по нормализованному URL (точное сравнение) */
      function findDbItemByParsedUrl(parsedUrl) {
        const p = parsedUrl != null ? String(parsedUrl).trim() : '';
        if (!p) return null;
        
        // Точное сравнение с url_corr через Map (O(1))
        return dbItemsByUrl.get(p) || null;
      }

      /** Есть ли в Avito объявление для этой записи БД (точное сравнение) */
      function hasAvitoMatchForDbUrl(dbItem) {
        if (!dbItem.urlCorr) return false;
        
        // Точное сравнение: есть ли в Avito товар с таким же url_corr
        return avitoItems.some(item => {
          const u = item.url != null ? String(item.url).trim() : '';
          return u && u === dbItem.urlCorr;
        });
      }

      // Изменения цен, «без изменений» и «снова в продаже»
      const priceChanges = [];
      const noChangeItems = [];
      const backOnSaleItems = [];
      avitoItems.forEach(avitoItem => {
        const dbItem = findDbItemByParsedUrl(avitoItem.url);
        if (!dbItem) return;

        // Товар был помечен как "снято с продажи" в БД, но снова появился на Avito
        if (dbItem.salesStatus === 'removed') {
          backOnSaleItems.push({
            id: dbItem.id,
            name: avitoItem.name,
            url: avitoItem.url,
            oldPrice: dbItem.price,    // цена в БД
            newPrice: avitoItem.price, // цена на Avito
            nacenka: dbItem.nacenka,
            priceOw: dbItem.priceOw,
            forSite: dbItem.forSite
          });
          return;
        }

        if (dbItem.price !== avitoItem.price) {
          priceChanges.push({
            id: dbItem.id,
            name: avitoItem.name,
            url: avitoItem.url,
            oldPrice: dbItem.price,
            newPrice: avitoItem.price,
            nacenka: dbItem.nacenka,
            priceOw: dbItem.priceOw,
            forSite: dbItem.forSite
          });
        } else {
          noChangeItems.push({
            id: dbItem.id,
            name: avitoItem.name,
            url: avitoItem.url,
            price: avitoItem.price,
            nacenka: dbItem.nacenka,
            priceOw: dbItem.priceOw,
            forSite: dbItem.forSite
          });
        }
      });

      // Снятые с продажи: в БД есть, нет на Avito, и ещё НЕ помечены как removed
      const removedItems = [];
      dbItems.forEach(dbItem => {
        if (!hasAvitoMatchForDbUrl(dbItem) && dbItem.salesStatus !== 'removed') {
          removedItems.push({
            id: dbItem.id,
            name: dbItem.name,
            url: dbItem.urlCorr || dbItem.url,
            price: dbItem.price,
            forSite: dbItem.forSite
          });
        }
      });

      // Новинки: по ссылке с Avito не нашли в БД ни одной записи, где url_vse содержит эту ссылку
      const newItems = [];
      avitoItems.forEach(avitoItem => {
        if (!findDbItemByParsedUrl(avitoItem.url)) {
          newItems.push({
            name: avitoItem.name,
            url: avitoItem.url,
            price: avitoItem.price
          });
        }
      });
      
      db.close();
      
      resolve({
        priceChanges,
        removedItems,
        newItems,
        noChangeItems,
        backOnSaleItems,
        summary: {
          totalAvito: avitoItems.length,
          totalDb: dbRows.length,
          priceChanges: priceChanges.length,
          removed: removedItems.length,
          new: newItems.length,
          noChange: noChangeItems.length,
          backOnSale: backOnSaleItems.length
        }
      });
    });
  });
}
