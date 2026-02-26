"""Запрос погоды через Open-Meteo API (бесплатно, без ключа)."""
import httpx
from typing import Any

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
REQUEST_TIMEOUT = 10.0

# Коды погоды Open-Meteo -> короткое описание на русском
WEATHER_CODES_RU: dict[int, str] = {
    0: "Ясно",
    1: "Преимущественно ясно",
    2: "Переменная облачность",
    3: "Пасмурно",
    45: "Туман",
    48: "Изморозь",
    51: "Морось",
    53: "Морось",
    55: "Морось",
    61: "Дождь",
    63: "Дождь",
    65: "Ливень",
    66: "Ледяной дождь",
    67: "Ледяной ливень",
    71: "Снег",
    73: "Снег",
    75: "Снегопад",
    77: "Снежные зёрна",
    80: "Ливень",
    81: "Ливень",
    82: "Сильный ливень",
    85: "Снегопад",
    86: "Сильный снегопад",
    95: "Гроза",
    96: "Гроза с градом",
    99: "Гроза с сильным градом",
}


def _format_forecast(data: dict[str, Any]) -> str:
    """Форматирует ответ API в читаемый текст для Telegram."""
    current = data.get("current", {})
    daily = data.get("daily", {})

    temp = current.get("temperature_2m")
    code = current.get("weather_code", 0)
    wind_speed = current.get("wind_speed_10m")
    humidity = current.get("relative_humidity_2m")
    desc = WEATHER_CODES_RU.get(int(code), "—")

    lines = [
        f"🌡 Температура: {temp} °C",
        f"☁️ Погода: {desc}",
        f"💨 Ветер: {wind_speed} км/ч",
        f"💧 Влажность: {humidity} %",
    ]

    daily_temps = daily.get("temperature_2m_max") or []
    daily_mins = daily.get("temperature_2m_min") or []
    if len(daily_temps) > 1 and len(daily_mins) > 1:
        lines.append("")
        lines.append("📅 На завтра:")
        lines.append(f"  макс {daily_temps[1]} °C, мин {daily_mins[1]} °C")

    lines.append("")
    lines.append("Данные: Open-Meteo (open-meteo.com)")
    return "\n".join(lines)


async def get_weather(lat: float, lon: float) -> str:
    """
    Запрашивает прогноз погоды в Open-Meteo по координатам.
    Возвращает форматированную строку для отправки в Telegram.
    При ошибке возвращает сообщение об ошибке (не бросает исключение).
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": ["temperature_2m", "relative_humidity_2m", "weather_code", "wind_speed_10m"],
        "daily": ["temperature_2m_max", "temperature_2m_min"],
        "timezone": "auto",
    }
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(OPEN_METEO_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except httpx.TimeoutException:
        return "⏱ Превышено время ожидания ответа от сервера погоды. Попробуйте позже."
    except httpx.HTTPStatusError as e:
        return f"❌ Ошибка сервера погоды (код {e.response.status_code}). Попробуйте позже."
    except Exception:
        return "❌ Не удалось получить погоду. Попробуйте позже."

    return _format_forecast(data)
