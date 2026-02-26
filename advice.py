"""Совет дня: фильм / книга / цитата / рецепт. Детерминированный выбор от user_id и даты, кэш."""
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

# Кэш: (user_id, date_iso, advice_type) -> текст совета
_advice_cache: dict[tuple[int, str, str], str] = {}

# Типы советов (callback_data)
ADVICE_TYPES = ("advice_film", "advice_book", "advice_quote", "advice_recipe")

# Документация: https://poiskkino.dev/documentation
KINOPOISK_BASE = "https://api.poiskkino.dev/v1.4"
KINOPOISK_TIMEOUT = 10.0

# Статичные списки для детерминированного выбора (книга, цитата, рецепт)
BOOKS_OF_DAY = [
    ("«Мастер и Маргарита»", "М. Булгаков"),
    ("«Преступление и наказание»", "Ф. Достоевский"),
    ("«Война и мир»", "Л. Толстой"),
    ("«Евгений Онегин»", "А. Пушкин"),
    ("«Тихий Дон»", "М. Шолохов"),
    ("«Двенадцать стульев»", "И. Ильф и Е. Петров"),
    ("«Собачье сердце»", "М. Булгаков"),
    ("«Идиот»", "Ф. Достоевский"),
    ("«Анна Каренина»", "Л. Толстой"),
    ("«Отцы и дети»", "И. Тургенев"),
    ("«Герой нашего времени»", "М. Лермонтов"),
    ("«Обломов»", "И. Гончаров"),
    ("«Мёртвые души»", "Н. Гоголь"),
    ("«Капитанская дочка»", "А. Пушкин"),
    ("«Братья Карамазовы»", "Ф. Достоевский"),
]

QUOTES_OF_DAY = [
    "Умный любит учиться, дурак — учить. (А. Чехов)",
    "Жизнь даётся один раз, и хочется прожить её бодро. (А. Чехов)",
    "В человеке должно быть всё прекрасно. (А. Чехов)",
    "Дело не в дороге, которую мы выбираем; то, что внутри нас, заставляет нас выбирать дорогу. (О. Генри)",
    "Мы в ответе за тех, кого приручили. (А. де Сент-Экзюпери)",
    "Проснуться — уже мало. (Ф. Кафка)",
    "Терпение и труд всё перетрут.",
    "Не откладывай на завтра то, что можно сделать сегодня.",
    "Век живи — век учись.",
    "Дело мастера боится.",
    "После тёмной ночи бывает светлый день.",
    "Кто не рискует, тот не пьёт шампанского.",
    "Меньше слов — больше дела.",
    "Утро вечера мудренее.",
    "Дорогу осилит идущий.",
]

RECIPES_OF_DAY = [
    "Омлет с сыром: яйца, молоко, сыр, соль. Взбить, вылить на сковороду, посыпать сыром.",
    "Каша овсяная: хлопья, молоко/вода, соль, масло. Варить 5–7 минут.",
    "Салат Цезарь: листья салата, курица, сухарики, пармезан, соус Цезарь.",
    "Паста карбонара: спагетти, бекон, яйца, пармезан, чеснок.",
    "Суп тыквенный: тыква, лук, сливки, соль, перец. Пюрировать после варки.",
    "Жареная картошка с луком: картофель, лук, масло, соль.",
    "Сырники: творог, яйцо, мука, сахар. Обжарить с двух сторон.",
    "Блины: молоко, яйца, мука, соль, сахар. Жарить на сковороде.",
    "Гречка с грибами: гречка, грибы, лук, морковь.",
    "Куриный суп: курица, картофель, морковь, лапша, зелень.",
    "Творожная запеканка: творог, яйца, манка, сахар, изюм.",
    "Овощное рагу: картофель, кабачок, перец, томат, лук.",
    "Рис с овощами: рис, морковь, горошек, кукуруза, соевый соус.",
    "Яичница с помидорами: яйца, помидоры, зелень, соль.",
    "Сэндвич с авокадо: хлеб, авокадо, яйцо, соль, перец.",
]


def _date_key() -> str:
    """Текущая дата в UTC для единообразия (один день для всех)."""
    return datetime.now(timezone.utc).date().isoformat()


