# Telegram-бот «Погода в городах России»

Бот показывает список городов России по команде `/start`. По нажатию на город отправляется прогноз погоды. Данные погоды берутся из открытого API [Open-Meteo](https://open-meteo.com/) (без API-ключа).

## Требования

- Python 3.11+
- Токен бота от [@BotFather](https://t.me/BotFather) в Telegram

## Установка

1. Клонируйте репозиторий и перейдите в каталог проекта.

2. Создайте виртуальное окружение и установите зависимости:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   pip install -r requirements.txt
   ```

3. Создайте файл `.env` в корне проекта (или задайте переменную окружения):

   ```
   TELEGRAM_BOT_TOKEN=ваш_токен_от_BotFather
   ```

   Можно скопировать `.env.example` в `.env` и подставить токен. Файл `.env` не коммитится в репозиторий.

## Запуск

```bash
python main.py
```

Бот работает в режиме long polling. После запуска нажмите в Telegram `/start` и выберите город из списка кнопок.

## Структура проекта

- `main.py` — точка входа, запуск бота
- `bot.py` — обработчики команд и callback-кнопок, сборка `Application`
- `weather.py` — запрос к Open-Meteo API и форматирование прогноза
- `config.py` — список городов России с координатами
- `requirements.txt` — зависимости

## Лицензия и атрибуция

Данные погоды предоставлены [Open-Meteo](https://open-meteo.com/) (лицензия [CC BY 4.0](https://open-meteo.com/en/license)). В ответах бота указан источник.
