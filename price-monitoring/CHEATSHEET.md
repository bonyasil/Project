# 📝 Шпаргалка по командам

## 🚀 Быстрый старт

```bash
npm install                      # Установка зависимостей
node quick-diagnosis.js          # Диагностика БД
node add-url-corr-column.js      # Исправление БД (если нужно)
npm start                        # Запуск сервера
```

Откройте: http://localhost:3002

---

## 🔍 Диагностика

```bash
# Быстрая диагностика (рекомендуется)
node quick-diagnosis.js

# Проверка БД
node test-comparison-logic.js

# Проверка временной таблицы
node test-temp-table.js

# Проверка парсера
node test-parser.js
```

---

## 🔧 Исправление проблем

```bash
# Проблема: Все товары в "Новинки"
node add-url-corr-column.js

# Проверка дубликатов
node check-duplicates.js

# Показать дубликаты
node show-duplicates.js
```

---

## 🧪 Тестирование

```bash
# Все unit тесты
npm test

# Тест парсера
node test-parser.js

# Детальный тест парсера
node test-parser-detailed.js

# Тест стабильности (3 запуска)
node test-stability.js

# Тест извлечения URL
node test-url-extraction.js
```

---

## 📤 Экспорт и импорт

```bash
# Экспорт в Excel
node export-to-excel.js

# Импорт из парсера в БД
node import-from-parser.js
```

---

## 🌐 API Endpoints

### Мониторинг
```bash
# Запуск мониторинга
POST http://localhost:3002/api/monitor/run
Body: { "avitoUrl": "https://..." }

# Получить результаты
GET http://localhost:3002/api/monitor/results
```

### Конфигурация
```bash
# Получить конфигурацию
GET http://localhost:3002/api/config

# Сохранить конфигурацию
PUT http://localhost:3002/api/config
Body: { "dbPath": "...", "siteApiUrl": "..." }

# Список Avito URLs
GET http://localhost:3002/api/config/avito-urls
```

### Применение изменений
```bash
# Применить цены
POST http://localhost:3002/api/apply/prices
Body: { "items": [{ "id": "123", "newPrice": 1000, "nacenka": 100 }] }

# Изменить статус
POST http://localhost:3002/api/apply/status
Body: { "ids": ["123", "456"], "salesStatus": "removed" }
```

### Экспорт
```bash
# Экспорт новинок в Excel
GET http://localhost:3002/api/export/new-items
```

---

## 📁 Важные файлы

### Конфигурация
```
.env                             # Конфигурация (создать из .env.example)
package.json                     # Зависимости
```

### База данных
```
C:\Users\PC\Desktop\Project\diski_sait.db    # БД SQLite
```

### Логи
```
Логи выводятся в консоль сервера
```

---

## 🎯 Типичные сценарии

### Первый запуск
```bash
npm install
node quick-diagnosis.js
node add-url-corr-column.js      # Если нужно
npm start
```

### Ежедневное использование
```bash
npm start                        # Запуск сервера
# Открыть http://localhost:3002
# Нажать "Запустить мониторинг"
```

### При проблемах
```bash
node quick-diagnosis.js          # Диагностика
node add-url-corr-column.js      # Исправление
npm start                        # Перезапуск
```

### Тестирование изменений
```bash
npm test                         # Unit тесты
node test-parser.js              # Тест парсера
node test-comparison-logic.js    # Тест сравнения
```

---

## ⚠️ Частые ошибки

### Все товары в "Новинки"
```bash
node quick-diagnosis.js
node add-url-corr-column.js
```

### Ошибка подключения к БД
```
Проверьте путь к БД в настройках:
C:\Users\PC\Desktop\Project\diski_sait.db
```

### Парсер не находит товары
```bash
node test-selector.js            # Проверка селекторов
# Возможно, Avito изменил структуру страницы
```

### Капча Avito
```
Браузер откроется автоматически
Решите капчу вручную
Парсинг продолжится
```

---

## 📊 Ожидаемые результаты

### Парсинг
```
Parsing completed { count: 614 }
Normalization completed { raw: 614, unique: 600, duplicates: 14 }
```

### Сравнение
```
Comparison completed { 
  totalAvito: 600, 
  totalDb: 1234, 
  priceChanges: 50, 
  removed: 10, 
  new: 5 
}
```

### Диагностика
```
✅ Колонка url_corr существует
✅ Колонка url_corr заполнена полностью
✅ Нормализация корректна
✅ Совпадение найдено!
✅ Всё настроено правильно!
```

---

## 🔗 Полезные ссылки

- Дашборд: http://localhost:3002
- API: http://localhost:3002/api
- Документация: См. README.md

---

## 📚 Документация

| Файл | Описание |
|------|----------|
| `README.md` | Главная документация |
| `QUICK_START.md` | Быстрый старт |
| `FIX_NOVINKI_PROBLEM.md` | Решение проблемы "Все в новинки" |
| `TROUBLESHOOTING.md` | Решение проблем |
| `README_TEMP_TABLE.md` | О временной таблице |
| `FILES_OVERVIEW.md` | Обзор всех файлов |

---

## 💡 Советы

1. Всегда запускайте `quick-diagnosis.js` перед использованием
2. Проверяйте логи сервера при проблемах
3. Используйте `headless: false` для отладки парсера
4. Сохраняйте результаты парсинга в Excel для анализа
5. Регулярно обновляйте `url_corr` в БД

---

## 🆘 Получение помощи

1. Запустите `node quick-diagnosis.js`
2. Прочитайте `TROUBLESHOOTING.md`
3. Проверьте логи сервера
4. Предоставьте вывод диагностики

---

Сохраните эту шпаргалку для быстрого доступа! 📌
