"""
Live position-aware news endpoint.

POST /ai/live-news
  Takes the driver's current GPS position + destination and returns news
  scored for the live segment (current pos → end), with NLP reformulation.

The key difference from /news-risks/route:
  - Reverse-geocodes the current position to discover the current city/region
  - Builds targeted search queries for the live corridor
  - Applies NLP reformulation to every result
  - Refreshes search cache for newly discovered localities
"""
from __future__ import annotations

import asyncio
import logging
import math
from typing import Any

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.news_pipeline import (
    assess_route_news,
    get_news_collector,
    reverse_geocode_locality,
)
from services.nlp_summarizer import analyze_news_item

logger = logging.getLogger(__name__)
router = APIRouter(tags=["live-news"])


# ── Request / Response models ─────────────────────────────────────────────────

class LiveNewsRequest(BaseModel):
    current_lat: float
    current_lon: float
    end_lat: float
    end_lon: float
    end_name: str = ""
    end_city: str = ""
    end_address: str = ""
    max_items: int = Field(default=12, ge=1, le=30)
    lookback_hours: int = Field(default=72, ge=1, le=336)


class LiveNewsItem(BaseModel):
    id: str
    title: str
    summary: str
    reformulated: str
    risk_score: float
    nlp_risk_score: float
    risk_level: str
    model_used: str
    keywords_found: list[str]
    channel: str
    source: str
    city: str | None
    lat: float | None
    lon: float | None
    distance_km: float | None
    published_at: str | None
    url: str | None


class LiveNewsResponse(BaseModel):
    total_risk: float
    count: int
    current_city: str | None
    segment: str
    items: list[LiveNewsItem]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _interpolate_waypoints(
    lat1: float, lon1: float, lat2: float, lon2: float, steps: int = 4
) -> list[tuple[float, float]]:
    """Sample intermediate points along great-circle path."""
    return [
        (lat1 + (lat2 - lat1) * i / steps, lon1 + (lon2 - lon1) * i / steps)
        for i in range(1, steps)
    ]


def _build_item_id(item: dict[str, Any]) -> str:
    return str(
        item.get("id")
        or item.get("source_id")
        or abs(hash(item.get("title", "") + item.get("channel", "")))
    )


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/ai/live-news", response_model=LiveNewsResponse)
async def live_news(payload: LiveNewsRequest):
    """
    Return news relevant to the driver's live segment (current GPS → destination).

    Steps:
    1. Reverse-geocode current position → current city name
    2. Build intermediate waypoints for the current → end corridor
    3. Call assess_route_news with current position as effective start
    4. Apply NLP reformulation to each result
    """
    collector = get_news_collector()

    # ── 1. Reverse-geocode current position ───────────────────────────────────
    current_city: str | None = None
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            locality = await reverse_geocode_locality(
                client, payload.current_lat, payload.current_lon
            )
            if locality:
                current_city = locality.get("name") or locality.get("city")
    except Exception as exc:
        logger.debug("Reverse geocode failed: %s", exc)

    # ── 2. Build corridor waypoints ───────────────────────────────────────────
    segment_km = _haversine_km(
        payload.current_lat, payload.current_lon,
        payload.end_lat, payload.end_lon,
    )
    # Sample 3-5 intermediate points depending on distance
    steps = max(3, min(5, int(segment_km / 120)))
    raw_waypoints = _interpolate_waypoints(
        payload.current_lat, payload.current_lon,
        payload.end_lat, payload.end_lon,
        steps=steps,
    )
    waypoints = [
        {"name": f"Отрезок {i + 1}", "lat": lat, "lon": lon}
        for i, (lat, lon) in enumerate(raw_waypoints)
    ]

    start_point = {
        "name": "Текущая позиция" + (f" · {current_city}" if current_city else ""),
        "city": current_city,
        "address": None,
        "lat": payload.current_lat,
        "lon": payload.current_lon,
    }
    end_point = {
        "name": payload.end_name or "Пункт назначения",
        "city": payload.end_city or None,
        "address": payload.end_address or None,
        "lat": payload.end_lat,
        "lon": payload.end_lon,
    }

    # ── 3. Assess news for live segment ──────────────────────────────────────
    result = await assess_route_news(
        lat=payload.current_lat,
        lon=payload.current_lon,
        start=start_point,
        end=end_point,
        waypoints=waypoints,
        max_items=payload.max_items,
        lookback_hours=payload.lookback_hours,
    )

    # ── 4. Apply NLP reformulation ────────────────────────────────────────────
    raw_risks: list[dict[str, Any]] = result.get("risks", [])
    enriched: list[LiveNewsItem] = []

    # Run NLP in a thread pool to avoid blocking the event loop
    def _analyse(item: dict[str, Any]) -> LiveNewsItem:
        item_id = _build_item_id(item)
        title = item.get("title") or ""
        summary = item.get("summary") or ""
        analysis = analyze_news_item(item_id, title, summary)

        # Blend original risk_score (geo/keyword from pipeline) with NLP score
        pipeline_risk = float(item.get("risk_score") or item.get("severity") or 0.1)
        blended_risk = round(pipeline_risk * 0.5 + analysis.risk_score * 0.5, 3)

        return LiveNewsItem(
            id=item_id,
            title=title,
            summary=summary,
            reformulated=analysis.reformulated,
            risk_score=blended_risk,
            nlp_risk_score=analysis.risk_score,
            risk_level=analysis.risk_level,
            model_used=analysis.model_used,
            keywords_found=analysis.keywords_found,
            channel=item.get("channel") or "",
            source=item.get("source") or "",
            city=item.get("city"),
            lat=item.get("lat"),
            lon=item.get("lon"),
            distance_km=item.get("distance_km"),
            published_at=item.get("published_at") or item.get("publishedAt"),
            url=item.get("url"),
        )

    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(None, _analyse, item)
        for item in raw_risks
    ]
    enriched = list(await asyncio.gather(*tasks))

    # Re-sort by blended risk descending
    enriched.sort(key=lambda x: x.risk_score, reverse=True)

    total_risk = round(
        sum(i.risk_score for i in enriched) / max(len(enriched), 1)
        if enriched
        else 0.0,
        3,
    )

    segment_label = (
        f"{current_city or 'Текущая точка'} → {payload.end_city or payload.end_name or 'Назначение'}"
    )

    return LiveNewsResponse(
        total_risk=total_risk,
        count=len(enriched),
        current_city=current_city,
        segment=segment_label,
        items=enriched,
    )
