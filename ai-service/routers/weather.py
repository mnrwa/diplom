from fastapi import APIRouter, Query
import httpx
import os
import asyncio

router = APIRouter(tags=["weather"])

YANDEX_WEATHER_URL = "https://api.weather.yandex.ru/v2/forecast"
OPENWEATHER_URL = "https://api.openweathermap.org/data/2.5/weather"


def weather_to_risk(data: dict) -> float:
    """Convert a normalized weather payload to a risk score 0-1."""
    if not data:
        return 0.0

    risk = 0.0
    condition = str(data.get("condition") or "").lower()

    if "thunderstorm" in condition:
        risk = max(risk, 0.9)
    elif any(value in condition for value in ("snow", "hail")):
        risk = max(risk, 0.7)
    elif any(value in condition for value in ("rain", "shower")):
        risk = max(risk, 0.5)
    elif any(value in condition for value in ("fog", "mist")):
        risk = max(risk, 0.6)
    elif any(value in condition for value in ("overcast", "cloudy")):
        risk = max(risk, 0.15)

    wind = data.get("wind_speed") or 0
    if wind > 15:
        risk = max(risk, 0.6)
    elif wind > 10:
        risk = max(risk, 0.4)

    return round(risk, 3)


def precipitation_label(prec_type: int | None) -> str:
    return {
        0: "no_precipitation",
        1: "rain",
        2: "sleet",
        3: "snow",
        4: "hail",
    }.get(prec_type or 0, "unknown")


def normalize_yandex_fact(data: dict) -> dict:
    fact = data.get("fact", {})
    normalized = {
        "temperature": fact.get("temp"),
        "description": fact.get("condition"),
        "condition": fact.get("condition"),
        "wind_speed": fact.get("wind_speed"),
        "humidity": fact.get("humidity"),
        "pressure_mm": fact.get("pressure_mm"),
        "feels_like": fact.get("feels_like"),
        "precipitation_type": precipitation_label(fact.get("prec_type")),
        "precipitation_strength": fact.get("prec_strength") or 0,
    }
    normalized["risk_score"] = weather_to_risk(normalized)
    return normalized


async def fetch_yandex_weather(
    client: httpx.AsyncClient,
    *,
    lat: float,
    lon: float,
    api_key: str,
) -> dict:
    response = await client.get(
        YANDEX_WEATHER_URL,
        params={
            "lat": lat,
            "lon": lon,
            "lang": "ru_RU",
            "limit": 1,
            "hours": "false",
            "extra": "false",
        },
        headers={"X-Yandex-Weather-Key": api_key},
        timeout=8.0,
    )
    response.raise_for_status()
    return response.json()


@router.get("/weather")
async def get_weather(lat: float = Query(...), lon: float = Query(...)):
    yandex_key = os.getenv("YANDEX_WEATHER_API_KEY", "")
    api_key = os.getenv("OPENWEATHER_API_KEY", "")

    if yandex_key:
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    YANDEX_WEATHER_URL,
                    params={
                        "lat": lat,
                        "lon": lon,
                        "lang": "ru_RU",
                        "limit": 1,
                        "hours": "false",
                        "extra": "false",
                    },
                    headers={"X-Yandex-Weather-Key": yandex_key},
                    timeout=8.0,
                )
                response.raise_for_status()
                data = response.json()
                normalized = normalize_yandex_fact(data)
                return {
                    **normalized,
                    "provider": "yandex",
                    "raw": data,
                }
            except Exception as e:
                return {
                    "error": str(e),
                    "provider": "yandex",
                    "risk_score": 0.0,
                }

    if api_key in ("demo_key", "", None):
        return {
            "error": "YANDEX_WEATHER_API_KEY is not configured",
            "risk_score": 0.0,
        }

    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(
                OPENWEATHER_URL,
                params={"lat": lat, "lon": lon, "appid": api_key, "units": "metric", "lang": "ru"},
                timeout=5.0,
            )
            data = r.json()
            normalized = {
                "temperature": data.get("main", {}).get("temp"),
                "description": data.get("weather", [{}])[0].get("description"),
                "condition": data.get("weather", [{}])[0].get("main"),
                "wind_speed": data.get("wind", {}).get("speed"),
                "visibility": data.get("visibility"),
            }
            return {
                **normalized,
                "provider": "openweather",
                "risk_score": weather_to_risk(normalized),
                "raw": data,
            }
        except Exception as e:
            return {"error": str(e), "risk_score": 0.0}


@router.get("/weather/heatmap")
async def get_weather_heatmap(
    lat: float = Query(...),
    lon: float = Query(...),
    radius: float = Query(0.45, ge=0.05, le=2.0),
    steps: int = Query(3, ge=2, le=5),
):
    yandex_key = os.getenv("YANDEX_WEATHER_API_KEY", "")
    if not yandex_key:
        return {
            "provider": "yandex",
            "cells": [],
            "error": "YANDEX_WEATHER_API_KEY is not configured",
        }

    if steps == 1:
        offsets = [0.0]
    else:
        offsets = [
            -radius + (2 * radius * index) / (steps - 1)
            for index in range(steps)
        ]

    sample_points = [
        {"lat": round(lat + lat_offset, 5), "lon": round(lon + lon_offset, 5)}
        for lat_offset in offsets
        for lon_offset in offsets
    ]

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(
            *[
                fetch_yandex_weather(
                    client,
                    lat=point["lat"],
                    lon=point["lon"],
                    api_key=yandex_key,
                )
                for point in sample_points
            ],
            return_exceptions=True,
        )

    cells = []
    errors = 0
    for point, result in zip(sample_points, results):
        if isinstance(result, Exception):
            errors += 1
            continue

        normalized = normalize_yandex_fact(result)
        precipitation_strength = float(normalized.get("precipitation_strength") or 0)
        wind_speed = float(normalized.get("wind_speed") or 0)
        risk_score = float(normalized.get("risk_score") or 0)
        intensity = max(
            risk_score,
            min(1.0, precipitation_strength),
            min(1.0, wind_speed / 18),
        )

        cells.append({
            "lat": point["lat"],
            "lon": point["lon"],
            "intensity": round(intensity, 3),
            "risk_score": risk_score,
            "temperature": normalized.get("temperature"),
            "condition": normalized.get("condition"),
            "description": normalized.get("description"),
            "wind_speed": normalized.get("wind_speed"),
            "precipitation_type": normalized.get("precipitation_type"),
            "precipitation_strength": precipitation_strength,
        })

    return {
        "provider": "yandex",
        "center": {"lat": lat, "lon": lon},
        "radius": radius,
        "count": len(cells),
        "errors": errors,
        "cells": cells,
    }
