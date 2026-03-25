/**
 * Модуль синхронизации с Site API (OnlyWheels)
 */

/**
 * Синхронизирует один товар с сайтом
 * @param {Object} product - Данные товара
 * @param {string} siteApiUrl - URL API сайта
 * @param {string} bearerToken - Bearer токен для авторизации
 * @returns {Promise<Object>} Результат синхронизации
 */
export async function syncProductToSite(product, siteApiUrl, bearerToken) {
  try {
    const response = await fetch(`${siteApiUrl}/products/${product.ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerToken}`
      },
      body: JSON.stringify({
        name: product.name_ow,
        price_vse: product.price_vse,
        price_ow: product.price_ow,
        sales_status: product.sales_status
      }),
      signal: AbortSignal.timeout(10000) // 10 секунд таймаут
    });
    
    if (response.status === 401) {
      throw new Error('Ошибка авторизации: неверный Bearer токен');
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      success: true,
      productId: product.ID,
      data
    };
    
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return {
        success: false,
        productId: product.ID,
        error: 'Таймаут запроса к API'
      };
    }
    
    return {
      success: false,
      productId: product.ID,
      error: error.message
    };
  }
}

/**
 * Синхронизирует несколько товаров с сайтом
 * @param {Array} products - Массив товаров
 * @param {string} siteApiUrl - URL API сайта
 * @param {string} bearerToken - Bearer токен
 * @returns {Promise<Object>} Результаты синхронизации
 */
export async function syncMultipleProducts(products, siteApiUrl, bearerToken) {
  // Фильтруем только товары с for_site = 1
  const productsToSync = products.filter(p => p.for_site === 1);
  
  if (productsToSync.length === 0) {
    return {
      total: 0,
      success: 0,
      failed: 0,
      results: []
    };
  }
  
  // Синхронизируем все товары параллельно
  const results = await Promise.all(
    productsToSync.map(product => 
      syncProductToSite(product, siteApiUrl, bearerToken)
    )
  );
  
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  
  return {
    total: productsToSync.length,
    success: successCount,
    failed: failedCount,
    results
  };
}

/**
 * Удаляет товар с сайта по ID
 * @param {string} productId - ID товара (например VSE412)
 * @param {string} siteApiUrl - URL API сайта
 * @param {string} bearerToken - Bearer токен
 */
export async function deleteProductFromSite(productId, siteApiUrl, bearerToken) {
  try {
    const response = await fetch(`${siteApiUrl}/admin/products/${productId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${bearerToken}`
      },
      signal: AbortSignal.timeout(10000)
    });

    if (response.status === 401) {
      throw new Error('Ошибка авторизации: неверный Bearer токен');
    }
    if (response.status === 404) {
      throw new Error(`Товар ${productId} не найден на сайте`);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return { success: true, productId };
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return { success: false, productId, error: 'Таймаут запроса к API' };
    }
    return { success: false, productId, error: error.message };
  }
}
