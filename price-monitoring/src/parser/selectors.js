/**
 * CSS селекторы для парсинга страниц Avito
 * При изменении вёрстки Avito обновите эти селекторы
 */

export const SELECTORS = {
  // Ссылка на карточку товара - используем любую ссылку с itemprop для скроллинга
  PRODUCT_LINK: 'a[itemprop="url"]',
  
  // Карточка товара в списке
  PRODUCT_CARD: 'div.iva-item-root-Kcj9I',
  
  // Наименование товара
  PRODUCT_NAME: '[itemprop="name"]',
  
  // Цена товара
  PRODUCT_PRICE: '[itemprop="price"]',
  
  // Альтернативные селекторы для цены
  PRODUCT_PRICE_ALT: '[data-marker="item-price"]',
  
  // Кнопка "Следующая страница" (если понадобится пагинация)
  PAGINATION_NEXT: '[data-marker="pagination-button/nextPage"]'
};
