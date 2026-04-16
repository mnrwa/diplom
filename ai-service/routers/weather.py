from fastapi import APIRouter, Query
import httpx
import os

router = APIRouter(tags=["weather"])

OPENWEATHER_URL = "https://api.openweathermap.org/data/2.5/weather"


def weather_to_risk(data: dict) -> float:
    """Convert OpenWeatherMap response to a risk score 0-1."""
    if not data:
        return 0.0

    risk = 0.0
    weather_ids = [w["id"] for w in data.get("weather", [])]

    for wid in weather_ids:
        if wid < 300:        # Thunderstorm
            risk = max(risk, 0.9)
        elif wid < 400:      # Drizzle
            risk = max(risk, 0.3)
        elif wid < 600:      # Rain
            risk = max(risk, 0.5)
        elif wid < 700:      # Snow
            risk = max(risk, 0.7)
        elif wid < 800:      # Atmosphere (fog, mist)
            risk = max(risk, 0.6)

    # Wind speed (m/s)
    wind = data.get("wind", {}).get("speed", 0)
    if wind > 15:
        risk = max(risk, 0.6)
    elif wind > 10:
        risk = max(risk, 0.4)

    # Visibility (meters)
    visibility = data.get("visibility", 10000)
    if visibility < 1000:
        risk = max(risk, 0.8)
    elif visibility < 3000:
        risk = max(risk, 0.5)

    return round(risk, 3)


@router.get("/weather")
async def get_weather(lat: float = Query(...), lon: float = Query(...)):
    api_key = os.getenv("OPENWEATHER_API_KEY", "demo_key")

    # Demo mode: return fake data if no real key
    if api_key in ("demo_key", "", None):
        return {
            "temperature": 12.5,
            "description": "Облачно (демо-режим)",
            "wind_speed": 5.2,
            "visibility": 8000,
            "risk_score": 0.15,
            "demo": True,
        }

    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(
                OPENWEATHER_URL,
                params={"lat": lat, "lon": lon, "appid": api_key, "units": "metric", "lang": "ru"},
                timeout=5.0,
            )
            data = r.json()
            return {
                "temperature": data.get("main", {}).get("temp"),
                "description": data.get("weather", [{}])[0].get("description"),
                "wind_speed": data.get("wind", {}).get("speed"),
                "visibility": data.get("visibility"),
                "risk_score": weather_to_risk(data),
                "raw": data,
            }
        except Exception as e:
            return {"error": str(e), "risk_score": 0.0}
