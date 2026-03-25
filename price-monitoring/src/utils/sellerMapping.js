/**
 * Модуль для работы с Seller ID
 */

/**
 * Извлекает Seller_ID из ID товара (первые 3 символа)
 * @param {string} productId - ID товара
 * @returns {string} Seller_ID
 */
export function extractSellerId(productId) {
  if (!productId || typeof productId !== 'string') {
    throw new Error('Product ID должен быть непустой строкой');
  }
  
  if (productId.length < 3) {
    throw new Error('Product ID должен содержать минимум 3 символа');
  }
  
  return productId.substring(0, 3);
}

/**
 * Определяет Seller_ID по Avito URL
 * Извлекает sellerId из query параметров URL
 * @param {string} avitoUrl - URL страницы Avito
 * @returns {string} Seller_ID
 */
export function mapUrlToSellerId(avitoUrl) {
  if (!avitoUrl || typeof avitoUrl !== 'string') {
    throw new Error('Avito URL должен быть непустой строкой');
  }
  
  try {
    const url = new URL(avitoUrl);
    let sellerId = url.searchParams.get('sellerId');
    if (!sellerId && url.pathname) {
      const m = url.pathname.match(/\/brands\/([^/]+)/);
      if (m) {
        sellerId = m[1].replace(/^i/, '');
      }
    }
    if (!sellerId) {
      throw new Error('URL не содержит sellerId (ни в параметрах, ни в пути /brands/...)');
    }
    if (sellerId.length < 3) {
      throw new Error('sellerId должен содержать минимум 3 символа');
    }
    return String(sellerId).substring(0, 3);
  } catch (error) {
    if (error.message.includes('Invalid URL')) {
      throw new Error(`Невалидный URL: ${avitoUrl}`);
    }
    throw error;
  }
}

/**
 * Маппинг известных Seller ID на названия продавцов (опционально)
 */
export const KNOWN_SELLERS = {
  'fb0': 'VSE-4 WHEELS',
  // Добавить других продавцов по мере необходимости
};

/**
 * Получает название продавца по Seller_ID
 * @param {string} sellerId - Seller_ID
 * @returns {string} Название продавца или сам ID если не найден
 */
export function getSellerName(sellerId) {
  return KNOWN_SELLERS[sellerId] || sellerId;
}
