"""
ETA prediction endpoint.
Uses trained XGBoost model if ai-service/model/eta_model.pkl exists,
otherwise falls back to the analytical formula.
"""
import json
import math
from pathlib import Path

import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel

try:
    import joblib
    _joblib_ok = True
except ImportError:
    _joblib_ok = False

router = APIRouter()

# ── Model loading ─────────────────────────────────────────────────────────────

MODEL_PATH = Path(__file__).parent.parent / "model" / "eta_model.pkl"
META_PATH  = Path(__file__).parent.parent / "model" / "eta_meta.json"

_model = None
_meta: dict = {}
_using_model = False

if _joblib_ok and MODEL_PATH.exists():
    try:
        _model = joblib.load(MODEL_PATH)
        _meta  = json.loads(META_PATH.read_text()) if META_PATH.exists() else {}
        _using_model = True
        print(f"[eta] XGBoost модель загружена. MAE={_meta.get('mae_min')} мин, MAPE={_meta.get('mape_pct')}%")
    except Exception as e:
        print(f"[eta] Не удалось загрузить модель: {e}. Используем формулу.")


# ── Schemas ───────────────────────────────────────────────────────────────────

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
    source: str          # "xgboost" | "formula"
    model_mae_min: float | None = None
    factors: dict


# ── Analytical fallback ───────────────────────────────────────────────────────

def _formula_predict(data: EtaInput) -> EtaOutput:
    base_speed = 70.0

    if 7 <= data.hour_of_day <= 9 or 17 <= data.hour_of_day <= 19:
        tod_factor = 0.65
    elif data.hour_of_day >= 22 or data.hour_of_day <= 5:
        tod_factor = 1.15
    else:
        tod_factor = 1.0

    dow_factor     = 1.05 if data.day_of_week in (5, 6) else 1.0
    weather_factor = 1.0 - data.weather_score * 0.3
    news_factor    = 1.0 - data.news_score    * 0.2
    risk_factor    = 1.0 - data.risk_score    * 0.15

    speed = max(20.0, base_speed * tod_factor * dow_factor * weather_factor * news_factor * risk_factor)
    minutes = max(5, int(math.ceil(data.distance_km / speed * 60)))
    confidence = min(0.95, 0.6 + (1.0 - data.risk_score) * 0.35)

    return EtaOutput(
        predicted_minutes=minutes,
        confidence=round(confidence, 2),
        source="formula",
        factors={
            "base_speed_kmh":     round(base_speed, 1),
            "adjusted_speed_kmh": round(speed, 1),
            "tod_factor":         round(tod_factor, 2),
            "dow_factor":         round(dow_factor, 2),
            "weather_factor":     round(weather_factor, 2),
            "news_factor":        round(news_factor, 2),
            "risk_factor":        round(risk_factor, 2),
        },
    )


# ── XGBoost predict ───────────────────────────────────────────────────────────

def _model_predict(data: EtaInput) -> EtaOutput:
    is_rush  = 1 if (7 <= data.hour_of_day <= 9 or 17 <= data.hour_of_day <= 20) else 0
    is_night = 1 if (data.hour_of_day >= 23 or data.hour_of_day <= 5) else 0
    is_wknd  = 1 if data.day_of_week >= 5 else 0

    X = np.array([[
        data.distance_km,
        data.hour_of_day,
        data.day_of_week,
        data.weather_score,
        data.news_score,
        data.risk_score,
        is_rush,
        is_night,
        is_wknd,
        np.log1p(data.distance_km),
        data.weather_score * is_rush,
    ]])

    minutes = max(5, int(round(float(_model.predict(X)[0]))))

    # Confidence: higher for distances the model trained well on, lower for extremes
    mae = _meta.get("mae_min", 15.0)
    rel_error = mae / max(minutes, 1)
    confidence = round(min(0.95, max(0.50, 1.0 - rel_error * 0.8)), 2)

    # Derive interpretable speed for UI
    hours = minutes / 60
    speed = round(data.distance_km / hours, 1) if hours > 0 else 70.0

    # Approximate factors for display
    tod_factor     = 0.65 if is_rush else (1.15 if is_night else 1.0)
    dow_factor     = 1.05 if is_wknd else 1.0
    weather_factor = round(1.0 - data.weather_score * 0.3, 2)
    news_factor    = round(1.0 - data.news_score    * 0.2, 2)
    risk_factor    = round(1.0 - data.risk_score    * 0.15, 2)

    return EtaOutput(
        predicted_minutes=minutes,
        confidence=confidence,
        source="xgboost",
        model_mae_min=_meta.get("mae_min"),
        factors={
            "base_speed_kmh":     70.0,
            "adjusted_speed_kmh": speed,
            "tod_factor":         round(tod_factor, 2),
            "dow_factor":         round(dow_factor, 2),
            "weather_factor":     weather_factor,
            "news_factor":        news_factor,
            "risk_factor":        risk_factor,
        },
    )


# ── Endpoint ──────────────────────────────────────────────────────────────────

def predict_eta(data: EtaInput) -> EtaOutput:
    if _using_model:
        return _model_predict(data)
    return _formula_predict(data)


@router.post("/eta-predict", response_model=EtaOutput)
async def eta_predict(data: EtaInput):
    return predict_eta(data)


@router.get("/eta-model-info")
def eta_model_info():
    return {
        "using_model": _using_model,
        "model_path": str(MODEL_PATH),
        "meta": _meta,
    }