def _seed(user_id: int, date_str: str, advice_type: str) -> int:
    """Детерминированное целое от user_id, даты и типа совета."""
    raw = f"{user_id}_{date_str}_{advice_type}"
    return hash(raw) & 0x7FFFFFFF


def _cached_get(key: tuple[int, str, str]) -> str | None:
    return _advice_cache.get(key)


def _cached_set(key: tuple[int, str, str], value: str) -> None:
    _advice_cache[key] = value


async def _fetch_film_from_kinopoisk(user_id: int, date_str: str) -> str:
    """Запрос к API Кинопоиска: один фильм по детерминированной странице."""
    api_key = os.environ.get("KINOPOISK_API_KEY", "").strip()
    if not api_key:
        return "🎬 Фильм дня: настройте KINOPOISK_API_KEY в .env для подбора фильма."

    page = (_seed(user_id, date_str, "advice_film") % 50) + 1  # страницы 1–50
    url = f"{KINOPOISK_BASE}/movie"
    params = {
        "limit": 1,
        "page": page,
        "rating.kp": "7-10",
        "sortField": "rating.kp",
        "sortType": "-1",
    }
    headers = {"X-API-KEY": api_key}

    try:
        async with httpx.AsyncClient(timeout=KINOPOISK_TIMEOUT) as client:
            resp = await client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        return "🎬 Фильм дня: сервер не ответил вовремя. Попробуйте позже."
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            return "🎬 Фильм дня: неверный KINOPOISK_API_KEY. Проверьте .env."
        return f"🎬 Фильм дня: ошибка API (код {e.response.status_code}). Попробуйте позже."
    except Exception:
        return "🎬 Фильм дня: не удалось загрузить данные. Попробуйте позже."

    docs = data.get("docs") or []
    if not docs:
        return "🎬 Фильм дня: на сегодня подбор закончился. Загляните завтра!"

    film: dict[str, Any] = docs[0]
    name = film.get("name") or film.get("alternativeName") or "Без названия"
    year = film.get("year") or ""
    rating = film.get("rating", {}).get("kp") if isinstance(film.get("rating"), dict) else film.get("rating")
    desc = film.get("shortDescription") or film.get("description") or ""

    lines = [f"🎬 Фильм дня: {name}"]
    if year:
        lines.append(f"Год: {year}")
    if rating:
        lines.append(f"Рейтинг КП: {rating}")
    if desc:
        lines.append(f"\n{desc[:400]}{'…' if len(desc) > 400 else ''}")
    return "\n".join(lines)


def _get_book(user_id: int, date_str: str) -> str:
    idx = _seed(user_id, date_str, "advice_book") % len(BOOKS_OF_DAY)
    title, author = BOOKS_OF_DAY[idx]
    return f"📖 Книга дня: {title}\nАвтор: {author}"


def _get_quote(user_id: int, date_str: str) -> str:
    idx = _seed(user_id, date_str, "advice_quote") % len(QUOTES_OF_DAY)
    return f"💬 Цитата дня:\n{QUOTES_OF_DAY[idx]}"


def _get_recipe(user_id: int, date_str: str) -> str:
    idx = _seed(user_id, date_str, "advice_recipe") % len(RECIPES_OF_DAY)
    return f"🍳 Рецепт дня:\n{RECIPES_OF_DAY[idx]}"


async def get_advice(user_id: int, advice_type: str) -> str:
    """
    Возвращает совет дня для пользователя. Один и тот же пользователь в один день
    получает один и тот же контент. Результат кэшируется.
    """
    date_str = _date_key()
    key = (user_id, date_str, advice_type)

    cached = _cached_get(key)
    if cached is not None:
        return cached

    if advice_type == "advice_film":
        text = await _fetch_film_from_kinopoisk(user_id, date_str)
    elif advice_type == "advice_book":
        text = _get_book(user_id, date_str)
    elif advice_type == "advice_quote":
        text = _get_quote(user_id, date_str)
    elif advice_type == "advice_recipe":
        text = _get_recipe(user_id, date_str)
    else:
        text = "Выберите тип совета: фильм, книга, цитата или рецепт."

    _cached_set(key, text)
    return text
