# Avito Price Monitoring Dashboard

Локальный дашборд для мониторинга цен с Avito и актуализации позиций.

## 🚀 Быстрый старт

```bash
cd price-monitoring

# 1. Установка
npm install
npx playwright install chromium

# 2. Диагностика БД (ВАЖНО!)
node quick-diagnosis.js

# 3. Исправление (если нужно)
node add-url-corr-column.js

# 4. Запуск
npm start
```

Откройте http://localhost:3002

**Подробная инструкция:** См. `QUICK_START.md`

---

## ⚠️ Важно: Проблема "Все в новинки"

Если все товары попадают в раздел "Новинки", это означает, что колонка `url_corr` в БД не заполнена.

**Быстрое решение:**
```bash
node quick-diagnosis.js          # Диагностика
node add-url-corr-column.js      # Исправление
```

**Подробная инструкция:** См. `FIX_NOVINKI_PROBLEM.md`

---

## Возможности

- 🔍 Парсинг страниц Avito через Playwright (с поддержкой капчи)
- 📊 Сравнение с локальной SQLite БД
- 💰 Отслеживание изменений цен
- 🚫 Выявление снятых с продажи товаров
- ✨ Обнаружение новых товаров
- 📤 Экспорт новинок в Excel
- 🔄 Синхронизация с сайтом OnlyWheels через REST API

## Установка

1. Клонируйте репозиторий и перейдите в папку проекта:
```bash
cd price-monitoring
```

2. Установите зависимости:
```bash
npm install
```

3. Установите браузер Chromium для Playwright:
```bash
npx playwright install chromium
```

4. **ВАЖНО:** Заполните колонку url_corr в БД:
```bash
node quick-diagnosis.js          # Проверка
node add-url-corr-column.js      # Исправление (если нужно)
```

4. Создайте файл `.env` на основе `.env.example`:
```bash
cp .env.example .env
```

5. Отредактируйте `.env` файл:
```env
# Avito URLs (разделённые запятой)
AVITO_URLS=https://www.avito.ru/brands/...

# Site API Configuration
SITE_API_URL=https://api.onlywheels.ru
BEARER_TOKEN=your_bearer_token_here

# Database
DB_PATH=./data/products.db

# Server
PORT=3001
```

## Запуск

### Development режим (с hot reload):
```bash
npm run dev
```

### Production режим:
```bash
npm start
```

Дашборд будет доступен по адресу: http://localhost:3001

## API Endpoints

### Мониторинг
- `POST /api/monitor/run` - Запустить мониторинг
  ```json
  {
    "avitoUrl": "https://www.avito.ru/...",
    "headless": false
  }
  ```
- `GET /api/monitor/results` - Получить результаты последнего мониторинга

### Конфигурация
- `GET /api/config` - Получить конфигурацию (без секретов)
- `GET /api/config/avito-urls` - Получить список Avito URLs
- `PUT /api/config` - Сохранить конфигурацию

### Применение изменений
- `POST /api/apply/prices` - Применить изменения цен
  ```json
  {
    "items": [
      { "id": "abc123", "newPrice": 45000, "nacenka": 5000 }
    ]
  }
  ```
- `POST /api/apply/status` - Применить изменение статуса
  ```json
  {
    "ids": ["abc123", "abc456"],
    "salesStatus": "removed"
  }
  ```

### Экспорт
- `GET /api/export/new-items` - Экспортировать новые товары в Excel

### Health Check
- `GET /health` - Проверка состояния сервера

## Тестирование

Запуск всех тестов:
```bash
npm test
```

Запуск только unit-тестов:
```bash
npm run test:unit
```

Запуск с coverage:
```bash
npm run test:coverage
```

## Структура проекта

```
price-monitoring/
├── src/
│   ├── server/          # Express сервер и API routes
│   ├── parser/          # Парсинг Avito (Playwright)
│   ├── compare/         # Сравнение данных
│   ├── db/              # Операции с БД
│   ├── sync/            # Синхронизация с Site API
│   ├── export/          # Экспорт в Excel
│   ├── config/          # Управление конфигурацией
│   ├── utils/           # Утилиты
│   └── client/          # Frontend (HTML/CSS/JS)
├── tests/
│   └── unit/            # Unit тесты
├── data/                # База данных SQLite
├── .env                 # Конфигурация (не в git)
└── package.json
```

## Работа с капчей

При парсинге Avito может появиться капча. Система автоматически:
1. Открывает браузер в видимом режиме
2. Показывает кнопку "Продолжить парсинг" в правом верхнем углу
3. Ждёт пока вы решите капчу
4. После нажатия кнопки продолжает парсинг автоматически

## Troubleshooting

### Ошибка "Доступ ограничен"
Avito заблокировал IP. Решение:
- Отключите VPN
- Перезагрузите роутер
- Запустите парсинг в интерактивном режиме (headless: false)

### Ошибка "Карточки товаров не найдены"
Изменилась вёрстка Avito. Обновите селекторы в `src/parser/selectors.js`

### Ошибка подключения к БД
Проверьте путь к БД в `.env` файле и убедитесь что директория существует

## Лицензия

ISC
