"""
ETA Model Training Script
=========================
Trains an XGBoost model to predict delivery time in minutes.

Usage:
    # Train on synthetic data (default):
    python scripts/train_eta_model.py

    # Train on real CSV (e.g. Kaggle Porter dataset):
    python scripts/train_eta_model.py --csv path/to/data.csv

    # Porter dataset CSV columns expected:
    # distance_km, hour_of_day, day_of_week, weather_score,
    # news_score, risk_score, actual_minutes

Output:
    ai-service/model/eta_model.pkl  — trained XGBoost model
    ai-service/model/eta_meta.json  — feature list + training stats
"""

import argparse
import json
import math
import random
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error

ROOT = Path(__file__).parent.parent
MODEL_DIR = ROOT / "model"
MODEL_DIR.mkdir(exist_ok=True)

FEATURES = [
    "distance_km",
    "hour_of_day",
    "day_of_week",
    "weather_score",
    "news_score",
    "risk_score",
    "is_rush_hour",
    "is_night",
    "is_weekend",
    "dist_log",          # log(distance) — нелинейность
    "weather_x_rush",    # взаимодействие: плохая погода в час пик
]
TARGET = "actual_minutes"


# ── Synthetic data generator ──────────────────────────────────────────────────

# Highway base speeds calibrated to real Russian federal roads (avg truck speed)
# Moscow/SPb — urban arterials. Volga/Ural/Siberia — M-7, M-53, M-55 federal.
# South — M-4 Don (4-lane, best road in Russia). Central — M-1, M-2.
REGIONS = {
    "moscow":      {"base_kmh": 47,  "weight": 0.25},  # МКАД + вылетные: камеры везде
    "spb":         {"base_kmh": 53,  "weight": 0.12},  # КАД + ЗСД: камеры, пробки
    "volga":       {"base_kmh": 95,  "weight": 0.15},  # М-7 Волга: мало камер, 100-120
    "ural":        {"base_kmh": 92,  "weight": 0.10},  # Р-242, Р-351: открытая трасса
    "siberia":     {"base_kmh": 98,  "weight": 0.10},  # М-53/М-55: редкие камеры, 110-130
    "south":       {"base_kmh": 90,  "weight": 0.12},  # М-4 Дон: много камер, лимит 110
    "central":     {"base_kmh": 93,  "weight": 0.16},  # М-1, М-2: обновлённые, камеры есть
}

CARGO_TYPES = {
    "express":  {"speed_mult": 1.08, "weight": 0.20},
    "standard": {"speed_mult": 1.00, "weight": 0.45},
    "heavy":    {"speed_mult": 0.83, "weight": 0.20},
    "cold":     {"speed_mult": 0.89, "weight": 0.15},
}


def _base_speed(distance_km: float, region_kmh: float) -> float:
    """Speed depends on route type: urban → regional → open highway → very long haul."""
    if distance_km < 30:
        return min(region_kmh, 43)          # pure city/suburb
    if distance_km < 100:
        return region_kmh * 0.72            # suburban + подъездные дороги
    if distance_km < 400:
        return region_kmh * 0.88            # региональная + федеральная смешанная
    if distance_km < 1200:
        return region_kmh                    # открытая федеральная трасса
    return region_kmh * 0.87               # очень длинный рейс: ост. каждые 4 ч


def _weather_factor(weather_score: float) -> float:
    if weather_score < 0.1:
        return 1.0
    if weather_score < 0.4:   # rain
        return 0.88
    if weather_score < 0.65:  # heavy rain / fog
        return 0.75
    if weather_score < 0.80:  # snow
        return 0.62
    return 0.50               # blizzard / storm


