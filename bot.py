"""Telegram-бот: погода в городах России."""
import logging
import os
from dotenv import load_dotenv
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.constants import ParseMode
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
CALLBACK_MAIN_MENU = "menu_main"


def _build_cities_keyboard() -> InlineKeyboardMarkup:
    """Строит клавиатуру с кнопками городов (по 2 в ряд). При возможности — синие кнопки (primary)."""
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
    """Клавиатура из 4 кнопок советов и кнопки «В главное меню»."""
    def btn(text: str, data: str, style: str | None = None) -> InlineKeyboardButton:
        if style:
            try:
                return InlineKeyboardButton(text, callback_data=data, style=style)
            except TypeError:
                return InlineKeyboardButton(text, callback_data=data)
        return InlineKeyboardButton(text, callback_data=data)

    keyboard = [
        [
            btn("🎬 Фильм дня", ADVICE_FILM, "primary"),
            btn("📖 Книга дня", ADVICE_BOOK, "primary"),
        ],
        [
            btn("💬 Цитата дня", ADVICE_QUOTE, "success"),
            btn("🍳 Рецепт дня", ADVICE_RECIPE, "success"),
        ],
        [btn("◀️ В главное меню", CALLBACK_MAIN_MENU, "danger")],
    ]
    return InlineKeyboardMarkup(keyboard)


def _build_back_to_menu_keyboard() -> InlineKeyboardMarkup:
    """Клавиатура с одной кнопкой возврата в главное меню (под ответами советов)."""
    def btn(text: str, data: str, style: str | None = None) -> InlineKeyboardButton:
        if style:
            try:
                return InlineKeyboardButton(text, callback_data=data, style=style)
            except TypeError:
                return InlineKeyboardButton(text, callback_data=data)
        return InlineKeyboardButton(text, callback_data=data)

    return InlineKeyboardMarkup([[btn("◀️ В главное меню", CALLBACK_MAIN_MENU, "danger")]])


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик команды /start: персональное приветствие и список городов."""
    first_name = (update.effective_user and update.effective_user.first_name) or "гость"
    text = (
        f"Привет, <b>{_escape_html(first_name)}</b>! 👋\n\n"
        "Выберите город — пришлю прогноз погоды.\n\n"
        "Нажмите на кнопку с названием города:"
    )
    await update.message.reply_text(
        text,
        reply_markup=_build_cities_keyboard(),
        parse_mode=ParseMode.HTML,
    )


def _escape_html(s: str) -> str:
    """Экранирует символы для HTML-сообщений Telegram."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


async def on_main_menu_pressed(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик кнопки «В главное меню»: отправка приветствия и выбора городов."""
    query = update.callback_query
    await query.answer()

    first_name = (query.from_user and query.from_user.first_name) or "гость"
    text = (
        f"Привет, <b>{_escape_html(first_name)}</b>! 👋\n\n"
        "Выберите город — пришлю прогноз погоды.\n\n"
        "Нажмите на кнопку с названием города:"
    )
    await query.message.reply_text(
        text,
        reply_markup=_build_cities_keyboard(),
        parse_mode=ParseMode.HTML,
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
    first_name = (query.from_user and query.from_user.first_name) or ""
    loading_msg = f"⏳ Загружаю погоду для {city_name}..."
    if first_name:
        loading_msg = f"{first_name}, {loading_msg.lower()}"
    lat, lon = CITIES[city_name]
    await query.edit_message_text(loading_msg)

    # logger.info("[DIAG] Шаг 2: запрос погоды")
    forecast = await get_weather(lat, lon)

    # logger.info("[DIAG] Шаг 3: редактирую сообщение — погода и клавиатура «Совет дня» одним вызовом")
    header = f"🌤️ <b>Погода в {_escape_html(city_name)}</b>"
    content_day = "\n\n🎁 <b>Контент дня</b>\nКнопки ниже: фильм, книга, цитата, рецепт."
    text = f"{header}\n\n{forecast}{content_day}"
    keyboard = _build_advice_keyboard()
    try:
        await query.edit_message_text(
            text=text,
            reply_markup=keyboard,
            parse_mode=ParseMode.HTML,
        )
        # logger.info("[DIAG] Клавиатура прикреплена к сообщению с погодой.")
    except Exception as e:
        logger.exception("[DIAG] Ошибка edit_message_text с reply_markup: %s", e)
        await query.edit_message_text(text=text, parse_mode=ParseMode.HTML)


async def on_advice_selected(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик кнопок «совет дня»: детерминированный контент, результат из кэша. При наличии — фото (постер/обложка/картинка)."""
    query = update.callback_query
    await query.answer()

    advice_type = query.data
    if advice_type not in (ADVICE_FILM, ADVICE_BOOK, ADVICE_QUOTE, ADVICE_RECIPE):
        return

    user_id = query.from_user.id if query.from_user else 0
    result = await get_advice(user_id, advice_type)
    text = result["text"]
    photo_url = result.get("photo_url")

    # Лимит подписи к фото в Telegram — 1024 символа (после разбора HTML-сущностей).
    CAPTION_MAX_LEN = 1020
    caption = text if len(text) <= CAPTION_MAX_LEN else text[: CAPTION_MAX_LEN - 1] + "…"

    if photo_url:
        try:
            await query.message.reply_photo(
                photo=photo_url,
                caption=caption,
                parse_mode=ParseMode.HTML,
                reply_markup=_build_back_to_menu_keyboard(),
            )
        except Exception as e1:
            logger.warning(
                "reply_photo с клавиатурой не удался (%s): %s. Пробую без клавиатуры.",
                advice_type,
                e1,
            )
            try:
                await query.message.reply_photo(
                    photo=photo_url,
                    caption=caption,
                    parse_mode=ParseMode.HTML,
                )
                await query.message.reply_text(
                    "◀️ Возврат:",
                    reply_markup=_build_back_to_menu_keyboard(),
                )
            except Exception as e2:
                logger.warning(
                    "reply_photo без клавиатуры тоже не удался (%s): %s. Отправляю только текст.",
                    advice_type,
                    e2,
                )
                await query.message.reply_text(
                    text,
                    parse_mode=ParseMode.HTML,
                    reply_markup=_build_back_to_menu_keyboard(),
                )
    else:
        await query.message.reply_text(
            text,
            parse_mode=ParseMode.HTML,
            reply_markup=_build_back_to_menu_keyboard(),
        )


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
    app.add_handler(CallbackQueryHandler(on_main_menu_pressed, pattern="^menu_"))
    app.add_handler(CallbackQueryHandler(on_city_selected))

    # logger.info("[DIAG] Обработчики: start, test_buttons, advice_*, city_callback. Запуск polling.")
    app.run_polling(allowed_updates=Update.ALL_TYPES)
