"""Telegram-бот: погода в городах России."""
import os
from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes

from config import CITIES
from weather import get_weather


def _build_cities_keyboard() -> InlineKeyboardMarkup:
    """Строит клавиатуру с кнопками городов (по 2 в ряд)."""
    keys = list(CITIES.keys())
    rows = []
    for i in range(0, len(keys), 2):
        row = [
            InlineKeyboardButton(keys[i], callback_data=keys[i]),
        ]
        if i + 1 < len(keys):
            row.append(InlineKeyboardButton(keys[i + 1], callback_data=keys[i + 1]))
        rows.append(row)
    return InlineKeyboardMarkup(rows)


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик команды /start: приветствие и список городов."""
    text = (
        "Привет! Выберите город, чтобы получить прогноз погоды.\n\n"
        "Нажмите на кнопку с названием города:"
    )
    await update.message.reply_text(
        text,
        reply_markup=_build_cities_keyboard(),
    )


async def on_city_selected(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик нажатия на кнопку города: запрос погоды и отправка ответа."""
    query = update.callback_query
    await query.answer()

    city_name = query.data
    if city_name not in CITIES:
        await query.edit_message_text("Город не найден. Нажмите /start для выбора города.")
        return

    lat, lon = CITIES[city_name]
    await query.edit_message_text(f"⏳ Загружаю погоду для {city_name}...")

    forecast = await get_weather(lat, lon)
    await query.edit_message_text(f"🌤 Погода в городе {city_name}\n\n{forecast}")


def run_bot() -> None:
    """Собирает приложение и запускает polling."""
    load_dotenv()
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit("Укажите TELEGRAM_BOT_TOKEN в переменных окружения или в .env")

    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CallbackQueryHandler(on_city_selected))

    app.run_polling(allowed_updates=Update.ALL_TYPES)
