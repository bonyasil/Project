/**
 * Парсер отдельных объявлений Avito (раздел «Новые объявления»).
 * Принимает список URL конкретных объявлений, возвращает структурированные данные.
 */

import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = path.join(__dirname, '../../avito-cookies.json');

// ── Нормализаторы гомоглифов ──────────────────────────────────────────────────
// Продавцы используют рандомизатор: заменяют часть кириллических символов
// на внешне похожие латинские (а→a, е→e, о→o и т.д.).

const LATIN_TO_CYR = [
  ['a','а'],['e','е'],['o','о'],['p','р'],['c','с'],['x','х'],['y','у'],
  ['A','А'],['B','В'],['C','С'],['E','Е'],['H','Н'],['K','К'],
  ['M','М'],['O','О'],['P','Р'],['T','Т'],['X','Х'],
];

const CYR_TO_LATIN = [
  ['а','a'],['е','e'],['о','o'],['р','p'],['с','c'],['х','x'],['у','y'],
  ['А','A'],['В','B'],['С','C'],['Е','E'],['Н','H'],['К','K'],
  ['М','M'],['О','O'],['Р','P'],['Т','T'],['Х','X'],
];

/** Латиница → кириллица (для поиска ключевых слов в описании) */
export function latToCyr(str) {
  let r = str;
  for (const [lat, cyr] of LATIN_TO_CYR) r = r.replaceAll(lat, cyr);
  return r;
}

/** Кириллические гомоглифы → латиница (для значения цвета: Нyper Вlack → Hyper Black) */
export function cyrToLat(str) {
  let r = str;
  for (const [cyr, lat] of CYR_TO_LATIN) r = r.replaceAll(cyr, lat);
  return r;
}

// ── Нормализация URL ──────────────────────────────────────────────────────────

/** Нормализует URL: убирает query, hash, trailing slash, приводит к lowercase */
export function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    const pathname = u.pathname.replace(/\/+$/, '');
    return (u.origin + pathname).toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

/** Нормализует и дедуплицирует список URL */
export function deduplicateUrls(urls) {
  const seen = new Set();
  const result = [];
  for (const raw of urls) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const canonical = normalizeUrl(trimmed);
    if (!seen.has(canonical)) {
      seen.add(canonical);
      result.push({ original: trimmed, canonical });
    }
  }
  return result;
}

// ── Маппинг характеристик → поля БД ──────────────────────────────────────────

const CHAR_MAP = {
  'состояние':                              'condition',
  'б/у или новый':                          'condition',
  'тип товара':                             'type_good',
  'вид товара':                             'type_good',
  'производитель':                          'maker',
  'бренд':                                  'maker',
  'марка':                                  'maker',
  'модель':                                 'model',
  'ширина обода':                           'width',
  'ширина диска':                           'width',
  'ширина':                                 'width',
  'диаметр':                                'diam',
  'диаметр диска':                          'diam',
  'вылет (et)':                             'vylet',
  'вылет':                                  'vylet',
  'количество отверстий':                   'count_otv',
  'кол-во отверстий':                       'count_otv',
  'диаметр расположения отверстий':         'diam_otv',
  'диаметр отверстий':                      'diam_otv',
  'диаметр болтов':                         'diam_otv',
  'центральное отверстие (dia)':            'centr_otv',
  'центральное отверстие':                  'centr_otv',
  'центр. отверстие':                       'centr_otv',
  'тип диска':                              'type_disk',
  'вид диска':                              'type_disk',
  'цвет':                                   'color',
  'цвет диска':                             'color',
};

function matchCharKey(label) {
  const lower = label.toLowerCase().trim();
  if (CHAR_MAP[lower]) return CHAR_MAP[lower];
  for (const [key, field] of Object.entries(CHAR_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return field;
  }
  return null;
}

// ── Извлечение цвета из описания ─────────────────────────────────────────────

/**
 * Ищет строку «Цвет» в тексте описания с учётом гомоглифов.
 * Значение цвета нормализуется: кириллические гомоглифы → латиница.
 */
export function extractColorFromDescription(descText) {
  if (!descText) return null;

  let lines = descText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length <= 1) {
    lines = descText.split(/  +/).map(l => l.trim()).filter(Boolean);
  }

  for (const line of lines) {
    const normLine = latToCyr(line).toLowerCase();
    const kwIdx = normLine.indexOf('цвет');
    if (kwIdx === -1) continue;
    if (kwIdx > 0 && /[а-яёa-z]/i.test(normLine[kwIdx - 1])) continue;

    let valueStart = kwIdx + 4;
    while (valueStart < line.length && /[\s\-–—:·*]/.test(latToCyr(line[valueStart]))) {
      valueStart++;
    }

    const rawValue = line.slice(valueStart).trim();
    if (!rawValue) continue;

    return cyrToLat(rawValue);
  }

  return null;
}

// ── Парсинг одного объявления ─────────────────────────────────────────────────

/**
 * Парсит одну страницу объявления Avito.
 * @param {import('playwright').Page} page
 * @param {string} url  - оригинальный URL
 * @param {string} canonical - нормализованный URL (url_corr)
 * @returns {Promise<Object>} - поля для vse4_new
 */
