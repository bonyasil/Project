/**
 * Проверка статуса объявлений Avito через Playwright.
 * POST /api/avito-check/removed — принимает [{id, url}], проверяет наличие
 * текста "Объявление снято с публикации." и возвращает результат по каждому URL.
 */

import { Router } from 'express';
import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = path.join(__dirname, '../../../avito-cookies.json');


// Статус текущей проверки (один прогон за раз)
let checkState = {
  running: false,
  total: 0,
  done: 0,
  results: [],   // [{id, url, removed: bool|null, error: string|null}]
  captcha: false, // true когда ждём решения капчи пользователем
  error: null,
};

/** GET /status */
router.get('/status', (_req, res) => {
  res.json({ ...checkState });
});

/** POST /removed — запускает проверку
 * Body: { items: [{id, name, url}] }
 */
router.post('/removed', async (req, res) => {
  if (checkState.running) {
    return res.status(409).json({ error: 'Проверка уже запущена' });
  }

  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Нет объявлений для проверки' });
  }

  checkState = { running: true, total: items.length, done: 0, results: [], error: null };
  res.json({ ok: true, total: items.length });

  // Запускаем в фоне
  runCheck(items).catch(err => {
    logger.error('avitoCheck error', { error: err.message });
    checkState.running = false;
    checkState.error = err.message;
  });
});

/** POST /stop */
router.post('/stop', (_req, res) => {
  checkState.running = false;
  res.json({ ok: true });
});

/**
 * Определяет блокировку/капчу Avito и ждёт пока пользователь её решит.
 * Проверяет каждые 2с — как только страница перестаёт выглядеть как капча, продолжает.
 */
async function waitForCaptcha(page) {
  const CAPTCHA_TIMEOUT = 10 * 60 * 1000; // максимум 10 минут ждём
  const CHECK_INTERVAL = 2000;
  const deadline = Date.now() + CAPTCHA_TIMEOUT;

  while (Date.now() < deadline) {
    let isCaptcha = false;
    try {
      isCaptcha = await page.evaluate(() => {
        const url = window.location.href;
        const text = document.body?.innerText || '';
        return (
          url.includes('blocked') ||
          url.includes('captcha') ||
          text.includes('Подтвердите, что вы не робот') ||
          text.includes('Не робот') ||
          text.includes('Доступ ограничен') ||
          text.includes('Введите код') ||
          !!document.querySelector('[class*="captcha"]') ||
          !!document.querySelector('[id*="captcha"]') ||
          !!document.querySelector('iframe[src*="captcha"]')
        );
      });
    } catch {
      // Страница навигируется — подождём
      isCaptcha = true;
    }

    if (!isCaptcha) return; // капчи нет — продолжаем

    // Сообщаем фронтенду что идёт ожидание капчи
    checkState.captcha = true;
    logger.warn('avitoCheck: captcha detected, waiting for user...');
    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
  }

  checkState.captcha = false;
}

async function runCheck(items) {
  let browser, context;
  try {
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'ru-RU',
    });

    // Подгружаем куки если есть
    if (existsSync(COOKIES_FILE)) {
      try {
        const cookies = JSON.parse(readFileSync(COOKIES_FILE, 'utf8'));
        await context.addCookies(cookies);
      } catch {}
    }

    for (const item of items) {
      if (!checkState.running) break;

      const result = { id: item.id, name: item.name, url: item.url, removed: null, error: null };
      try {
        const page = await context.newPage();
        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);

        // Проверяем капчу/блокировку — ждём пока пользователь решит
        await waitForCaptcha(page);

        if (!checkState.running) {
          await page.close();
          break;
        }

        // Проверяем по data-marker (надёжнее чем innerText)
        result.removed = await page.evaluate(() => {
          if (!document.body) return false;
          // Основной признак — data-marker="item-view/closed-warning"
          if (document.querySelector('[data-marker="item-view/closed-warning"]')) return true;
          // Запасной вариант — текст в body
          const text = document.body.innerText || '';
          return text.includes('Объявление снято с публикации');
        }).catch(() => false);
        await page.close();
      } catch (err) {
        result.error = err.message;
        logger.warn('avitoCheck page error', { id: item.id, url: item.url, error: err.message });
      }

      checkState.results.push(result);
      checkState.done++;
    }
  } finally {
    // Сохраняем куки для следующей сессии
    if (context) {
      try {
        const cookies = await context.cookies();
        if (cookies.length > 0) writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
      } catch {}
    }
    if (browser) await browser.close().catch(() => {});
    checkState.running = false;
    checkState.captcha = false;
  }
}

export default router;
