/**
 * Схема БД: имя таблицы и маппинг колонок.
 * Поддержка таблицы VSE4 (diski_sait.db) и стандартной products.
 * В .env задаётся DB_TABLE=VSE4 или DB_TABLE=products (при сохранении конфигурации с путём к diski_sait — подставляется VSE4).
 */

/** Имя таблицы для запросов (читаем env при каждом вызове, чтобы учитывать перезагрузку .env) */
export function getTableName() {
  return process.env.DB_TABLE || 'products';
}

function isVSE4() {
  return getTableName().toUpperCase() === 'VSE4';
}

/**
 * Список колонок для SELECT (сравнение с Avito).
 * products: ID, name_ow, url_vse, url_corr, price_vse, nacenka, price_ow, sales_status, for_site
 * VSE4:     ID, name→name_ow, url_vse, url_corr, price_vse, nacenka(вычисл.), price_ow, status_avito→sales_status, for_site(1)
 */
export function getSelectColumnsForCompare() {
  if (isVSE4()) {
    return `ID, name AS name_ow, url_vse, url_corr, price_vse, (COALESCE(price_ow, 0) - COALESCE(price_vse, 0)) AS nacenka, price_ow, status_avito AS sales_status, 1 AS for_site`;
  }
  return 'ID, name_ow, url_vse, url_corr, price_vse, nacenka, price_ow, sales_status, for_site';
}

/** Колонка статуса продажи для UPDATE */
export function getSalesStatusColumn() {
  return isVSE4() ? 'status_avito' : 'sales_status';
}

/** Колонки для getProductsByIds */
export function getSelectColumnsForIds() {
  if (isVSE4()) {
    return 'ID, name AS name_ow, price_vse, price_ow, status_avito AS sales_status, 1 AS for_site';
  }
  return 'ID, name_ow, price_vse, price_ow, sales_status, for_site';
}
