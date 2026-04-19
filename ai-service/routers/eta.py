from fastapi import APIRouter
from pydantic import BaseModel
import math

router = APIRouter()


class EtaInput(BaseModel):
    distance_km: float
    hour_of_day: int = 12
    day_of_week: int = 1
    weather_score: float = 0.2
    news_score: float = 0.2
    risk_score: float = 0.3


class EtaOutput(BaseModel):
    predicted_minutes: int
    confidence: float
    factors: dict


def predict_eta(data: EtaInput) -> EtaOutput:
    base_speed_kmh = 70.0

    # Time-of-day factor
    if 7 <= data.hour_of_day <= 9 or 17 <= data.hour_of_day <= 19:
        tod_factor = 0.65  # rush hour
    elif 22 <= data.hour_of_day or data.hour_of_day <= 5:
        tod_factor = 1.15  # night — faster but riskier
    else:
        tod_factor = 1.0

    # Weekend factor
    dow_factor = 1.05 if data.day_of_week in (5, 6) else 1.0

    # Weather factor
    weather_factor = 1.0 - data.weather_score * 0.3

    # News/incident factor
    news_factor = 1.0 - data.news_score * 0.2

    # Risk factor
    risk_factor = 1.0 - data.risk_score * 0.15

    adjusted_speed = base_speed_kmh * tod_factor * dow_factor * weather_factor * news_factor * risk_factor
    adjusted_speed = max(20.0, adjusted_speed)

    predicted_hours = data.distance_km / adjusted_speed
    predicted_minutes = max(5, int(math.ceil(predicted_hours * 60)))

    confidence = min(0.95, 0.6 + (1.0 - data.risk_score) * 0.35)

    return EtaOutput(
        predicted_minutes=predicted_minutes,
        confidence=round(confidence, 2),
        factors={
            "base_speed_kmh": round(base_speed_kmh, 1),
            "adjusted_speed_kmh": round(adjusted_speed, 1),
            "tod_factor": round(tod_factor, 2),
            "dow_factor": round(dow_factor, 2),
            "weather_factor": round(weather_factor, 2),
            "news_factor": round(news_factor, 2),
            "risk_factor": round(risk_factor, 2),
        },
    )


@router.post("/eta-predict", response_model=EtaOutput)
async def eta_predict(data: EtaInput):
    return predict_eta(data)
