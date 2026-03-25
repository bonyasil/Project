/**
 * Парсер каталога irkutsk.baikalwheels.ru
 * Обходит страницы catalog?page=N, собирает товары (ссылка, название, цена).
 * Использует заголовки браузера + ротацию User-Agent + 10-секундные паузы между страницами.
 */

import https from 'https';
import { logger } from '../server/logger.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

let uaIndex = 0;
function nextUserAgent() {
  const ua = USER_AGENTS[uaIndex % USER_AGENTS.length];
  uaIndex++;
  return ua;
}

/** Пауза в ms */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * HTTP GET с поддержкой редиректов и cookie-jar
 * @param {string} url
 * @param {Object} opts
 * @param {string[]} opts.cookies - текущие куки (в формате "key=value; ...")
 * @param {string} opts.referer
 * @param {string} opts.userAgent
 * @returns {Promise<{body: string, cookies: string[]}>}
 */
function fetchPage(url, { cookies = [], referer = '', userAgent = USER_AGENTS[0] } = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        ...(referer ? { 'Referer': referer } : {}),
        ...(cookies.length ? { 'Cookie': cookies.join('; ') } : {}),
      }
    };

    const req = https.request(options, (res) => {
      // Обрабатываем редиректы
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).href;
        const newCookies = [...cookies, ...parseCookieHeaders(res.headers['set-cookie'] || [])];
        return fetchPage(redirectUrl, { cookies: newCookies, referer, userAgent }).then(resolve).catch(reject);
      }

      const newCookies = [...cookies, ...parseCookieHeaders(res.headers['set-cookie'] || [])];
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({ body: Buffer.concat(chunks).toString('utf8'), cookies: newCookies, statusCode: res.statusCode });
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

/** Парсит Set-Cookie заголовки → массив "key=value" */
function parseCookieHeaders(setCookieArr) {
  return setCookieArr.map(c => c.split(';')[0].trim()).filter(Boolean);
}

/** Извлекает цену из строки "42 000 ₽" → 42000 */
function parsePrice(str) {
  const digits = str.replace(/[^\d]/g, '');
  const n = parseInt(digits, 10);
  return isNaN(n) ? null : n;
}

/**
 * Парсит одну HTML-страницу каталога.
 * @returns {{ items: Array<{url,name,price}>, isNotFound: boolean, isBanned: boolean }}
 */
function parseCatalogHtml(html, baseUrl) {
  const isNotFound = html.includes('По вашему запросу ничего не найдено');

  // Ссылки
  const linkRe = /<a href="(\/catalog\/[^"]+)" data-popup=/g;
  const nameRe = /class="block-product1__title1">([^<]+)<\/a>/g;
  const priceRe = /class="block-product1__price"><span>([^<]+)<\/span><i>/g;

  const links = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) links.push(m[1]);

  const names = [];
  while ((m = nameRe.exec(html)) !== null) names.push(m[1].trim());

  const prices = [];
  while ((m = priceRe.exec(html)) !== null) prices.push(parsePrice(m[1]));

  // Бот-бан: нет ни "не найдено", ни нормальных данных
  const isBanned = !isNotFound && links.length === 0 && names.length === 0;

  const host = new URL(baseUrl).origin;
  const items = links.map((link, i) => ({
    url: host + link,
    name: names[i] || '',
    price: prices[i] ?? null,
  }));

  return { items, isNotFound, isBanned };
}

/**
 * Основная функция: обходит все страницы каталога от startUrl.
 * @param {string} startUrl - например: https://irkutsk.baikalwheels.ru/catalog?page=1
 * @param {Object} opts
 * @param {number} opts.delayMs - пауза между страницами (по умолчанию 10000 мс)
 * @param {number} opts.maxRetries - попыток при бан-детекте (по умолчанию 2)
 * @returns {Promise<Array<{url, name, price}>>}
 */
export async function parseBaikalPages(startUrl, { delayMs = 3000, maxRetries = 2 } = {}) {
  const baseUrl = new URL(startUrl);
  const origin = baseUrl.origin;
  const basePath = baseUrl.pathname; // /catalog

  // Строим URL страницы по номеру
  function pageUrl(n) {
    const u = new URL(startUrl);
    u.searchParams.set('page', String(n));
    return u.href;
  }

  let cookies = [];
  let referer = origin + '/';
  const allItems = [];
  let page = 1;

  logger.info('BaikalParser: start', { startUrl });

  // Первый запрос для получения сессионных кук (с retry при таймауте)
  let firstResp;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      firstResp = await fetchPage(pageUrl(1), { cookies, referer, userAgent: nextUserAgent() });
      break;
    } catch (e) {
      if (attempt > maxRetries) throw e;
      logger.warn(`BaikalParser: page 1 — ошибка запроса, повтор ${attempt}/${maxRetries}`, { error: e.message });
      await sleep(delayMs * 2);
    }
  }
  cookies = firstResp.cookies;
  const firstParsed = parseCatalogHtml(firstResp.body, origin);

  if (firstParsed.isBanned) {
    throw new Error('BaikalParser: первая страница заблокирована (бот-детект). Попробуйте позже.');
  }
  if (firstParsed.isNotFound) {
    logger.warn('BaikalParser: первая страница вернула "ничего не найдено"');
    return [];
  }

  allItems.push(...firstParsed.items);
  logger.info(`BaikalParser: page 1 → ${firstParsed.items.length} items`);
  referer = pageUrl(1);
  page = 2;

  while (true) {
    await sleep(delayMs);

    const url = pageUrl(page);
    let retries = 0;
    let parsed = null;

    while (retries <= maxRetries) {
      try {
        const resp = await fetchPage(url, {
          cookies,
          referer,
          userAgent: nextUserAgent(),
        });
        cookies = resp.cookies;
        parsed = parseCatalogHtml(resp.body, origin);

        if (parsed.isBanned) {
          retries++;
          if (retries > maxRetries) {
            logger.error(`BaikalParser: page ${page} — бот-бан, превышен лимит попыток`);
            throw new Error(`BaikalParser: бот-бан на странице ${page}`);
          }
          logger.warn(`BaikalParser: page ${page} — возможный бот-бан, повтор ${retries}/${maxRetries}`);
          await sleep(delayMs * 2);
          continue;
        }
        break;
      } catch (fetchErr) {
        retries++;
        if (retries > maxRetries) {
          logger.error(`BaikalParser: page ${page} — ошибка запроса, превышен лимит попыток`, { error: fetchErr.message });
          throw fetchErr;
        }
        logger.warn(`BaikalParser: page ${page} — ошибка запроса, повтор ${retries}/${maxRetries}`, { error: fetchErr.message });
        await sleep(delayMs * 2);
      }
    }

    if (parsed.isNotFound || parsed.items.length === 0) {
      logger.info(`BaikalParser: page ${page} — конец каталога`);
      break;
    }

    allItems.push(...parsed.items);
    logger.info(`BaikalParser: page ${page} → ${parsed.items.length} items (всего: ${allItems.length})`);
    referer = url;
    page++;
  }

  logger.info('BaikalParser: done', { total: allItems.length, pages: page - 1 });
  return allItems;
}
