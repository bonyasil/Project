"""Telegram-бот: погода в городах России."""
import logging
import os
from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes

from config import CITIES
from weather import get_weather
from advice import get_advice

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# Включить для детального лога запросов к Telegram API (причина отсутствия кнопок):
# logging.getLogger("telegram").setLevel(logging.DEBUG)

# Callback data для кнопок «совет дня»
ADVICE_FILM = "advice_film"
ADVICE_BOOK = "advice_book"
ADVICE_QUOTE = "advice_quote"
ADVICE_RECIPE = "advice_recipe"


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


def _build_advice_keyboard() -> InlineKeyboardMarkup:
    """Клавиатура из 4 кнопок: фильм / книга / цитата / рецепт дня."""
    keyboard = [
        [
            InlineKeyboardButton("🎬 Фильм дня", callback_data=ADVICE_FILM),
            InlineKeyboardButton("📖 Книга дня", callback_data=ADVICE_BOOK),
        ],
        [
            InlineKeyboardButton("💬 Цитата дня", callback_data=ADVICE_QUOTE),
            InlineKeyboardButton("🍳 Рецепт дня", callback_data=ADVICE_RECIPE),
        ],
    ]
    return InlineKeyboardMarkup(keyboard)


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


# async def cmd_test_buttons(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
#     """
#     Диагностика: отправляет сообщение с кнопками «Совет дня» без погоды.
#     """
#     logger.info("[DIAG] /test_buttons вызвана, chat_id=%s", update.effective_chat.id)
#     keyboard = _build_advice_keyboard()
#     msg = await update.message.reply_text(
#         "Проверка: видны ли кнопки? (команда /test_buttons)",
#         reply_markup=keyboard,
#     )
#     logger.info("[DIAG] Сообщение с кнопками отправлено, message_id=%s", msg.message_id)


async def on_city_selected(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик нажатия на кнопку города: запрос погоды и отправка ответа."""
    query = update.callback_query
    city_name = query.data
    chat_id = update.effective_chat.id
    # logger.info("[DIAG] on_city_selected: callback_data=%r, chat_id=%s", city_name, chat_id)

    await query.answer()

    if city_name not in CITIES:
        # logger.warning("[DIAG] Город не в CITIES: %r", city_name)
        await query.edit_message_text("Город не найден. Нажмите /start для выбора города.")
        return

    # logger.info("[DIAG] Шаг 1: редактирую сообщение на «Загружаю...»")
    lat, lon = CITIES[city_name]
    await query.edit_message_text(f"⏳ Загружаю погоду для {city_name}...")

    # logger.info("[DIAG] Шаг 2: запрос погоды")
    forecast = await get_weather(lat, lon)

    # logger.info("[DIAG] Шаг 3: редактирую сообщение — погода и клавиатура «Совет дня» одним вызовом")
    text = f"🌤 Погода в городе {city_name}\n\n{forecast}"
    keyboard = _build_advice_keyboard()
    try:
        await query.edit_message_text(text=text, reply_markup=keyboard)
        # logger.info("[DIAG] Клавиатура прикреплена к сообщению с погодой.")
    except Exception as e:
        logger.exception("[DIAG] Ошибка edit_message_text с reply_markup: %s", e)
        await query.edit_message_text(text=text)


async def on_advice_selected(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик кнопок «совет дня»: детерминированный контент, результат из кэша."""
    query = update.callback_query
    await query.answer()

    advice_type = query.data
    if advice_type not in (ADVICE_FILM, ADVICE_BOOK, ADVICE_QUOTE, ADVICE_RECIPE):
        return

    user_id = query.from_user.id if query.from_user else 0
    text = await get_advice(user_id, advice_type)

    await query.message.reply_text(text)


def run_bot() -> None:
    """Собирает приложение и запускает polling."""
    load_dotenv()
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit("Укажите TELEGRAM_BOT_TOKEN в переменных окружения или в .env")

    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("start", cmd_start))
    # app.add_handler(CommandHandler("test_buttons", cmd_test_buttons))
    app.add_handler(CallbackQueryHandler(on_advice_selected, pattern="^advice_"))
    app.add_handler(CallbackQueryHandler(on_city_selected))

    # logger.info("[DIAG] Обработчики: start, test_buttons, advice_*, city_callback. Запуск polling.")
    app.run_polling(allowed_updates=Update.ALL_TYPES)
