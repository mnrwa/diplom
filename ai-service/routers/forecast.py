"""
Load forecast endpoint.
Takes historical route counts (last 30 days) and projects next 7 days
using a simple day-of-week weighted moving average.
"""
from datetime import date, timedelta
from typing import List

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["forecast"])


class HistoryPoint(BaseModel):
    date: str   # YYYY-MM-DD
    count: int


class ForecastDay(BaseModel):
    date: str
    day_name: str
    predicted_routes: int
    predicted_drivers_needed: int
    load_level: str   # "low" | "medium" | "high"


class ForecastRequest(BaseModel):
    history: List[HistoryPoint]
    horizon_days: int = 7


class ForecastResponse(BaseModel):
    forecast: List[ForecastDay]
    avg_daily_routes: float
    peak_day: str
    recommendation: str


_DAY_NAMES_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
_WEEKEND_BOOST = {5: 0.85, 6: 0.70}   # Sat/Sun typically less


def _load_level(predicted: float, avg: float) -> str:
    if avg == 0:
        return "low"
    ratio = predicted / avg
    if ratio >= 1.3:
        return "high"
    if ratio >= 0.85:
        return "medium"
    return "low"


@router.post("/forecast/load", response_model=ForecastResponse)
def forecast_load(req: ForecastRequest) -> ForecastResponse:
    history = req.history
    if not history:
        today = date.today()
        return ForecastResponse(
            forecast=[],
            avg_daily_routes=0,
            peak_day="—",
            recommendation="Нет исторических данных для прогноза",
        )

    # Build day-of-week averages from history
    dow_totals: dict[int, list[int]] = {i: [] for i in range(7)}
    for point in history:
        try:
            d = date.fromisoformat(point.date)
            dow_totals[d.weekday()].append(point.count)
        except ValueError:
            continue

    dow_avg: dict[int, float] = {}
    for dow, counts in dow_totals.items():
        if counts:
            dow_avg[dow] = sum(counts) / len(counts)
        else:
            # No data for this day — use overall average as fallback
            all_counts = [p.count for p in history]
            dow_avg[dow] = (sum(all_counts) / len(all_counts)) if all_counts else 0

    overall_avg = sum(p.count for p in history) / max(len(history), 1)

    # Project next horizon_days
    today = date.today()
    forecast_days: list[ForecastDay] = []

    for offset in range(1, req.horizon_days + 1):
        target = today + timedelta(days=offset)
        dow = target.weekday()
        predicted = dow_avg.get(dow, overall_avg) * _WEEKEND_BOOST.get(dow, 1.0)
        predicted = max(0, round(predicted))
        drivers_needed = max(1, round(predicted * 0.9))   # ~90% utilization target

        forecast_days.append(ForecastDay(
            date=target.isoformat(),
            day_name=_DAY_NAMES_RU[dow],
            predicted_routes=predicted,
            predicted_drivers_needed=drivers_needed,
            load_level=_load_level(predicted, overall_avg),
        ))

    peak = max(forecast_days, key=lambda d: d.predicted_routes)
    peak_label = f"{peak.day_name} {peak.date[8:]}.{peak.date[5:7]}"

    avg_predicted = sum(d.predicted_routes for d in forecast_days) / len(forecast_days)
    if avg_predicted > overall_avg * 1.15:
        rec = f"Ожидается рост нагрузки +{round((avg_predicted/overall_avg - 1)*100)}%. Рекомендуется добавить водителей."
    elif avg_predicted < overall_avg * 0.8:
        rec = "Ожидается снижение нагрузки. Можно сократить смены."
    else:
        rec = "Нагрузка стабильна. Текущего состава достаточно."

    return ForecastResponse(
        forecast=forecast_days,
        avg_daily_routes=round(overall_avg, 1),
        peak_day=peak_label,
        recommendation=rec,
    )
