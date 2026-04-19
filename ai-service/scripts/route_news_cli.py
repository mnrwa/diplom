from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from typing import Any

import httpx

from services.news_pipeline import HTTP_USER_AGENT, assess_route_news, select_route_corridor_points


@dataclass
class GeoPoint:
    name: str
    lat: float
    lon: float


async def geocode_city(client: httpx.AsyncClient, query: str) -> GeoPoint:
    # Nominatim usage policy requires a valid User-Agent and reasonable rate.
    response = await client.get(
        "https://nominatim.openstreetmap.org/search",
        params={
            "format": "jsonv2",
            "q": query,
            "limit": 1,
            "accept-language": "ru",
            "addressdetails": 1,
        },
        headers={"User-Agent": HTTP_USER_AGENT},
        timeout=20.0,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list) or not payload:
        raise RuntimeError(f"Geocode failed for '{query}'")

    item = payload[0] or {}
    return GeoPoint(
        name=str(item.get("display_name") or query),
        lat=float(item["lat"]),
        lon=float(item["lon"]),
    )


async def fetch_osrm_geometry(
    client: httpx.AsyncClient, start: GeoPoint, end: GeoPoint
) -> list[tuple[float, float]]:
    # Returns a list of (lat, lon) points.
    url = f"https://router.project-osrm.org/route/v1/driving/{start.lon},{start.lat};{end.lon},{end.lat}"
    response = await client.get(
        url,
        params={
            "overview": "full",
            "geometries": "geojson",
            "steps": "false",
        },
        headers={"User-Agent": HTTP_USER_AGENT},
        timeout=25.0,
    )
    response.raise_for_status()
    data = response.json() or {}
    routes = data.get("routes") or []
    if not routes:
        raise RuntimeError("OSRM returned no routes")
    geometry = (routes[0] or {}).get("geometry") or {}
    coords = geometry.get("coordinates") or []
    if not isinstance(coords, list) or len(coords) < 2:
        raise RuntimeError("OSRM returned invalid geometry")

    # OSRM geojson coords are [lon, lat]
    return [(float(lat), float(lon)) for lon, lat in coords]


def midpoint_of_coordinates(coords: list[tuple[float, float]]) -> tuple[float, float]:
    if not coords:
        return 0.0, 0.0
    return coords[len(coords) // 2]


async def run(from_city: str, to_city: str, *, lookback_hours: int, max_items: int, corridor_points: int) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        start = await geocode_city(client, from_city)
        end = await geocode_city(client, to_city)
        geometry = await fetch_osrm_geometry(client, start, end)

        # Use a corridor sample so the news pipeline can reverse-geocode intermediate localities.
        corridor = select_route_corridor_points(geometry, limit=max(1, corridor_points))
        mid_lat, mid_lon = midpoint_of_coordinates(corridor)

        waypoints = [
            {"name": f"corridor-point-{idx+1}", "lat": lat, "lon": lon}
            for idx, (lat, lon) in enumerate(corridor)
        ]

        return await assess_route_news(
            lat=mid_lat,
            lon=mid_lon,
            start={"city": from_city, "lat": start.lat, "lon": start.lon},
            end={"city": to_city, "lat": end.lat, "lon": end.lon},
            waypoints=waypoints,
            lookback_hours=lookback_hours,
            max_items=max_items,
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="CLI: discover and rank news risks for a route without running FastAPI.",
    )
    parser.add_argument("--from", dest="from_city", required=True, help="Start city/name (e.g. 'Иркутск')")
    parser.add_argument("--to", dest="to_city", required=True, help="End city/name (e.g. 'Улан-Удэ')")
    parser.add_argument("--lookback-hours", type=int, default=72)
    parser.add_argument("--max-items", type=int, default=12)
    parser.add_argument("--corridor-points", type=int, default=6, help="How many OSRM points to sample for reverse-geocoding")
    args = parser.parse_args()

    payload = asyncio.run(
        run(
            args.from_city,
            args.to_city,
            lookback_hours=max(1, args.lookback_hours),
            max_items=max(1, args.max_items),
            corridor_points=max(1, args.corridor_points),
        )
    )

    print(f"total_risk: {payload.get('total_risk')}")
    print(f"count: {payload.get('count')}")
    print(f"lookback_hours: {payload.get('lookback_hours')}")
    print("")

    risks = payload.get("risks") or []
    if not risks:
        print("No risks returned.")
        return

    for idx, item in enumerate(risks, start=1):
        summary = str(item.get("summary") or "").strip()
        if not summary:
            summary = str(item.get("title") or "").strip()
        published_at = item.get("published_at") or item.get("publishedAt") or ""
        city = item.get("city") or ""
        src = item.get("source") or item.get("provider") or ""
        print(f"{idx}. {published_at} {city} {src}".strip())
        print(summary)
        print("")


if __name__ == "__main__":
    main()

