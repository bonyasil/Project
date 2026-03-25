/**
 * Тестовый парсер отдельных объявлений Avito (раздел "Новые объявления").
 *
 * Принимает список URL объявлений (аргументы командной строки или TEST_URLS).
 * Для каждого URL открывает страницу через Playwright, извлекает поля для vse4_new.
 * Результат выводится как JSON — БД не трогается.
 *
 * Запуск:
 *   node scripts/test-avito-listing-parser.js https://www.avito.ru/... https://www.avito.ru/...
 *   node scripts/test-avito-listing-parser.js  (использует TEST_URLS ниже)
 */

import { chromium } from 'playwright';

// ── Нормализаторы гомоглифов ─────────────────────────────────────────────────
// Продавцы используют рандомизатор: заменяют часть кириллических символов
// на внешне похожие латинские (а→a, е→e, о→o и т.д.).
//
// LATIN_TO_CYR — для ПОИСКА ключевых слов: приводим строку к чистой кириллице
// CYR_TO_LATIN — для ЗНАЧЕНИЯ ЦВЕТА:  переводим кирилличные гомоглифы в латиницу
//   (Нyper Вlack → Hyper Black)
//
const LATIN_TO_CYR = [
  ['a','а'],['e','е'],['o','о'],['p','р'],['c','с'],['x','х'],['y','у'],
  ['A','А'],['B','В'],['C','С'],['E','Е'],['H','Н'],['K','К'],
  ['M','М'],['O','О'],['P','Р'],['T','Т'],['X','Х'],
];

// Обратная таблица — кириллические гомоглифы → их латинские двойники
const CYR_TO_LATIN = [
  ['а','a'],['е','e'],['о','o'],['р','p'],['с','c'],['х','x'],['у','y'],
  ['А','A'],['В','B'],['С','C'],['Е','E'],['Н','H'],['К','K'],
  ['М','M'],['О','O'],['Р','P'],['Т','T'],['Х','X'],
];

/** Латиница → кириллица (для поиска слова «Цвет» и т.п.) */
function latToCyr(str) {
  let r = str;
  for (const [lat, cyr] of LATIN_TO_CYR) r = r.replaceAll(lat, cyr);
  return r;
}

/** Кириллические гомоглифы → латиница (для значения цвета) */
function cyrToLat(str) {
  let r = str;
  for (const [cyr, lat] of CYR_TO_LATIN) r = r.replaceAll(cyr, lat);
  return r;
}
// ────────────────────────────────────────────────────────────────────────────

/**
 * Ищет строку «Цвет» в тексте описания (с учётом гомоглифов).
 * Текст может быть плоским (без \n) — тогда разбиваем по нескольким пробелам.
 * Значение цвета нормализуется: кириллические гомоглифы → латиница.
 */
function extractColorFromDescription(descText) {
  if (!descText) return null;

  // Разбиваем на «строки»: сначала по \n, потом по 2+ пробелам (если \n нет)
  let lines = descText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length <= 1) {
    // Плоский текст — разбиваем по 2+ пробелам
    lines = descText.split(/  +/).map(l => l.trim()).filter(Boolean);
  }

  for (const line of lines) {
    // Нормализуем для поиска: всё → кириллица, нижний регистр
    const normLine = latToCyr(line).toLowerCase();

    // Ищем «цвет» где-нибудь в строке (не обязательно в начале)
    const kwIdx = normLine.indexOf('цвет');
    if (kwIdx === -1) continue;

    // Проверяем, что это слово (не часть другого — нет буквы перед ним)
    if (kwIdx > 0 && /[а-яёa-z]/i.test(normLine[kwIdx - 1])) continue;

    // Пропускаем «цвет» (4 символа) + любые разделители (пробелы, тире, двоеточие)
    let valueStart = kwIdx + 4;
    while (valueStart < line.length && /[\s\-–—:·*]/.test(latToCyr(line[valueStart]))) {
      valueStart++;
    }

    const rawValue = line.slice(valueStart).trim();
    if (!rawValue) continue;

    // Значение цвета: переводим кириллические гомоглифы → латиницу
    return cyrToLat(rawValue);
  }

  return null;
}