export async function parseAvitoListing(page, url, canonical) {
  const result = {
    url_vse: url,
    url_corr: canonical,
    name: null,
    price_vse: null,
    condition: null,
    type_good: null,
    maker: null,
    model: null,
    width: null,
    diam: null,
    vylet: null,
    count_otv: null,
    diam_otv: null,
    centr_otv: null,
    type_disk: null,
    color: null,
    specifications: null,
    _error: null,
  };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Ожидание капчи — браузер открыт, пользователь видит страницу
    let title = await page.title();
    if (title.includes('Доступ ограничен') || title.includes('проблема с IP')) {
      const start = Date.now();
      while (Date.now() - start < 180000) {
        await page.waitForTimeout(2000);
        title = await page.title();
        if (!title.includes('Доступ ограничен') && !title.includes('проблема с IP')) break;
      }
      title = await page.title();
      if (title.includes('Доступ ограничен') || title.includes('проблема с IP')) {
        result._error = 'Капча не решена за 3 минуты.';
        return result;
      }
    }

    await page.waitForTimeout(1500);

    // Название
    result.name = await page.evaluate(() => {
      const el = document.querySelector('[data-marker="item-view/title-info"]') ||
                 document.querySelector('h1[itemprop="name"]') ||
                 document.querySelector('h1');
      return el ? el.textContent.trim() : null;
    });

    // Цена (числовое значение из content атрибута)
    result.price_vse = await page.evaluate(() => {
      const el = document.querySelector('[itemprop="price"]');
      if (el) {
        const content = el.getAttribute('content');
        if (content) {
          const num = parseInt(content.replace(/[^\d]/g, ''), 10);
          if (!isNaN(num) && num > 0) return num;
        }
      }
      const priceEl = document.querySelector('[data-marker="item-view/item-price"]');
      if (priceEl) {
        const raw = priceEl.textContent || '';
        const num = parseInt(raw.replace(/[^\d]/g, ''), 10);
        if (!isNaN(num) && num > 0) return num;
      }
      return null;
    });

    // Описание — только для извлечения цвета (в result не сохраняем)
    const descText = await page.evaluate(() => {
      const el = document.querySelector('[data-marker="item-view/item-description"]') ||
                 document.querySelector('[class*="item-description"]');
      if (!el) return null;
      const withBreaks = el.innerHTML
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '');
      const tmp = document.createElement('textarea');
      tmp.innerHTML = withBreaks;
      return tmp.value.trim();
    });

    result.color = extractColorFromDescription(descText);

    // Характеристики
    const rawChars = await page.evaluate(() => {
      const result = {};
      const blocks = document.querySelectorAll('[data-marker="item-view/item-params"]');
      blocks.forEach(block => {
        block.querySelectorAll('li').forEach(li => {
          const p = li.querySelector('p');
          if (!p) return;
          const keySpan = p.querySelector('span');
          if (!keySpan) return;
          const innerColon = keySpan.querySelector('span');
          const key = (innerColon
            ? keySpan.textContent.replace(innerColon.textContent, '')
            : keySpan.textContent
          ).trim().replace(/:$/, '');
          const val = p.textContent.replace(keySpan.textContent, '').trim();
          if (key && val) result[key] = val;
        });
      });
      return result;
    });

    // Строим specifications
    result.specifications = Object.entries(rawChars)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | ') || null;

    // Маппим характеристики в поля
    for (const [label, value] of Object.entries(rawChars)) {
      const field = matchCharKey(label);
      if (field && result[field] === null) {
        if (['width', 'diam', 'vylet', 'count_otv', 'diam_otv', 'centr_otv'].includes(field)) {
          const cleaned = value.replace(',', '.').replace(/\u00a0/g, '');
          const numMatch = cleaned.match(/[\d.]+/);
          result[field] = numMatch ? parseFloat(numMatch[0]) : value;
        } else {
          result[field] = value;
        }
      }
    }

  } catch (err) {
    result._error = err.message;
  }

  return result;
}

// ── Сессия браузера ───────────────────────────────────────────────────────────

/**
 * Создаёт браузер и страницу с сохранёнными куками.
 * @returns {{ browser, context, page }}
 */
export async function createParserSession() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  };

  if (existsSync(COOKIES_FILE)) {
    try {
      contextOptions.storageState = COOKIES_FILE;
    } catch { /* игнорируем повреждённый файл */ }
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  return { browser, context, page };
}

/**
 * Сохраняет куки и закрывает браузер.
 */
export async function closeParserSession(session) {
  const { browser } = session;
  try {
    const contexts = browser.contexts();
    if (contexts.length > 0) {
      await contexts[0].storageState({ path: COOKIES_FILE });
    }
  } catch { /* не критично */ }
  await browser.close();
}

// ── Главная функция парсинга партии URL ──────────────────────────────────────

/**
 * Парсит список URL объявлений Avito.
 * @param {string[]} urls - сырые URL (могут быть с query, дублями и т.д.)
 * @param {Function} [onProgress] - колбэк прогресса: (current, total, item) => void
 * @returns {Promise<Object[]>} - массив результатов
 */
export async function parseAvitoListings(urls, onProgress) {
  const deduplicated = deduplicateUrls(urls);
  const session = await createParserSession();
  const results = [];

  try {
    for (let i = 0; i < deduplicated.length; i++) {
      const { original, canonical } = deduplicated[i];
      const item = await parseAvitoListing(session.page, original, canonical);
      results.push(item);

      if (onProgress) onProgress(i + 1, deduplicated.length, item);

      // Пауза между запросами (кроме последнего)
      if (i < deduplicated.length - 1) {
        const delay = 2500 + Math.random() * 1500;
        await session.page.waitForTimeout(delay);
      }
    }
  } finally {
    await closeParserSession(session);
  }

  return results;
}
