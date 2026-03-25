/**
 * Нормализует URL Avito для сопоставления
 * - Добавляет https://www.avito.ru если отсутствует протокол
 * - Удаляет query параметры (всё начиная с ?)
 * - Возвращает origin + pathname
 * 
 * @param {string} rawUrl - Исходный URL
 * @returns {string} Нормализованный URL
 * 
 * @example
 * normalizeUrl('irkutsk/zapchasti_i_aksessuary/litye_diski_shogun_s10_8r18_5108_4665459115?context=H4sI...')
 * // => 'https://www.avito.ru/irkutsk/zapchasti_i_aksessuary/litye_diski_shogun_s10_8r18_5108_4665459115'
 */
export function normalizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        throw new Error('Invalid URL: must be a non-empty string');
    }

    let url = rawUrl.trim();

    // Удаляем всё начиная с ? (query параметры)
    const questionMarkIndex = url.indexOf('?');
    if (questionMarkIndex !== -1) {
        url = url.substring(0, questionMarkIndex);
    }

    // Добавить протокол и домен если отсутствует
    if (!url.startsWith('http')) {
        // Убрать начальный слэш если есть
        if (url.startsWith('/')) {
            url = url.substring(1);
        }
        url = 'https://www.avito.ru/' + url;
    }

    // Парсинг URL
    let parsed;
    try {
        parsed = new URL(url);
    } catch (error) {
        throw new Error(`Invalid URL format: ${rawUrl}`);
    }

    // Получить pathname
    let pathname = parsed.pathname;

    // Убрать завершающий слэш для единообразия
    pathname = pathname.replace(/\/+$/, '') || '/';

    // Вернуть нормализованный URL: origin + pathname (БЕЗ query параметров)
    return parsed.origin + pathname;
}

/**
 * Нормализует цену из текстового формата в число
 * - Удаляет символ ₽
 * - Удаляет пробелы
 * - Удаляет текст "за X шт."
 * - Преобразует в число
 * 
 * @param {string} priceText - Текст цены
 * @returns {number} Нормализованная цена
 * 
 * @example
 * normalizePrice('45 800 ₽ за 4 шт.')
 * // => 45800
 */
export function normalizePrice(priceText) {
    if (!priceText) {
        throw new Error('Invalid price: must be a non-empty value');
    }

    // Преобразовать в строку если это число
    const text = String(priceText);

    // Удалить символ ₽, пробелы, текст "за X шт."
    const cleaned = text
        .replace(/₽/g, '')
        .replace(/за\s+\d+\s+шт\./gi, '')
        .replace(/\s+/g, '')
        .trim();

    // Преобразовать в число
    const price = parseFloat(cleaned);

    if (isNaN(price) || price < 0) {
        throw new Error(`Invalid price format: ${priceText}`);
    }

    return price;
}
