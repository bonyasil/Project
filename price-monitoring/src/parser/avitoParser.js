/**
 * Модуль парсинга страниц Avito через Playwright
 */

import { chromium } from 'playwright';
import { SELECTORS } from './selectors.js';
import { normalizeUrl, normalizePrice } from './normalizers.js';

/**
 * Парсит страницу Avito и извлекает данные о товарах
 * @param {string} avitoUrl - URL страницы Avito для парсинга
 * @param {Object} options - Опции парсинга
 * @param {boolean} options.headless - Запускать браузер в headless режиме (по умолчанию false)
 * @param {number} options.captchaTimeout - Таймаут ожидания решения капчи в мс (по умолчанию 120000)
 * @returns {Promise<Array<{url: string, name: string, price: number}>>} Массив товаров
 * @throws {Error} При ошибках загрузки страницы или парсинга
 */
export async function parseAvitoPage(avitoUrl, options = {}) {
  const { headless = false, captchaTimeout = 120000 } = options;
  let browser = null;
  
  try {
    console.log(`🚀 Запуск браузера (headless: ${headless})...`);
    
    // Запуск browser с возможностью показа окна для решения капчи
    browser = await chromium.launch({ 
      headless,
      args: ['--disable-blink-features=AutomationControlled']
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow'
    });
    
    const page = await context.newPage();
    
    // Скрываем признаки автоматизации
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    
    console.log('📄 Загрузка страницы...');
    await page.goto(avitoUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    
    // В интерактивном режиме всегда показываем кнопку "Продолжить"
    if (!headless) {
      // Проверяем наличие капчи
      const title = await page.title();
      const bodyText = await page.evaluate(() => document.body.innerText);
      const hasCaptcha = title.includes('Доступ ограничен') || 
                        title.includes('проблема с IP') ||
                        bodyText.includes('капч') ||
                        bodyText.includes('Продолжить');
      
      if (hasCaptcha) {
        console.log('⚠️  Обнаружена капча! Решите её и нажмите "Продолжить"');
        
        // Добавляем кнопку "Продолжить"
        await page.evaluate(() => {
          const button = document.createElement('button');
          button.id = 'continue-parsing-btn';
          button.textContent = '✅ Продолжить парсинг';
          button.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 999999;
            padding: 15px 30px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: all 0.3s;
          `;
          button.onmouseover = () => {
            button.style.background = '#45a049';
            button.style.transform = 'scale(1.05)';
          };
          button.onmouseout = () => {
            button.style.background = '#4CAF50';
            button.style.transform = 'scale(1)';
          };
          document.body.appendChild(button);
        });
        
        // Ждём клика по кнопке "Продолжить"
        await page.waitForFunction(
          () => {
            const btn = document.getElementById('continue-parsing-btn');
            return new Promise(resolve => {
              if (btn) {
                btn.addEventListener('click', () => resolve(true));
              }
            });
          },
          { timeout: captchaTimeout }
        );
        
        console.log('✅ Пользователь нажал "Продолжить"');
        
        // Удаляем кнопку
        await page.evaluate(() => {
          const btn = document.getElementById('continue-parsing-btn');
          if (btn) btn.remove();
        });
      } else {
        console.log('✅ Капча не обнаружена, продолжаем автоматически');
      }
    }
    
    // Селектор ссылок на товары
    const linkSelector = SELECTORS.PRODUCT_LINK;
    
    // Ожидание загрузки ссылок
    console.log('⏳ Ожидание загрузки ссылок...');
    try {
      await page.waitForSelector(linkSelector, { timeout: 15000 });
    } catch (error) {
      // Если ссылки не найдены, возможно изменилась вёрстка
      const title = await page.title();
      if (title.includes('Доступ ограничен')) {
        throw new Error('Доступ к Avito заблокирован. Капча не была решена.');
      }
      throw new Error('Ссылки на товары не найдены. Возможно, изменилась вёрстка Avito или неверный URL.');
    }
    
    // Дополнительная задержка для полной загрузки
    await page.waitForTimeout(3000);

    // Ожидаемое число объявлений со страницы ("Найдено 614 объявлений" и т.п.)
    let expectedTotal = 0;
    try {
      expectedTotal = await page.evaluate(() => {
        const text = document.body.innerText || '';
        const m = text.match(/Найдено\s+(\d+)\s+объявлени[йя]/i) || text.match(/(\d+)\s+объявлени[йя]/);
        return m ? parseInt(m[1], 10) : 0;
      });
      if (expectedTotal > 0) {
        console.log(`📋 На странице указано: ${expectedTotal} объявлений`);
      }
    } catch (_) {}
    
    console.log('📜 Скроллинг страницы до конца...');
    let previousHeight = 0;
    let currentHeight = await page.evaluate(() => document.body.scrollHeight);
    let noChangeCount = 0;
    const maxScrollAttempts = 100;
    const noChangeLimit = 5; // если высота не меняется 5 раз подряд - значит достигли конца
    
    for (let i = 0; i < maxScrollAttempts; i++) {
      // Проверяем количество карточек для информации
      const cardCount = await page.$$eval(SELECTORS.PRODUCT_CARD, cards => cards.length);
      console.log(`   Попытка ${i + 1}: высота ${currentHeight}px, карточек ${cardCount}${expectedTotal > 0 ? ` (цель: ${expectedTotal})` : ''}`);
      
      // Скролим вниз
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      // Ждем подгрузки контента
      await page.waitForTimeout(3000);
      
      // Проверяем новую высоту
      previousHeight = currentHeight;
      currentHeight = await page.evaluate(() => document.body.scrollHeight);
      
      if (currentHeight === previousHeight) {
        noChangeCount++;
        if (noChangeCount >= noChangeLimit) {
          console.log(`✅ Скроллинг завершён: высота страницы не изменилась после ${noChangeLimit} попыток`);
          break;
        }
      } else {
        noChangeCount = 0;
      }
      
      // Дополнительная проверка: если достигли целевого количества карточек
      if (expectedTotal > 0 && cardCount >= expectedTotal) {
        console.log(`✅ Достигнуто целевое количество карточек (${cardCount} >= ${expectedTotal})`);
        break;
      }
    }
    
    // Дополнительное ожидание после скроллинга (как в ZennoPoster - сначала скролим, потом парсим)
    console.log('⏳ Ожидание полной загрузки после скроллинга...');
    await page.waitForTimeout(3000);
    
    // Финальная проверка количества карточек
    const finalCount = await page.$$eval(SELECTORS.PRODUCT_CARD, cards => cards.length);
    console.log(`📊 Итого карточек на странице: ${finalCount}`);
    
    console.log('📊 Извлечение данных через регулярку из HTML...');
    
    // Получаем HTML страницы
    const html = await page.content();
    
    // Более гибкая регулярка: ищем href внутри тега с itemprop="url"
    // Вариант 1: itemprop="url" ... href="/..."
    const urlRegex1 = /itemprop="url"[^>]*href="\/([^"]+)"/g;
    // Вариант 2: href="/..." ... itemprop="url"
    const urlRegex2 = /href="\/([^"]+)"[^>]*itemprop="url"/g;
    
    const matches1 = [...html.matchAll(urlRegex1)];
    const matches2 = [...html.matchAll(urlRegex2)];
    
    console.log(`📊 Найдено ${matches1.length} ссылок (itemprop первым)`);
    console.log(`📊 Найдено ${matches2.length} ссылок (href первым)`);
    
    // Объединяем все найденные URL (с параметрами!)
    const allUrls = [
      ...matches1.map(m => m[1]),
      ...matches2.map(m => m[1])
    ];
    
    // Удаляем дубликаты ДО нормализации (сравниваем полные URL с параметрами)
    const uniqueUrlsWithParams = [...new Set(allUrls)];
    console.log(`📊 Уникальных URL (с параметрами): ${uniqueUrlsWithParams.length}`);
    
    // Собираем данные: для каждой уникальной ссылки ищем название и цену
    const items = await page.evaluate((urls) => {
      return urls.map(url => {
        // Ищем ссылку на странице
        const fullUrl = `https://www.avito.ru/${url}`;
        const linkElement = document.querySelector(`a[href="/${url}"]`);
        
        if (!linkElement) return null;
        
        // Поднимаемся к карточке товара
        const card = linkElement.closest('div.iva-item-root-Kcj9I');
        if (!card) return null;
        
        // Извлечение названия
        const nameElement = card.querySelector('[itemprop="name"]');
        const name = nameElement?.textContent?.trim() || '';
        
        // Извлечение цены
        let priceElement = card.querySelector('[itemprop="price"]');
        if (!priceElement) {
          priceElement = card.querySelector('[data-marker="item-price"]');
        }
        const rawPrice = priceElement?.getAttribute('content') || 
                        priceElement?.textContent?.trim() || '';
        
        return { rawUrl: fullUrl, name, rawPrice };
      }).filter(item => item !== null);
    }, uniqueUrlsWithParams);
    
    console.log(`📊 Извлечено ${items.length} элементов с данными`);
    
    // Обработка данных - сохраняем URL с параметрами
    const processedItems = items
      .filter(item => item.rawUrl && item.name && item.rawPrice)
      .map(item => ({
        url: item.rawUrl, // Сохраняем полный URL с параметрами
        name: item.name,
        price: normalizePrice(item.rawPrice)
      }))
      .filter(item => item.url && item.price > 0);
    
    console.log(`📊 После фильтрации: ${processedItems.length} товаров`);
    console.log(`📊 URL сохранены с query параметрами (нормализация будет в БД)`);
    console.log(`✅ Успешно спарсено ${processedItems.length} товаров`);
    console.log(`📊 Нормализация URL и удаление дубликатов будет выполнено в БД`);
    
    // В интерактивном режиме оставляем браузер открытым на 5 секунд
    if (!headless) {
      console.log('⏳ Браузер закроется через 5 секунд...');
      await page.waitForTimeout(5000);
    }
    
    return processedItems;
    
  } catch (error) {
    // Обработка различных типов ошибок
    if (error.message.includes('Timeout')) {
      throw new Error(`Таймаут загрузки страницы Avito: ${avitoUrl}`);
    }
    if (error.message.includes('waiting for selector')) {
      throw new Error(`Не найдены карточки товаров на странице. Возможно, изменилась вёрстка Avito.`);
    }
    throw new Error(`Ошибка парсинга Avito: ${error.message}`);
    
  } finally {
    // Закрытие browser в любом случае
    if (browser) {
      await browser.close();
    }
  }
}
