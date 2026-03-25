/**
 * Утилита подбора кода цвета из справочника каталога.
 *
 * Решает две проблемы при сравнении:
 * 1. Разный регистр (GLOSS BLACK == Gloss Black)
 * 2. Кириллические символы вместо латинских (о=U+043E, а=U+0430, с=U+0441 и др.)
 */

/** Карта замен: кириллический символ → похожий латинский */
const CYRILLIC_TO_LATIN = {
  'а': 'a', // U+0430
  'В': 'B', // U+0412
  'с': 'c', // U+0441
  'Е': 'E', // U+0415
  'е': 'e', // U+0435
  'М': 'M', // U+041C
  'о': 'o', // U+043E
  'О': 'O', // U+041E
  'р': 'p', // U+0440
  'С': 'C', // U+0421
};

/**
 * Нормализует строку цвета: заменяет кириллицу на латиницу, приводит к нижнему регистру.
 * @param {string|null} str
 * @returns {string}
 */
export function normalizeColor(str) {
  if (!str) return '';
  return str
    .split('')
    .map(ch => CYRILLIC_TO_LATIN[ch] ?? ch)
    .join('')
    .toLowerCase()
    .trim();
}

/**
 * Ищет код цвета (краткое обозначение из Color.name) по полному названию.
 *
 * @param {string} colorName - полное название цвета из VSE4/парсера
 * @param {Array<{name: string, index: string}>} colorTable - строки из таблицы Color каталога
 * @returns {string|null} код цвета (например 'H', 'GB') или null если не найдено
 */
export function findColorCode(colorName, colorTable) {
  const needle = normalizeColor(colorName);
  if (!needle) return null;
  const match = colorTable.find(c => normalizeColor(c.index) === needle);
  return match?.name ?? null;
}
