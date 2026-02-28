"""Совет дня: фильм / книга / цитата / рецепт. Детерминированный выбор от user_id и даты, кэш."""
import os
from datetime import datetime, timezone
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

# Кэш: (user_id, date_iso, advice_type) -> {"text": str, "photo_url": str | None}
_advice_cache: dict[tuple[int, str, str], dict[str, str | None]] = {}

# Типы советов (callback_data)
ADVICE_TYPES = ("advice_film", "advice_book", "advice_quote", "advice_recipe")

# Документация: https://poiskkino.dev/documentation
KINOPOISK_BASE = "https://api.poiskkino.dev/v1.4"
KINOPOISK_TIMEOUT = 10.0

# Статичные списки для детерминированного выбора (книга, цитата, рецепт)
# Книги: (название, автор, url_обложки). Open Library: https://covers.openlibrary.org/b/olid/OLID-M.jpg
BOOKS_OF_DAY = [
    ("«Мастер и Маргарита»", "М. Булгаков", "https://covers.openlibrary.org/b/olid/OL73599M-M.jpg"),
    ("«Преступление и наказание»", "Ф. Достоевский", "https://covers.openlibrary.org/b/olid/OL25783W-M.jpg"),
    ("«Война и мир»", "Л. Толстой", "https://covers.openlibrary.org/b/olid/OL52977W-M.jpg"),
    ("«Евгений Онегин»", "А. Пушкин", "https://covers.openlibrary.org/b/olid/OL65311W-M.jpg"),
    ("«Тихий Дон»", "М. Шолохов", "https://covers.openlibrary.org/b/olid/OL27283W-M.jpg"),
    ("«Двенадцать стульев»", "И. Ильф и Е. Петров", "https://covers.openlibrary.org/b/olid/OL74889M-M.jpg"),
    ("«Собачье сердце»", "М. Булгаков", "https://covers.openlibrary.org/b/olid/OL73598M-M.jpg"),
    ("«Идиот»", "Ф. Достоевский", "https://covers.openlibrary.org/b/olid/OL25784W-M.jpg"),
    ("«Анна Каренина»", "Л. Толстой", "https://covers.openlibrary.org/b/olid/OL52978W-M.jpg"),
    ("«Отцы и дети»", "И. Тургенев", "https://covers.openlibrary.org/b/olid/OL25788W-M.jpg"),
    ("«Герой нашего времени»", "М. Лермонтов", "https://covers.openlibrary.org/b/olid/OL74890M-M.jpg"),
    ("«Обломов»", "И. Гончаров", "https://covers.openlibrary.org/b/olid/OL25786W-M.jpg"),
    ("«Мёртвые души»", "Н. Гоголь", "https://covers.openlibrary.org/b/olid/OL25785W-M.jpg"),
    ("«Капитанская дочка»", "А. Пушкин", "https://covers.openlibrary.org/b/olid/OL65312W-M.jpg"),
    ("«Братья Карамазовы»", "Ф. Достоевский", "https://covers.openlibrary.org/b/olid/OL25782W-M.jpg"),
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

# URL картинок для цитат дня (нейтральный фон: природа, книги). Выбор по seed от user_id и даты.
QUOTE_IMAGES = [
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600",
    "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=600",
    "https://images.unsplash.com/photo-1495446815901-a7297e633e8d?w=600",
    "https://images.unsplash.com/photo-1473773508845-188df298d2d1?w=600",
    "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=600",
    "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600",
    "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600",
    "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=600",
]

RECIPES_OF_DAY = [
    # (название, ингредиенты, краткое_приготовление)
    (
        "Омлет с сыром",
        "яйца, молоко, сыр, соль",
        "Взбейте яйца с молоком и солью. Вылейте на разогретую сковороду с маслом, посыпьте сыром и готовьте под крышкой на среднем огне 3–4 минуты.",
    ),
    (
        "Каша овсяная",
        "хлопья, молоко или вода, соль, масло",
        "Залейте хлопья молоком или водой, добавьте соль. Варите на среднем огне 5–7 минут, помешивая. Перед подачей добавьте масло.",
    ),
    (
        "Салат Цезарь",
        "листья салата, курица, сухарики, пармезан, соус Цезарь",
        "Обжарьте куриное филе, нарежьте полосками. Выложите на листья салата, сбрызните соусом, посыпьте сухариками и пармезаном.",
    ),
    (
        "Паста карбонара",
        "спагетти, бекон, яйца, пармезан, чеснок",
        "Отварите спагетти. Обжарьте бекон с чесноком. Смешайте яичные желтки с тёртым пармезаном. Соедините пасту с беконом и яичной смесью, быстро перемешайте.",
    ),
    (
        "Суп тыквенный",
        "тыква, лук, сливки, соль, перец",
        "Отварите нарезанную тыкву и лук до мягкости. Пюрируйте блендером, влейте сливки, приправьте солью и перцем. Прогрейте и подавайте.",
    ),
    (
        "Жареная картошка с луком",
        "картофель, лук, масло, соль",
        "Нарежьте картофель ломтиками, лук полукольцами. Обжаривайте картофель на масле до румяной корочки, добавьте лук, посолите и доведите до готовности.",
    ),
    (
        "Сырники",
        "творог, яйцо, мука, сахар",
        "Смешайте творог с яйцом, мукой и сахаром. Сформируйте лепёшки, обваляйте в муке и обжарьте на сковороде с двух сторон до золотистой корочки.",
    ),
    (
        "Блины",
        "молоко, яйца, мука, соль, сахар",
        "Взбейте яйца с солью и сахаром, влейте молоко, добавьте муку и перемешайте до однородности. Жарьте тонкие блины на смазанной маслом сковороде с двух сторон.",
    ),
    (
        "Гречка с грибами",
        "гречка, грибы, лук, морковь",
        "Отварите гречку. Отдельно обжарьте грибы с луком и морковью. Соедините гречку с поджаркой, приправьте по вкусу.",
    ),
    (
        "Куриный суп",
        "курица, картофель, морковь, лапша, зелень",
        "Сварите бульон из курицы. Добавьте нарезанный картофель и морковь, через 10 минут — лапшу. Готовьте до мягкости, перед подачей посыпьте зеленью.",
    ),
    (
        "Творожная запеканка",
        "творог, яйца, манка, сахар, изюм",
        "Смешайте творог с яйцами, манкой, сахаром и изюмом. Выложите в смазанную форму и запекайте при 180 °C 35–40 минут до румяной корочки.",
    ),
    (
        "Овощное рагу",
        "картофель, кабачок, перец, томат, лук",
        "Обжарьте лук, добавьте нарезанные овощи, тушите под крышкой 20–25 минут. В конце добавьте томат, соль и перец по вкусу.",
    ),
    (
        "Рис с овощами",
        "рис, морковь, горошек, кукуруза, соевый соус",
        "Отварите рис. Отдельно обжарьте морковь, добавьте горошек и кукурузу. Смешайте с рисом, заправьте соевым соусом.",
    ),
    (
        "Яичница с помидорами",
        "яйца, помидоры, зелень, соль",
        "Обжарьте дольки помидоров на сковороде 1–2 минуты. Вбейте яйца, посолите, готовьте до желаемой степени. Посыпьте зеленью.",
    ),
    (
        "Сэндвич с авокадо",
        "хлеб, авокадо, яйцо, соль, перец",
        "Подсушите хлеб на сковороде. Разомните авокадо вилкой, посолите и поперчите. Сверху выложите жареное яйцо и накройте вторым ломтиком хлеба.",
    ),
]


def _date_key() -> str:
    """Текущая дата в UTC для единообразия (один день для всех)."""
    return datetime.now(timezone.utc).date().isoformat()


def _seed(user_id: int, date_str: str, advice_type: str) -> int:
    """Детерминированное целое от user_id, даты и типа совета."""
    raw = f"{user_id}_{date_str}_{advice_type}"
    return hash(raw) & 0x7FFFFFFF


def _cached_get(key: tuple[int, str, str]) -> dict[str, str | None] | None:
    return _advice_cache.get(key)


def _cached_set(key: tuple[int, str, str], value: dict[str, str | None]) -> None:
    _advice_cache[key] = value


def _escape_html(s: str) -> str:
    """Экранирует символы для HTML в Telegram."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


async def _fetch_film_from_kinopoisk(user_id: int, date_str: str) -> dict[str, str | None]:
    """Запрос к API Кинопоиска: один фильм по детерминированной странице. Возвращает text (HTML) и photo_url при наличии."""
    api_key = os.environ.get("KINOPOISK_API_KEY", "").strip()
    if not api_key:
        return {"text": "🎬 <b>Фильм дня</b>: настройте KINOPOISK_API_KEY в .env для подбора фильма.", "photo_url": None}

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
        return {"text": "🎬 <b>Фильм дня</b>: сервер не ответил вовремя. Попробуйте позже.", "photo_url": None}
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            return {"text": "🎬 <b>Фильм дня</b>: неверный KINOPOISK_API_KEY. Проверьте .env.", "photo_url": None}
        return {"text": f"🎬 <b>Фильм дня</b>: ошибка API (код {e.response.status_code}). Попробуйте позже.", "photo_url": None}
    except Exception:
        return {"text": "🎬 <b>Фильм дня</b>: не удалось загрузить данные. Попробуйте позже.", "photo_url": None}

    docs = data.get("docs") or []
    if not docs:
        return {"text": "🎬 <b>Фильм дня</b>: на сегодня подбор закончился. Загляните завтра!", "photo_url": None}

    film: dict[str, Any] = docs[0]
    name = film.get("name") or film.get("alternativeName") or "Без названия"
    year = film.get("year") or ""
    rating = film.get("rating", {}).get("kp") if isinstance(film.get("rating"), dict) else film.get("rating")
    desc = film.get("shortDescription") or film.get("description") or ""

    # Постер: poiskkino может возвращать poster как dict (url/previewUrl) или как строку с URL
    poster = film.get("poster")
    photo_url = None
    if isinstance(poster, dict):
        photo_url = poster.get("url") or poster.get("previewUrl")
    elif isinstance(poster, str) and poster.strip().startswith("http"):
        photo_url = poster.strip()
    if not photo_url or not str(photo_url).startswith("http"):
        photo_url = None

    lines = [f"🎬 <b>Фильм дня</b>: {_escape_html(str(name))}"]
    if year:
        lines.append(f"Год: {year}")
    if rating:
        lines.append(f"Рейтинг КП: {rating}")
    if desc:
        safe_desc = _escape_html(desc[:400]) + ("…" if len(desc) > 400 else "")
        lines.append(f"\n{safe_desc}")
    return {"text": "\n".join(lines), "photo_url": photo_url}


def _get_book(user_id: int, date_str: str) -> dict[str, str | None]:
    idx = _seed(user_id, date_str, "advice_book") % len(BOOKS_OF_DAY)
    entry = BOOKS_OF_DAY[idx]
    title = entry[0]
    author = entry[1]
    cover_url = entry[2] if len(entry) > 2 else None
    if cover_url and not str(cover_url).strip().startswith("http"):
        cover_url = None
    text = f"📖 <b>Книга дня</b>: {_escape_html(title)}\nАвтор: {_escape_html(author)}"
    return {"text": text, "photo_url": cover_url}


def _get_quote(user_id: int, date_str: str) -> dict[str, str | None]:
    idx = _seed(user_id, date_str, "advice_quote") % len(QUOTES_OF_DAY)
    idx_img = _seed(user_id, date_str, "advice_quote_img") % len(QUOTE_IMAGES)
    text = f"💬 <b>Цитата дня</b>:\n{_escape_html(QUOTES_OF_DAY[idx])}"
    return {"text": text, "photo_url": QUOTE_IMAGES[idx_img]}


def _get_recipe(user_id: int, date_str: str) -> dict[str, str | None]:
    idx = _seed(user_id, date_str, "advice_recipe") % len(RECIPES_OF_DAY)
    entry = RECIPES_OF_DAY[idx]
    name = entry[0]
    ingredients = entry[1]
    steps = entry[2]
    lines = [
        f"🍳 <b>Рецепт дня</b>: {_escape_html(name)}",
        f"\n<b>Ингредиенты:</b> {_escape_html(ingredients)}",
        f"\n<b>Приготовление:</b> {_escape_html(steps)}",
    ]
    return {"text": "".join(lines), "photo_url": None}


async def get_advice(user_id: int, advice_type: str) -> dict[str, str | None]:
    """
    Возвращает совет дня для пользователя: {"text": str, "photo_url": str | None}.
    Один и тот же пользователь в один день получает один и тот же контент. Результат кэшируется.
    """
    date_str = _date_key()
    key = (user_id, date_str, advice_type)

    cached = _cached_get(key)
    if cached is not None:
        return cached

    if advice_type == "advice_film":
        result = await _fetch_film_from_kinopoisk(user_id, date_str)
    elif advice_type == "advice_book":
        result = _get_book(user_id, date_str)
    elif advice_type == "advice_quote":
        result = _get_quote(user_id, date_str)
    elif advice_type == "advice_recipe":
        result = _get_recipe(user_id, date_str)
    else:
        result = {"text": "Выберите тип совета: фильм, книга, цитата или рецепт.", "photo_url": None}

    _cached_set(key, result)
    return result