// ── Тестовые URL (замените на реальные объявления) ──────────────────────────
const TEST_URLS = [
  'https://www.avito.ru/irkutsk/zapchasti_i_aksessuary/litye_diski_305_forged_ft114_8.5r18_5112_7928348136',
];
// ────────────────────────────────────────────────────────────────────────────

/** Нормализует URL по правилам спецификации: убирает query, hash, trailing slash */
function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl.trim());
    let pathname = u.pathname.replace(/\/+$/, ''); // убрать trailing slash
    return (u.origin + pathname).toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

/** Нормализует и дедуплицирует список URL */
function deduplicateUrls(urls) {
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

/**
 * Маппинг русских названий характеристик Avito → поля vse4_new.
 * Ключи — точные значения (toLowerCase) как они приходят со страницы.
 * Порядок важен: более специфичные ключи выше.
 */
const CHAR_MAP = {
  // Состояние (отдельный блок "Состояние дисков")
  'состояние':                              'condition',
  'б/у или новый':                          'condition',
  // Тип товара
  'тип товара':                             'type_good',
  'вид товара':                             'type_good',
  // Производитель
  'производитель':                          'maker',
  'бренд':                                  'maker',
  'марка':                                  'maker',
  // Модель
  'модель':                                 'model',
  // Ширина — реальный ключ на Avito: "ширина обода"
  'ширина обода':                           'width',
  'ширина диска':                           'width',
  'ширина':                                 'width',
  // Диаметр (просто "диаметр", без уточнения)
  'диаметр':                                'diam',
  'диаметр диска':                          'diam',
  // Вылет — реальный ключ: "вылет (et)"
  'вылет (et)':                             'vylet',
  'вылет':                                  'vylet',
  // Количество отверстий
  'количество отверстий':                   'count_otv',
  'кол-во отверстий':                       'count_otv',
  // Диаметр расположения отверстий — реальный ключ
  'диаметр расположения отверстий':         'diam_otv',
  'диаметр отверстий':                      'diam_otv',
  'диаметр болтов':                         'diam_otv',
  // Центральное отверстие — реальный ключ: "центральное отверстие (dia)"
  'центральное отверстие (dia)':            'centr_otv',
  'центральное отверстие':                  'centr_otv',
  'центр. отверстие':                       'centr_otv',
  // Тип диска
  'тип диска':                              'type_disk',
  'вид диска':                              'type_disk',
  // Цвет
  'цвет':                                   'color',
  'цвет диска':                             'color',
};

/** Сопоставляет название характеристики с полем: сначала точно, потом частично */
function matchCharKey(label) {
  const lower = label.toLowerCase().trim();
  if (CHAR_MAP[lower]) return CHAR_MAP[lower];
  // Частичное — ищем ключ который содержится в label или наоборот
  for (const [key, field] of Object.entries(CHAR_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return field;
  }
  return null;
}

/** Парсит одно объявление Avito. Возвращает объект с полями для vse4_new. */
async function parseAvitoListing(page, url, canonical) {
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
    _raw_chars: {},   // сырые характеристики для отладки
    _error: null,
  };

  try {
    console.log(`  → загрузка: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Проверка капчи / блокировки — ждём пока пользователь решит
    let title = await page.title();
    if (title.includes('Доступ ограничен') || title.includes('проблема с IP')) {
      console.log('  ⚠️  Капча! Решите в браузере...');
      const start = Date.now();
      const maxWait = 180000;
      while (Date.now() - start < maxWait) {
        await page.waitForTimeout(2000);
        title = await page.title();
        if (!title.includes('Доступ ограничен') && !title.includes('проблема с IP')) {
          console.log('  ✅ Капча решена, продолжаем...');
          await page.waitForTimeout(1000);
          break;
        }
        process.stdout.write(`\r  ⏳ ожидание ${Math.round((Date.now() - start) / 1000)}с...`);
      }
      title = await page.title();
      if (title.includes('Доступ ограничен') || title.includes('проблема с IP')) {
        result._error = 'Капча не решена за 3 минуты.';
        return result;
      }
    }

    // Небольшая пауза для подгрузки динамического контента
    await page.waitForTimeout(2000);

    // ── Название ────────────────────────────────────────────────────────────
    result.name = await page.evaluate(() => {
      const el =
        document.querySelector('[data-marker="item-view/title-info"]') ||
        document.querySelector('h1.title-info-title') ||
        document.querySelector('h1[itemprop="name"]') ||
        document.querySelector('h1');
      return el ? el.textContent.trim() : null;
    });

    // ── Цена ────────────────────────────────────────────────────────────────
    // Avito кладёт числовую цену в itemprop="price" content="NNNNN"
    result.price_vse = await page.evaluate(() => {
      const el = document.querySelector('[itemprop="price"]');
      if (el) {
        const content = el.getAttribute('content');
        if (content) {
          const num = parseInt(content.replace(/[^\d]/g, ''), 10);
          if (!isNaN(num) && num > 0) return num;
        }
      }
      // Fallback: ищем в блоке item-price текстовое значение
      const priceEl = document.querySelector('[data-marker="item-view/item-price"]');
      if (priceEl) {
        const raw = priceEl.textContent || '';
        const num = parseInt(raw.replace(/[^\d]/g, ''), 10);
        if (!isNaN(num) && num > 0) return num;
      }
      return null;
    });

    // ── Текст описания ──────────────────────────────────────────────────────
    // Описание читаем временно — только для извлечения цвета.
    // В результат (result) не сохраняем: поле text_avito заполняется другим модулем.
    const descText = await page.evaluate(() => {
      const el =
        document.querySelector('[data-marker="item-view/item-description"]') ||
        document.querySelector('[class*="item-description"]') ||
        document.querySelector('[class*="description-text"]');
      if (!el) return null;
      const withBreaks = el.innerHTML
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '');
      const tmp = document.createElement('textarea');
      tmp.innerHTML = withBreaks;
      return tmp.value.trim();
    });

    // ── Характеристики ──────────────────────────────────────────────────────
    // Структура Avito (проверено на реальной странице):
    //   [data-marker="item-view/item-params"] содержит несколько блоков ul > li
    //   каждый li: <p><span class="...">KEY<span>: </span></span>VALUE</p>
    const rawChars = await page.evaluate(() => {
      const result = {};

      // Основной метод: все li внутри item-view/item-params
      const blocks = document.querySelectorAll('[data-marker="item-view/item-params"]');
      blocks.forEach(block => {
        block.querySelectorAll('li').forEach(li => {
          const p = li.querySelector('p');
          if (!p) return;
          // Первый span — это обёртка ключа (содержит вложенный span ": ")
          const keySpan = p.querySelector('span');
          if (!keySpan) return;
          // Ключ — текст первого span без вложенного ": "
          const innerColon = keySpan.querySelector('span');
          const key = (innerColon
            ? keySpan.textContent.replace(innerColon.textContent, '')
            : keySpan.textContent
          ).trim().replace(/:$/, '');
          // Значение — текст p без текста keySpan
          const val = p.textContent
            .replace(keySpan.textContent, '')
            .trim();
          if (key && val) result[key] = val;
        });
      });

      return result;
    });

    result._raw_chars = rawChars;

    // Строим specifications из всех характеристик
    const charLines = Object.entries(rawChars).map(([k, v]) => `${k}: ${v}`);
    result.specifications = charLines.join(' | ') || null;

    // ── Цвет из описания ────────────────────────────────────────────────────
    result.color = extractColorFromDescription(descText);

    // Маппим характеристики в поля
    for (const [label, value] of Object.entries(rawChars)) {
      const field = matchCharKey(label);
      if (field && result[field] === null) {
        // Числовые поля: извлекаем первое число (убираем «дюймов», «мм» и пр.)
        if (['width', 'diam', 'vylet', 'count_otv', 'diam_otv', 'centr_otv'].includes(field)) {
          const cleaned = value.replace(',', '.').replace(/\u00a0/g, '');
          const numMatch = cleaned.match(/[\d.]+/);
          if (numMatch) {
            result[field] = parseFloat(numMatch[0]);
          } else {
            result[field] = value; // оставляем строкой если не распарсилось
          }
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

// ── Главная функция ──────────────────────────────────────────────────────────

async function main() {
  // URL из аргументов командной строки или из TEST_URLS
  const inputUrls = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : TEST_URLS;

  if (inputUrls.length === 0) {
    console.error('Укажите URL объявлений в аргументах или добавьте их в TEST_URLS в скрипте.');
    console.error('Пример: node scripts/test-avito-listing-parser.js https://www.avito.ru/...');
    process.exit(1);
  }

  // Нормализация и дедупликация
  const urls = deduplicateUrls(inputUrls);
  console.log(`\nВсего URL: ${inputUrls.length}, после дедупликации: ${urls.length}\n`);
  if (inputUrls.length !== urls.length) {
    console.log('Удалены дубли:');
    const canonicals = new Set(urls.map(u => u.canonical));
    inputUrls.forEach(u => {
      if (!canonicals.has(normalizeUrl(u))) {
        console.log(`  [дубль] ${u}`);
      }
    });
    console.log('');
  }

  let browser = null;
  const results = [];

  // Файл для сохранения кук между запусками — снижает вероятность блокировки
  const COOKIES_FILE = 'avito-cookies.json';
  const { existsSync, readFileSync: rfs, writeFileSync: wfs } = await import('fs');

  try {
    console.log('Запуск браузера (headless: false — для решения капчи при необходимости)...');
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    // Если есть сохранённые куки — загружаем их
    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
    };
    if (existsSync(COOKIES_FILE)) {
      try {
        contextOptions.storageState = COOKIES_FILE;
        console.log(`  Загружены куки из ${COOKIES_FILE}`);
      } catch { /* игнорируем повреждённый файл */ }
    }

    const context = await browser.newContext(contextOptions);

    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    for (let i = 0; i < urls.length; i++) {
      const { original, canonical } = urls[i];
      console.log(`\n[${i + 1}/${urls.length}] ${original}`);
      console.log(`  canonical: ${canonical}`);

      const data = await parseAvitoListing(page, original, canonical);
      results.push(data);

      // Пауза между запросами (кроме последнего)
      if (i < urls.length - 1) {
        const delay = 3000 + Math.random() * 2000;
        console.log(`  ⏳ пауза ${Math.round(delay / 1000)}с...`);
        await page.waitForTimeout(delay);
      }
    }

  } finally {
    if (browser) {
      // Сохраняем куки и localStorage перед закрытием
      try {
        const contexts = browser.contexts();
        if (contexts.length > 0) {
          await contexts[0].storageState({ path: COOKIES_FILE });
          console.log(`\nКуки сохранены → ${COOKIES_FILE}`);
        }
      } catch { /* не критично */ }
      console.log('Закрытие браузера...');
      await browser.close();
    }
  }

  // ── Вывод результатов ────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log('РЕЗУЛЬТАТЫ ПАРСИНГА');
  console.log('═'.repeat(60));

  results.forEach((r, i) => {
    console.log(`\n[${i + 1}] ${r.url_vse}`);
    if (r._error) {
      console.log(`  ❌ Ошибка: ${r._error}`);
      return;
    }

    const fields = [
      ['name',         r.name],
      ['price_vse',    r.price_vse],
      ['condition',    r.condition],
      ['type_good',    r.type_good],
      ['maker',        r.maker],
      ['model',        r.model],
      ['width',        r.width],
      ['diam',         r.diam],
      ['vylet',        r.vylet],
      ['count_otv',    r.count_otv],
      ['diam_otv',     r.diam_otv],
      ['centr_otv',    r.centr_otv],
      ['type_disk',    r.type_disk],
      ['color',        r.color],
      ['url_corr',     r.url_corr],
    ];

    fields.forEach(([key, val]) => {
      const status = val !== null ? '✅' : '❌';
      console.log(`  ${status} ${key.padEnd(14)}: ${val ?? '—'}`);
    });

    const charCount = Object.keys(r._raw_chars).length;
    console.log(`\n  Сырые характеристики (${charCount} шт.):`);
    Object.entries(r._raw_chars).forEach(([k, v]) => {
      console.log(`    "${k}" → "${v}"`);
    });

  });

  // Сводка
  console.log('\n' + '═'.repeat(60));
  const ok = results.filter(r => !r._error && r.name && r.price_vse);
  const withChars = results.filter(r => !r._error && Object.keys(r._raw_chars).length > 0);
  console.log(`Итого: ${results.length} URL`);
  console.log(`  С названием и ценой: ${ok.length}`);
  console.log(`  С характеристиками:  ${withChars.length}`);

  // Полный JSON в файл
  const fs = await import('fs');
  const outFile = `parser-new-items-result-${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nПолный результат сохранён: ${outFile}`);
}

main().catch(err => {
  console.error('Критическая ошибка:', err.message);
  process.exit(1);
});
