/**
 * Хранилище последних внесённых изменений в локальную БД (для раздела «Внести изменения»).
 * Только в памяти; не синхронизируется с сайтом в тестах — под контролем пользователя.
 */

let lastPriceUpdates = [];
let lastStatusUpdates = [];
let lastSyncResults = { total: 0, success: 0, failed: 0, results: [] };

/**
 * @param {Array<{ id: string, name: string, newPrice: number }>} items
 */
export function setLastPriceUpdates(items) {
  lastPriceUpdates = [...items];
}

/**
 * @param {Array<{ id: string, name: string, salesStatus: string }>} items
 */
export function setLastStatusUpdates(items) {
  lastStatusUpdates = [...items];
}

export function setLastSyncResults(syncResult) {
  lastSyncResults = syncResult || { total: 0, success: 0, failed: 0, results: [] };
}

export function getLastAppliedChanges() {
  return {
    priceUpdates: lastPriceUpdates,
    statusUpdates: lastStatusUpdates,
    syncResults: lastSyncResults
  };
}

export function clearAppliedChanges() {
  lastPriceUpdates = [];
  lastStatusUpdates = [];
  lastSyncResults = { total: 0, success: 0, failed: 0, results: [] };
}
