from pathlib import Path
from datetime import datetime

import joblib
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["risk"])

MODEL_PATH = Path("models/risk_classifier.pkl")


class RouteRequest(BaseModel):
    start_lat: float
    start_lon: float
    end_lat: float
    end_lon: float
    weather_score: float = 0.0
    news_score: float = 0.0
    distance_km: float = 0.0
    hour_of_day: int = 12


class RiskResponse(BaseModel):
    risk_score: float
    risk_level: str
    factors: dict
    recommendation: str
    should_recalculate: bool


def load_or_train_model():
    """Load an existing model or train a lightweight synthetic one."""
    if MODEL_PATH.exists():
        return joblib.load(MODEL_PATH)

    np.random.seed(42)
    sample_size = 2000

    weather = np.random.beta(2, 5, sample_size)
    news = np.random.beta(1, 8, sample_size)
    distance = np.random.uniform(10, 500, sample_size)
    hour = np.random.randint(0, 24, sample_size)
    lat_range = np.random.uniform(45, 60, sample_size)
    lon_range = np.random.uniform(30, 60, sample_size)

    night_factor = np.where((hour < 6) | (hour > 22), 0.2, 0.0)
    distance_factor = np.clip(distance / 1000, 0, 0.3)

    risk = np.clip(
        weather * 0.40
        + news * 0.30
        + night_factor
        + distance_factor
        + np.random.normal(0, 0.05, sample_size),
        0,
        1,
    )

    labels = (risk > 0.5).astype(int)
    features = np.column_stack(
        [weather, news, distance, hour, lat_range, lon_range]
    )

    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    x_train, x_test, y_train, y_test = train_test_split(
        features, labels, test_size=0.2, random_state=42
    )

    model = Pipeline(
        [
            ("scaler", StandardScaler()),
            ("clf", RandomForestClassifier(n_estimators=100, random_state=42)),
        ]
    )
    model.fit(x_train, y_train)

    accuracy = model.score(x_test, y_test)
    print(f"Risk model trained, accuracy: {accuracy:.3f}")

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    return model


_model = load_or_train_model()


def calc_distance(lat1, lon1, lat2, lon2) -> float:
    """Return Haversine distance in km."""
    radius_km = 6371
    dlat = np.radians(lat2 - lat1)
    dlon = np.radians(lon2 - lon1)
    a = (
        np.sin(dlat / 2) ** 2
        + np.cos(np.radians(lat1))
        * np.cos(np.radians(lat2))
        * np.sin(dlon / 2) ** 2
    )
    return radius_km * 2 * np.arcsin(np.sqrt(a))


@router.post("/analyze-risk", response_model=RiskResponse)
def analyze_risk(req: RouteRequest):
    distance = req.distance_km or calc_distance(
        req.start_lat, req.start_lon, req.end_lat, req.end_lon
    )
    hour = req.hour_of_day or datetime.now().hour

    features = np.array(
        [
            [
                req.weather_score,
                req.news_score,
                distance,
                hour,
                (req.start_lat + req.end_lat) / 2,
                (req.start_lon + req.end_lon) / 2,
            ]
        ]
    )

    probability = _model.predict_proba(features)[0][1]
    risk_score = float(round(probability, 3))

    if risk_score < 0.3:
        level = "LOW"
        recommendation = "Маршрут безопасен. Можно отправляться."
    elif risk_score < 0.6:
        level = "MEDIUM"
        recommendation = "Умеренный риск. Соблюдайте осторожность."
    else:
        level = "HIGH"
        recommendation = "Высокий риск. Рекомендуется пересчёт маршрута."

    factors = {
        "weather": round(req.weather_score, 3),
        "news": round(req.news_score, 3),
        "distance_km": round(distance, 1),
        "night_hours": hour < 6 or hour > 22,
        "hour": hour,
    }

    return RiskResponse(
        risk_score=risk_score,
        risk_level=level,
        factors=factors,
        recommendation=recommendation,
        should_recalculate=risk_score >= 0.7,
    )
