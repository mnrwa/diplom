"""
ETA Model Training — Neural Network (MLP)
==========================================
Обучает нейросеть на исторических данных рейсов.
Ключевой признак: segment_avg_min — историческое среднее время на
аналогичном участке (дистанция ±20%, тот же тип дороги).

Запуск:
    python scripts/train_eta_model.py                  # синтетика 80k
    python scripts/train_eta_model.py --samples 200000
    python scripts/train_eta_model.py --csv trips.csv  # реальные данные

Ожидаемые колонки CSV:
    distance_km, hour_of_day, day_of_week,
    weather_score, news_score, risk_score, actual_minutes
    (опционально: segment_avg_min)

Выход:
    ai-service/model/eta_model.pkl   — обученная нейросеть (sklearn pipeline)
    ai-service/model/eta_meta.json   — метрики + список признаков
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
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error

ROOT      = Path(__file__).parent.parent
MODEL_DIR = ROOT / "model"
MODEL_DIR.mkdir(exist_ok=True)

FEATURES = [
    "distance_km",
    "dist_log",
    "hour_of_day",
    "day_of_week",
    "weather_score",
    "news_score",
    "risk_score",
    "is_rush_hour",
    "is_night",
    "is_weekend",
    "weather_x_rush",
    "segment_avg_min",   # исторические данные участка
]
TARGET = "actual_minutes"

# ── Синтетический генератор ───────────────────────────────────────────────────

REGIONS = {
    "moscow":  {"base_kmh": 47,  "weight": 0.25},
    "spb":     {"base_kmh": 53,  "weight": 0.12},
    "volga":   {"base_kmh": 95,  "weight": 0.15},
    "ural":    {"base_kmh": 92,  "weight": 0.10},
    "siberia": {"base_kmh": 98,  "weight": 0.10},
    "south":   {"base_kmh": 90,  "weight": 0.12},
    "central": {"base_kmh": 93,  "weight": 0.16},
}
CARGO = {
    "express":  1.08,
    "standard": 1.00,
    "heavy":    0.83,
    "cold":     0.89,
}
CARGO_W = [0.20, 0.45, 0.20, 0.15]


def _base_spd(d: float, reg: float) -> float:
    if d < 30:   return min(reg, 43)
    if d < 100:  return reg * 0.72
    if d < 400:  return reg * 0.88
    if d < 1200: return reg
    return reg * 0.87


def _wf(w: float) -> float:
    if w < 0.10: return 1.00
    if w < 0.40: return 0.88
    if w < 0.65: return 0.75
    if w < 0.80: return 0.62
    return 0.50


def generate_synthetic(n: int = 80_000, seed: int = 42) -> pd.DataFrame:
    rng = random.Random(seed)
    np.random.seed(seed)
    reg_names   = list(REGIONS.keys())
    reg_weights = [REGIONS[r]["weight"] for r in reg_names]
    cargo_names = list(CARGO.keys())

    # Накапливаем историческое среднее по (dist_bucket, dist_type)
    hist: dict[tuple, list] = {}

    rows = []
    for _ in range(n):
        reg   = rng.choices(reg_names,   weights=reg_weights)[0]
        cargo = rng.choices(cargo_names, weights=CARGO_W)[0]
        dt    = rng.choices(["city", "reg", "hwy", "long"], weights=[0.25, 0.35, 0.30, 0.10])[0]
        d = {"city": rng.uniform(5, 50), "reg": rng.uniform(50, 300),
             "hwy": rng.uniform(300, 1000), "long": rng.uniform(1000, 4000)}[dt]

        h   = rng.randint(0, 23)
        dow = rng.randint(0, 6)
        ws  = float(np.random.beta(1.5, 6))
        ns  = float(np.random.beta(1.2, 8))
        rs  = float(np.random.beta(1.5, 5))
        rush  = 1 if (7 <= h <= 9 or 17 <= h <= 20) else 0
        night = 1 if (h >= 23 or h <= 5) else 0
        wknd  = 1 if dow >= 5 else 0

        spd = _base_spd(d, REGIONS[reg]["base_kmh"]) * CARGO[cargo]
        cw  = min(1.0, 60.0 / max(d, 1.0))
        if rush:  spd *= rng.uniform(0.55, 0.75) * cw + rng.uniform(0.90, 0.98) * (1 - cw)
        if night: spd *= rng.uniform(0.90, 0.97)
        if wknd:  spd *= rng.uniform(0.98, 1.06)
        spd *= _wf(ws) * (1 - ns * 0.22) * (1 - rs * 0.15)
        if rush and ws > 0.4:
            spd *= 1 - cw * rng.uniform(0.15, 0.30)
        spd = max(18.0, spd)

        mins = (d / spd) * 60
        if d > 500:
            mins += int(d // 250) * rng.uniform(20, 45)
        mins = max(5.0, mins * float(np.random.normal(1.0, 0.12)))

        # Исторический сегмент: bucket по дистанции ±20%
        bucket = (dt, round(d / 50) * 50)
        if bucket not in hist:
            hist[bucket] = []
        seg_avg = float(np.mean(hist[bucket])) if hist[bucket] else mins
        hist[bucket].append(mins)

        rows.append({
            "distance_km":    round(d, 2),
            "hour_of_day":    h,
            "day_of_week":    dow,
            "weather_score":  round(ws, 3),
            "news_score":     round(ns, 3),
            "risk_score":     round(rs, 3),
            "is_rush_hour":   rush,
            "is_night":       night,
            "is_weekend":     wknd,
            "dist_log":       round(math.log1p(d), 4),
            "weather_x_rush": round(ws * rush, 3),
            "segment_avg_min": round(seg_avg, 1),
            TARGET:           round(mins, 1),
        })
    return pd.DataFrame(rows)


# ── Инженерия признаков для реального CSV ────────────────────────────────────

def engineer(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["is_rush_hour"]   = ((df["hour_of_day"].between(7, 9)) |
                            (df["hour_of_day"].between(17, 20))).astype(int)
    df["is_night"]       = ((df["hour_of_day"] >= 23) | (df["hour_of_day"] <= 5)).astype(int)
    df["is_weekend"]     = (df["day_of_week"] >= 5).astype(int)
    df["dist_log"]       = np.log1p(df["distance_km"])
    df["weather_x_rush"] = df["weather_score"] * df["is_rush_hour"]
    if "segment_avg_min" not in df.columns:
        # Считаем скользящее историческое среднее по dist_bucket
        df = df.sort_values("distance_km").reset_index(drop=True)
        df["dist_bucket"] = (df["distance_km"] // 50).astype(int)
        df["segment_avg_min"] = (
            df.groupby("dist_bucket")[TARGET]
              .transform(lambda x: x.expanding().mean().shift(1).fillna(x.mean()))
        )
    return df


def load_csv(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    required = {"distance_km", "hour_of_day", "day_of_week",
                "weather_score", "news_score", "risk_score", "actual_minutes"}
    missing = required - set(df.columns)
    if missing:
        print(f"[!] CSV не хватает колонок: {missing}")
        sys.exit(1)
    return engineer(df)


# ── Обучение ──────────────────────────────────────────────────────────────────

def train(df: pd.DataFrame):
    X = df[FEATURES].values
    y = df[TARGET].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.15, random_state=42
    )

    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("nn", MLPRegressor(
            hidden_layer_sizes=(128, 64, 32),
            activation="relu",
            solver="adam",
            learning_rate_init=5e-4,
            max_iter=600,
            early_stopping=True,
            validation_fraction=0.15,
            n_iter_no_change=30,
            tol=1e-5,
            random_state=42,
        )),
    ])

    pipe.fit(X_train, y_train)
    nn = pipe.named_steps["nn"]

    preds = pipe.predict(X_test)
    mae   = mean_absolute_error(y_test, preds)
    rmse  = math.sqrt(mean_squared_error(y_test, preds))
    mape  = float(np.mean(np.abs((y_test - preds) / np.clip(y_test, 1, None))) * 100)
    epochs = len(nn.loss_curve_)

    print(f"\n{'─'*48}")
    print(f"  Эпох обучения : {epochs}")
    print(f"  MAE           : {mae:.1f} мин")
    print(f"  RMSE          : {rmse:.1f} мин")
    print(f"  MAPE          : {mape:.1f}%")
    print(f"{'─'*48}")

    model_path = MODEL_DIR / "eta_model.pkl"
    meta_path  = MODEL_DIR / "eta_meta.json"

    joblib.dump(pipe, model_path)
    meta = {
        "model_type": "MLP_neural_network",
        "architecture": "128 → 64 → 32 → 1",
        "features":  FEATURES,
        "mae_min":   round(mae, 2),
        "rmse_min":  round(rmse, 2),
        "mape_pct":  round(mape, 2),
        "epochs":    epochs,
        "n_train":   len(X_train),
        "n_test":    len(X_test),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))

    print(f"\n  Модель: {model_path}")
    print(f"  Мета:   {meta_path}\n")
    return pipe, meta


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Train ETA Neural Network")
    parser.add_argument("--csv",     type=str, default=None)
    parser.add_argument("--samples", type=int, default=80_000)
    args = parser.parse_args()

    if args.csv:
        print(f"[+] Загружаем реальные данные: {args.csv}")
        df = load_csv(args.csv)
        print(f"    Рейсов: {len(df):,}")
    else:
        print(f"[+] Генерируем синтетические данные ({args.samples:,} рейсов)...")
        df = generate_synthetic(n=args.samples)

    print("[+] Обучаем нейросеть MLP 128→64→32...")
    train(df)


if __name__ == "__main__":
    main()

