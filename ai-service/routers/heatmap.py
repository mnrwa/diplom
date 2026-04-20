"""
AI-powered route load heatmap for major Russian highways.
Returns synthetic but realistic traffic intensity points.
"""
import math
import time
from typing import List
from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter(tags=["heatmap"])


class HeatmapPoint(BaseModel):
    lat: float
    lon: float
    intensity: float          # 0-1
    load_label: str           # "Свободно" / "Умеренно" / "Загружено" / "Пробки"
    highway: str
    avg_speed_kmh: float


# Major Russian highway segments: (name, waypoints list)
HIGHWAYS = [
    ("М-10 Москва–СПб", [
        (55.75, 37.62), (56.14, 37.41), (56.86, 35.91),
        (57.55, 34.32), (58.52, 31.27), (59.35, 30.84), (59.95, 30.32),
    ]),
    ("М-11 Нева", [
        (55.75, 37.58), (56.2, 36.7), (57.1, 34.5),
        (58.2, 31.9), (59.0, 30.9), (59.95, 30.32),
    ]),
    ("М-1 Беларусь", [
        (55.75, 37.40), (55.49, 36.02), (55.05, 34.28),
        (54.78, 32.05), (54.52, 31.0),
    ]),
    ("М-4 Дон", [
        (55.65, 37.68), (55.1, 37.75), (54.19, 37.62),
        (53.2, 37.8), (51.67, 39.21), (49.5, 40.2),
        (47.85, 40.06), (47.22, 39.72), (46.35, 38.97),
    ]),
    ("М-7 Волга", [
        (55.78, 37.85), (56.02, 38.9), (56.13, 40.39),
        (56.33, 44.0), (55.78, 49.12), (55.8, 51.5),
        (55.0, 53.2), (54.74, 55.97),
    ]),
    ("М-5 Урал", [
        (55.65, 37.8), (54.63, 39.73), (53.2, 45.0),
        (52.07, 48.5), (51.53, 51.37), (54.74, 55.97),
        (55.96, 58.85), (56.85, 60.61),
    ]),
    ("М-8 Холмогоры", [
        (55.82, 37.72), (56.34, 38.13), (57.63, 39.87),
        (59.22, 39.88), (61.25, 40.2),
    ]),
    ("М-2 Крым", [
        (55.65, 37.67), (54.85, 37.5), (54.19, 37.62),
        (52.73, 36.2), (51.73, 36.19), (50.6, 35.5),
    ]),
    ("А-107 МБК", [
        (55.97, 37.08), (55.97, 37.62), (55.97, 38.18),
        (55.55, 38.18), (55.55, 37.62), (55.55, 37.08),
    ]),
    ("М-9 Балтия", [
        (55.76, 37.38), (55.6, 36.4), (55.3, 35.1),
        (54.55, 32.05),
    ]),
    ("М-3 Украина", [
        (55.65, 37.30), (54.9, 36.1), (53.9, 34.4),
        (53.25, 33.9),
    ]),
]

# Moscow ring road as high-load loop
MKAD = [
    (55.897, 37.395), (55.88, 37.835), (55.835, 37.97),
    (55.755, 38.01), (55.61, 37.95), (55.57, 37.74),
    (55.555, 37.395), (55.61, 37.15), (55.755, 37.10),
    (55.88, 37.15), (55.897, 37.395),
]

SPB_RING = [
    (59.99, 30.12), (60.05, 30.45), (60.0, 30.82),
    (59.85, 30.95), (59.77, 30.75), (59.75, 30.32),
    (59.82, 30.05), (59.99, 30.12),
]


def _interp_segment(a: tuple, b: tuple, step_km: float = 20.0) -> List[tuple]:
    """Interpolate points every step_km along a segment."""
    R = 6371.0
    to_rad = lambda v: v * math.pi / 180
    dlat = to_rad(b[0] - a[0])
    dlon = to_rad(b[1] - a[1])
    sinA = math.sin(dlat / 2) ** 2 + math.sin(dlon / 2) ** 2 * math.cos(to_rad(a[0])) * math.cos(to_rad(b[0]))
    dist_km = R * 2 * math.atan2(math.sqrt(sinA), math.sqrt(1 - sinA))

    if dist_km < step_km:
        return [b]

    steps = max(1, int(dist_km / step_km))
    pts = []
    for s in range(1, steps + 1):
        t = s / steps
        pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return pts


def _time_factor() -> float:
    """Returns 0-1 congestion factor based on current hour (Moscow time = UTC+3)."""
    hour = (time.gmtime().tm_hour + 3) % 24
    if 7 <= hour <= 9 or 17 <= hour <= 20:
        return 0.85  # rush
    if 23 <= hour or hour <= 5:
        return 0.15  # night
    return 0.45  # daytime


def _load_label(intensity: float) -> str:
    if intensity < 0.25:
        return "Свободно"
    if intensity < 0.5:
        return "Умеренно"
    if intensity < 0.75:
        return "Загружено"
    return "Пробки"


def _speed_from_intensity(intensity: float) -> float:
    """Approximate avg speed km/h from traffic intensity."""
    return round(90 - intensity * 60, 1)  # 30..90 km/h


def _generate_highway_points(name: str, waypoints: list, base_intensity: float) -> List[dict]:
    pts = [waypoints[0]]
    for i in range(1, len(waypoints)):
        pts.extend(_interp_segment(waypoints[i - 1], waypoints[i]))

    result = []
    for i, (lat, lon) in enumerate(pts):
        # Vary intensity along the road — busier near big cities
        dist_from_moscow = math.sqrt((lat - 55.75) ** 2 + (lon - 37.62) ** 2)
        proximity = max(0, 1 - dist_from_moscow / 8)  # boost near Moscow
        jitter = (math.sin(i * 1.7 + lat * 10) * 0.5 + 0.5) * 0.15
        intensity = min(1.0, base_intensity + proximity * 0.3 + jitter)
        result.append({
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "intensity": round(intensity, 3),
            "load_label": _load_label(intensity),
            "highway": name,
            "avg_speed_kmh": _speed_from_intensity(intensity),
        })
    return result


def _generate_ring(name: str, waypoints: list, base_intensity: float) -> List[dict]:
    pts: list = []
    for i in range(1, len(waypoints)):
        pts.extend(_interp_segment(waypoints[i - 1], waypoints[i], step_km=3.0))

    result = []
    for i, (lat, lon) in enumerate(pts):
        jitter = (math.sin(i * 2.3 + lon * 15) * 0.5 + 0.5) * 0.2
        intensity = min(1.0, base_intensity + jitter)
        result.append({
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "intensity": round(intensity, 3),
            "load_label": _load_label(intensity),
            "highway": name,
            "avg_speed_kmh": _speed_from_intensity(intensity),
        })
    return result


@router.get("/ai/heatmap", response_model=List[HeatmapPoint])
def ai_heatmap(step_km: float = Query(default=20.0, ge=5.0, le=100.0)):
    """
    Generate AI-powered route load heatmap for major Russian highways.
    Returns realistic traffic intensity based on time of day and highway segment.
    """
    time_factor = _time_factor()
    points: List[dict] = []

    # Major highways
    for name, waypoints in HIGHWAYS:
        base = 0.2 + time_factor * 0.5
        points.extend(_generate_highway_points(name, waypoints, base))

    # MKAD — always high load
    mkad_base = 0.6 + time_factor * 0.35
    points.extend(_generate_ring("МКАД", MKAD, mkad_base))

    # SPb ring
    spb_base = 0.45 + time_factor * 0.3
    points.extend(_generate_ring("КАД СПб", SPB_RING, spb_base))

    return points
