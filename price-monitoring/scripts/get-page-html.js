/**
 * Открывает страницу через Playwright и сохраняет HTML в файл.
 * Запуск: node scripts/get-page-html.js <URL>
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const url = process.argv[2];
if (!url) {
  console.error('Укажите URL: node scripts/get-page-html.js https://...');
  process.exit(1);
}

const browser = await chromium.launch({
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
});

const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
  locale: 'ru-RU',
  timezoneId: 'Europe/Moscow',
});

const page = await context.newPage();
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});

console.log(`Загружаю: ${url}`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2000);

// Проверяем капчу — если она есть, ждём пока пользователь её решит
async function waitForRealPage(page, maxWaitMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const title = await page.title();
    const isBlocked = title.includes('Доступ ограничен') || title.includes('проблема с IP');
    if (!isBlocked) return true;
    process.stdout.write('\r⚠️  Капча! Решите в браузере... (ожидание ' + Math.round((Date.now() - start) / 1000) + 'с)');
    await page.waitForTimeout(2000);
  }
  return false;
}

const pageTitle = await page.title();
if (pageTitle.includes('Доступ ограничен') || pageTitle.includes('проблема с IP')) {
  console.log('⚠️  Обнаружена капча! Решите её в открытом браузере...');
  const solved = await waitForRealPage(page);
  if (!solved) {
    console.log('\n❌ Капча не решена за 3 минуты, выход.');
    await browser.close();
    process.exit(1);
  }
  console.log('\n✅ Страница загружена, получаю HTML...');
  await page.waitForTimeout(1500);
}

const html = await page.content();
const outFile = `page-html-${Date.now()}.html`;
writeFileSync(outFile, html, 'utf8');

console.log(`Сохранено ${html.length} байт → ${outFile}`);

await browser.close();
