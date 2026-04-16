from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from services.news_pipeline import (
    assess_route_news,
    get_cached_news_feed,
    get_news_collector,
    get_news_collector_status,
    refresh_news_collection,
)

router = APIRouter(tags=["news"])


class RoutePointPayload(BaseModel):
    name: str | None = None
    city: str | None = None
    address: str | None = None
    lat: float | None = None
    lon: float | None = None


class RouteNewsRequest(BaseModel):
    lat: float | None = None
    lon: float | None = None
    start: RoutePointPayload | None = None
    end: RoutePointPayload | None = None
    waypoints: list[RoutePointPayload] = Field(default_factory=list)
    max_items: int = 12
    lookback_hours: int = 72


class CollectorRefreshRequest(BaseModel):
    force: bool = True
    source_id: str | None = None


@router.get("/news-risks")
async def get_news_risks(
    lat: float = Query(...),
    lon: float = Query(...),
    max_items: int = Query(10, ge=1, le=25),
):
    return await assess_route_news(
        lat=lat,
        lon=lon,
        max_items=max_items,
        lookback_hours=48,
    )


@router.post("/news-risks/route")
async def get_route_news_risks(payload: RouteNewsRequest):
    return await assess_route_news(
        lat=payload.lat,
        lon=payload.lon,
        start=payload.start.model_dump() if payload.start else None,
        end=payload.end.model_dump() if payload.end else None,
        waypoints=[item.model_dump() for item in payload.waypoints],
        max_items=payload.max_items,
        lookback_hours=payload.lookback_hours,
    )


@router.get("/news-feed")
async def get_news_feed(
    max_items: int = Query(20, ge=1, le=50),
    lookback_hours: int = Query(72, ge=1, le=336),
):
    return await get_cached_news_feed(
        max_items=max_items,
        lookback_hours=lookback_hours,
    )


@router.get("/news-collector/status")
async def get_collector_status():
    return get_news_collector_status()


@router.post("/news-collector/refresh")
async def refresh_collector(payload: CollectorRefreshRequest):
    return await refresh_news_collection(
        force=payload.force,
        source_id=payload.source_id,
    )


def get_news_collector_instance():
    return get_news_collector()