def generate_synthetic(n: int = 80_000, seed: int = 42) -> pd.DataFrame:
    rng = random.Random(seed)
    np.random.seed(seed)

    region_names = list(REGIONS.keys())
    region_weights = [REGIONS[r]["weight"] for r in region_names]
    cargo_names = list(CARGO_TYPES.keys())
    cargo_weights = [CARGO_TYPES[c]["weight"] for c in cargo_names]

    rows = []
    for _ in range(n):
        region = rng.choices(region_names, weights=region_weights)[0]
        cargo  = rng.choices(cargo_names,  weights=cargo_weights)[0]

        # Distance: mixture of city, regional, long-haul
        dist_type = rng.choices(["city", "regional", "highway", "longhaul"],
                                 weights=[0.25, 0.35, 0.30, 0.10])[0]
        if dist_type == "city":
            dist = rng.uniform(5, 50)
        elif dist_type == "regional":
            dist = rng.uniform(50, 300)
        elif dist_type == "highway":
            dist = rng.uniform(300, 1000)
        else:
            dist = rng.uniform(1000, 4000)

        hour = rng.randint(0, 23)
        dow  = rng.randint(0, 6)

        weather_score = float(np.random.beta(1.5, 6))   # mostly good weather
        news_score    = float(np.random.beta(1.2, 8))
        risk_score    = float(np.random.beta(1.5, 5))

        is_rush  = 1 if (7 <= hour <= 9 or 17 <= hour <= 20) else 0
        is_night = 1 if (hour >= 23 or hour <= 5) else 0
        is_wknd  = 1 if dow >= 5 else 0

        base_kmh = _base_speed(dist, REGIONS[region]["base_kmh"])
        speed = base_kmh * CARGO_TYPES[cargo]["speed_mult"]

        # Rush hour slows city routes heavily but barely affects long-haul highways
        city_weight = min(1.0, 60.0 / max(dist, 1.0))
        if is_rush:
            rush_penalty = rng.uniform(0.55, 0.75)   # city: strong penalty
            highway_penalty = rng.uniform(0.90, 0.98) # highway: minimal
            speed *= rush_penalty * city_weight + highway_penalty * (1.0 - city_weight)
        if is_night:
            speed *= rng.uniform(0.90, 0.97)          # night slightly slower (visibility)
        if is_wknd:
            speed *= rng.uniform(0.98, 1.06)

        speed *= _weather_factor(weather_score)
        speed *= (1.0 - news_score * 0.22)
        speed *= (1.0 - risk_score * 0.15)

        # Interaction: rush + bad weather is compounding in cities
        if is_rush and weather_score > 0.4:
            speed *= 1.0 - city_weight * rng.uniform(0.15, 0.30)

        speed = max(18.0, speed)

        base_minutes = (dist / speed) * 60

        # Add stops for long haul
        if dist > 500:
            n_stops = int(dist // 250)
            base_minutes += n_stops * rng.uniform(20, 45)

        # Realistic noise ±15%
        noise = np.random.normal(1.0, 0.12)
        actual_minutes = max(5.0, base_minutes * noise)

        rows.append({
            "distance_km":   round(dist, 2),
            "hour_of_day":   hour,
            "day_of_week":   dow,
            "weather_score": round(weather_score, 3),
            "news_score":    round(news_score, 3),
            "risk_score":    round(risk_score, 3),
            "region":        region,
            "cargo_type":    cargo,
            "actual_minutes": round(actual_minutes, 1),
        })

    return pd.DataFrame(rows)


# ── Feature engineering ───────────────────────────────────────────────────────

def engineer(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["is_rush_hour"]   = ((df["hour_of_day"].between(7, 9)) | (df["hour_of_day"].between(17, 20))).astype(int)
    df["is_night"]       = ((df["hour_of_day"] >= 23) | (df["hour_of_day"] <= 5)).astype(int)
    df["is_weekend"]     = (df["day_of_week"] >= 5).astype(int)
    df["dist_log"]       = np.log1p(df["distance_km"])
    df["weather_x_rush"] = df["weather_score"] * df["is_rush_hour"]
    return df


# ── Load real CSV ─────────────────────────────────────────────────────────────

REQUIRED_COLS = {
    "distance_km", "hour_of_day", "day_of_week",
    "weather_score", "news_score", "risk_score", "actual_minutes",
}

def load_csv(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = REQUIRED_COLS - set(df.columns)
    if missing:
        print(f"[!] CSV missing columns: {missing}")
        print("    Expected:", sorted(REQUIRED_COLS))
        sys.exit(1)
    return df[list(REQUIRED_COLS)]


# ── Train ─────────────────────────────────────────────────────────────────────

def train(df: pd.DataFrame):
    df = engineer(df)

    X = df[FEATURES]
    y = df[TARGET]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.15, random_state=42
    )

    model = XGBRegressor(
        n_estimators=600,
        max_depth=7,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=42,
        n_jobs=-1,
        verbosity=0,
    )

    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )

    preds = model.predict(X_test)
    mae  = mean_absolute_error(y_test, preds)
    rmse = math.sqrt(mean_squared_error(y_test, preds))
    mape = float(np.mean(np.abs((y_test - preds) / np.clip(y_test, 1, None))) * 100)

    print(f"\n{'─'*45}")
    print(f"  MAE  : {mae:.1f} мин  (средняя ошибка)")
    print(f"  RMSE : {rmse:.1f} мин")
    print(f"  MAPE : {mape:.1f}%")
    print(f"{'─'*45}")

    # Feature importance
    imp = sorted(zip(FEATURES, model.feature_importances_), key=lambda x: -x[1])
    print("\n  Важность признаков:")
    for feat, score in imp:
        bar = "█" * int(score * 40)
        print(f"  {feat:<22} {bar} {score:.3f}")

    # Save
    model_path = MODEL_DIR / "eta_model.pkl"
    meta_path  = MODEL_DIR / "eta_meta.json"

    joblib.dump(model, model_path)

    meta = {
        "features": FEATURES,
        "mae_min": round(mae, 2),
        "rmse_min": round(rmse, 2),
        "mape_pct": round(mape, 2),
        "n_train": len(X_train),
        "n_test": len(X_test),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))

    print(f"\n  Модель сохранена: {model_path}")
    print(f"  Метаданные:       {meta_path}\n")
    return model, meta


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Train ETA XGBoost model")
    parser.add_argument("--csv", type=str, default=None,
                        help="Path to real CSV dataset (optional)")
    parser.add_argument("--samples", type=int, default=80_000,
                        help="Number of synthetic samples (default: 80000)")
    args = parser.parse_args()

    if args.csv:
        print(f"[+] Загружаем датасет: {args.csv}")
        df = load_csv(args.csv)
        print(f"    Строк: {len(df):,}")
    else:
        print(f"[+] Генерируем синтетические данные ({args.samples:,} строк)...")
        df = generate_synthetic(n=args.samples)
        print(f"    Примеры:\n{df.head(3).to_string(index=False)}\n")

    print("[+] Обучаем XGBoost...")
    train(df)


if __name__ == "__main__":
    main()
