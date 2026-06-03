"""
Model visualization endpoint.
GET /ai/model-charts  →  JSON { charts: { ... }, meta: { ... } }

Six matplotlib charts illustrating how the ETA model works:
  1. learning_curve       — MAE vs training size for each model
  2. eta_comparison       — Actual vs Predicted scatter (all models)
  3. feature_importance   — XGBoost importances + Ridge coefficients
  4. loss_curve           — MLP training loss by iteration
  5. error_distribution   — Residual histograms for each model
  6. risk_timeline        — Risk components along a simulated route
"""

from __future__ import annotations

import base64
import io
import math
import random
import time

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import numpy as np
import pandas as pd
from fastapi import APIRouter
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

try:
    from xgboost import XGBRegressor
    _HAS_XGB = True
except ImportError:
    _HAS_XGB = False

router = APIRouter(prefix="/ai", tags=["model-charts"])

# ─────────────────────────────── palette ──────────────────────────────────────
C = {
    "formula": "#94a3b8",
    "ridge":   "#3b82f6",
    "mlp":     "#8b5cf6",
    "xgb":     "#10b981",
    "accent":  "#f59e0b",
    "bg":      "#f8fafc",
    "grid":    "#e2e8f0",
    "text":    "#1e293b",
}

STYLE = {
    "figure.facecolor": "#ffffff",
    "axes.facecolor": C["bg"],
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.color": C["grid"],
    "grid.linewidth": 0.8,
    "font.family": "DejaVu Sans",
    "font.size": 10,
    "axes.titlesize": 12,
    "axes.titleweight": "bold",
    "axes.titlepad": 10,
    "axes.labelsize": 10,
    "xtick.labelsize": 9,
    "ytick.labelsize": 9,
}

FEATURES = [
    "distance_km", "hour_of_day", "day_of_week",
    "weather_score", "news_score", "risk_score",
    "is_rush_hour", "is_night", "is_weekend",
    "dist_log", "weather_x_rush",
]
FEAT_RU = [
    "Дистанция (км)", "Час суток", "День недели",
    "Погода", "Новости", "Риск",
    "Час пик", "Ночь", "Выходной",
    "log(Дистанция)", "Погода × час пик",
]
TARGET = "actual_minutes"

# ─────────────────────────────── data gen ─────────────────────────────────────

REGIONS   = {"moscow": 47, "spb": 53, "volga": 95, "ural": 92,
             "siberia": 98, "south": 90, "central": 93}
REG_W     = [0.25, 0.12, 0.15, 0.10, 0.10, 0.12, 0.16]
CARGO     = {"express": 1.08, "standard": 1.00, "heavy": 0.83, "cold": 0.89}
CARGO_W   = [0.20, 0.45, 0.20, 0.15]


def _base_spd(d: float, reg: float) -> float:
    if d < 30:   return min(reg, 43)
    if d < 100:  return reg * 0.72
    if d < 400:  return reg * 0.88
    if d < 1200: return reg
    return reg * 0.87


def _wf(w: float) -> float:
    if w < 0.1: return 1.0
    if w < 0.4: return 0.88
    if w < 0.65: return 0.75
    if w < 0.80: return 0.62
    return 0.50


def _generate(n: int = 6000, seed: int = 42) -> pd.DataFrame:
    rng = random.Random(seed)
    np.random.seed(seed)
    reg_names   = list(REGIONS.keys())
    cargo_names = list(CARGO.keys())
    rows = []
    for _ in range(n):
        reg   = rng.choices(reg_names,   weights=REG_W)[0]
        cargo = rng.choices(cargo_names, weights=CARGO_W)[0]
        dt = rng.choices(["city","reg","hwy","long"], weights=[0.25,0.35,0.30,0.10])[0]
        if dt == "city":  d = rng.uniform(5,  50)
        elif dt == "reg": d = rng.uniform(50, 300)
        elif dt == "hwy": d = rng.uniform(300,1000)
        else:             d = rng.uniform(1000,4000)
        h  = rng.randint(0, 23)
        dow = rng.randint(0, 6)
        ws = float(np.random.beta(1.5, 6))
        ns = float(np.random.beta(1.2, 8))
        rs = float(np.random.beta(1.5, 5))
        rush  = 1 if (7<=h<=9 or 17<=h<=20) else 0
        night = 1 if (h>=23  or h<=5)  else 0
        wknd  = 1 if dow >= 5 else 0
        spd = _base_spd(d, REGIONS[reg]) * CARGO[cargo]
        cw  = min(1.0, 60.0/max(d, 1.0))
        if rush:  spd *= rng.uniform(0.55,0.75)*cw + rng.uniform(0.90,0.98)*(1-cw)
        if night: spd *= rng.uniform(0.90, 0.97)
        if wknd:  spd *= rng.uniform(0.98, 1.06)
        spd *= _wf(ws) * (1-ns*0.22) * (1-rs*0.15)
        if rush and ws>0.4: spd *= 1 - cw*rng.uniform(0.15,0.30)
        spd = max(18.0, spd)
        mins = (d/spd)*60
        if d > 500: mins += int(d//250)*rng.uniform(20, 45)
        mins = max(5.0, mins * float(np.random.normal(1.0, 0.12)))
        rows.append({
            "distance_km":   round(d,   2),
            "hour_of_day":   h,
            "day_of_week":   dow,
            "weather_score": round(ws,  3),
            "news_score":    round(ns,  3),
            "risk_score":    round(rs,  3),
            "is_rush_hour":  rush,
            "is_night":      night,
            "is_weekend":    wknd,
            "dist_log":      round(math.log1p(d), 4),
            "weather_x_rush": round(ws*rush, 3),
            TARGET:          round(mins, 1),
        })
    return pd.DataFrame(rows)


def _formula_vec(df: pd.DataFrame) -> np.ndarray:
    d  = df["distance_km"].values
    h  = df["hour_of_day"].values
    ws = df["weather_score"].values
    ns = df["news_score"].values
    rs = df["risk_score"].values
    dw = df["day_of_week"].values
    base = np.where(d<60, 52., np.where(d<250, 90., np.where(d<700, 105., 95.)))
    cw   = np.minimum(1., 60./np.maximum(d, 1.))
    rush = ((h>=7)&(h<=9)) | ((h>=17)&(h<=19))
    night = (h>=23)|(h<=5)
    tod = np.where(rush, 0.70+0.25*(1-cw), np.where(night, 0.93, 1.0))
    spd = np.maximum(25., base * tod * np.where(dw>=5, 1.04, 1.0)
                          * (1-ws*0.28) * (1-ns*0.18) * (1-rs*0.12))
    return np.maximum(5., np.ceil(d/spd*60))


# ─────────────────────────────── PNG helper ───────────────────────────────────

def _b64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
    buf.seek(0)
    data = base64.b64encode(buf.read()).decode()
    plt.close(fig)
    return f"data:image/png;base64,{data}"


# ─────────────────────────────── chart 1: learning curve ─────────────────────

def _chart_learning_curve(
    X_full: np.ndarray, y_full: np.ndarray, df_full: pd.DataFrame
) -> str:
    sizes = [100, 300, 700, 1500, 3000, 6000]
    X_tr, X_ts, y_tr, y_ts = train_test_split(X_full, y_full, test_size=0.2, random_state=42)
    df_ts = df_full.iloc[-int(len(df_full)*0.2):]

    mae: dict[str, list] = {"Формула": [], "Ridge": [], "Нейронка (MLP)": []}
    if _HAS_XGB:
        mae["XGBoost"] = []

    rng = np.random.default_rng(99)
    for sz in sizes:
        idx = rng.choice(len(X_tr), min(sz, len(X_tr)), replace=False)
        Xs, ys = X_tr[idx], y_tr[idx]

        mae["Формула"].append(mean_absolute_error(_formula_vec(df_ts), df_ts[TARGET].values))

        sc = StandardScaler()
        Xs_sc = sc.fit_transform(Xs)
        Xts_sc = sc.transform(X_ts)
        ridge = Ridge(alpha=1.0).fit(Xs_sc, ys)
        mae["Ridge"].append(mean_absolute_error(y_ts, ridge.predict(Xts_sc)))

        mlp = MLPRegressor((64, 32), max_iter=150, random_state=42,
                            early_stopping=True, validation_fraction=0.15,
                            n_iter_no_change=10).fit(Xs_sc, ys)
        mae["Нейронка (MLP)"].append(mean_absolute_error(y_ts, mlp.predict(Xts_sc)))

        if _HAS_XGB:
            xgb = XGBRegressor(n_estimators=80, max_depth=5,
                               random_state=42, verbosity=0).fit(Xs, ys)
            mae["XGBoost"].append(mean_absolute_error(y_ts, xgb.predict(X_ts)))

    pal = [C["formula"], C["ridge"], C["mlp"], C["xgb"]]
    markers = ["o", "s", "^", "D"]

    with plt.style.context(STYLE):
        fig, ax = plt.subplots(figsize=(8, 5))
        for (label, vals), col, mk in zip(mae.items(), pal, markers):
            ax.plot(sizes[:len(vals)], vals, marker=mk, color=col,
                    label=label, lw=2, markersize=6)
        ax.set_xscale("log")
        ax.set_xlabel("Количество рейсов в обучающей выборке")
        ax.set_ylabel("MAE (минуты)")
        ax.set_title("Как растёт точность модели по мере накопления рейсов")
        ax.legend(loc="upper right")
        ax.annotate("Больше данных → меньше ошибка",
                    xy=(sizes[-1], min(mae[list(mae.keys())[-1]])),
                    xytext=(-80, 20), textcoords="offset points",
                    arrowprops=dict(arrowstyle="->", color=C["text"]),
                    fontsize=9, color=C["text"])
        fig.tight_layout()
    return _b64(fig)


# ─────────────────────────────── chart 2: ETA comparison ─────────────────────

def _chart_eta_comparison(
    X_tr: np.ndarray, X_ts: np.ndarray,
    y_tr: np.ndarray, y_ts: np.ndarray,
    df_ts: pd.DataFrame,
    ridge: Ridge, mlp: MLPRegressor, sc: StandardScaler,
    xgb=None,
) -> str:
    formula_pred = _formula_vec(df_ts)
    X_ts_sc = sc.transform(X_ts)
    ridge_pred = ridge.predict(X_ts_sc)
    mlp_pred   = mlp.predict(X_ts_sc)

    models = [
        ("Формула",      formula_pred, C["formula"]),
        ("Ridge",        ridge_pred,   C["ridge"]),
        ("Нейронка (MLP)", mlp_pred,   C["mlp"]),
    ]
    if xgb is not None:
        models.append(("XGBoost", xgb.predict(X_ts), C["xgb"]))

    ncols = len(models)
    with plt.style.context(STYLE):
        fig, axes = plt.subplots(1, ncols, figsize=(4.5*ncols, 4.5))
        if ncols == 1:
            axes = [axes]
        cap = 600
        actual_cap = np.minimum(y_ts, cap)
        for ax, (name, pred, col) in zip(axes, models):
            pred_cap = np.minimum(pred, cap)
            ax.scatter(actual_cap, pred_cap, alpha=0.15, s=8, color=col)
            lim = [0, cap]
            ax.plot(lim, lim, "--", color="#64748b", lw=1.2, label="Идеал")
            r2 = r2_score(actual_cap, pred_cap)
            mae = mean_absolute_error(actual_cap, pred_cap)
            ax.set_title(f"{name}\nMAE={mae:.0f}мин · R²={r2:.3f}")
            ax.set_xlabel("Факт (мин)")
            ax.set_ylabel("Прогноз (мин)")
            ax.set_xlim(lim); ax.set_ylim(lim)
        fig.suptitle("Сравнение моделей: Факт vs Прогноз ETA", fontsize=13,
                     fontweight="bold", y=1.02)
        fig.tight_layout()
    return _b64(fig)


# ─────────────────────────────── chart 3: feature importance ─────────────────

def _chart_feature_importance(ridge: Ridge, sc: StandardScaler, xgb=None) -> str:
    ridge_coefs = np.abs(ridge.coef_) / (np.abs(ridge.coef_).sum() + 1e-9)

    with plt.style.context(STYLE):
        if xgb is not None:
            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
        else:
            fig, ax1 = plt.subplots(figsize=(7, 5))
            ax2 = None

        order = np.argsort(ridge_coefs)
        colors_r = [C["ridge"]] * len(FEAT_RU)
        ax1.barh([FEAT_RU[i] for i in order], ridge_coefs[order], color=C["ridge"], alpha=0.85)
        ax1.set_title("Ridge — важность признаков\n(|коэффициент|, нормировано)")
        ax1.set_xlabel("Нормированный вес")

        if xgb is not None and ax2:
            imp = xgb.feature_importances_
            order_x = np.argsort(imp)
            bars = ax2.barh([FEAT_RU[i] for i in order_x], imp[order_x],
                            color=C["xgb"], alpha=0.85)
            top_val = imp[order_x[-1]]
            ax2.barh([FEAT_RU[order_x[-1]]], [top_val], color=C["accent"], alpha=0.9)
            ax2.set_title("XGBoost — важность признаков\n(gain)")
            ax2.set_xlabel("Feature importance (gain)")

        fig.suptitle("Какие признаки влияют на прогноз больше всего", fontsize=13,
                     fontweight="bold", y=1.02)
        fig.tight_layout()
    return _b64(fig)


# ─────────────────────────────── chart 4: loss curve ─────────────────────────

def _chart_loss_curve(mlp: MLPRegressor) -> str:
    with plt.style.context(STYLE):
        fig, ax = plt.subplots(figsize=(8, 4.5))
        iters = np.arange(1, len(mlp.loss_curve_)+1)
        ax.plot(iters, mlp.loss_curve_, color=C["mlp"], lw=2, label="Обучение")
        if hasattr(mlp, "validation_scores_") and mlp.validation_scores_ is not None:
            # MLPRegressor with early_stopping stores best_validation_score_ but not the curve
            pass
        ax.set_xlabel("Эпоха (итерация)")
        ax.set_ylabel("MSE loss")
        ax.set_title("Как нейронка обучается — кривая потерь по эпохам")
        ax.legend()
        # Mark minimum
        min_i = int(np.argmin(mlp.loss_curve_))
        ax.axvline(min_i+1, ls="--", color=C["accent"], lw=1.2)
        ax.annotate(f"Мин. на эпохе {min_i+1}",
                    xy=(min_i+1, mlp.loss_curve_[min_i]),
                    xytext=(20, 30), textcoords="offset points",
                    arrowprops=dict(arrowstyle="->", color=C["accent"]),
                    color=C["accent"], fontsize=9)
        fig.tight_layout()
    return _b64(fig)


# ─────────────────────────────── chart 5: error distribution ─────────────────

def _chart_error_distribution(
    X_ts: np.ndarray, y_ts: np.ndarray,
    df_ts: pd.DataFrame,
    ridge: Ridge, mlp: MLPRegressor, sc: StandardScaler,
    xgb=None,
) -> str:
    X_sc = sc.transform(X_ts)
    models = [
        ("Формула",        _formula_vec(df_ts) - y_ts, C["formula"]),
        ("Ridge",          ridge.predict(X_sc) - y_ts, C["ridge"]),
        ("Нейронка (MLP)", mlp.predict(X_sc)   - y_ts, C["mlp"]),
    ]
    if xgb is not None:
        models.append(("XGBoost", xgb.predict(X_ts) - y_ts, C["xgb"]))

    with plt.style.context(STYLE):
        fig, ax = plt.subplots(figsize=(9, 5))
        bins = np.linspace(-180, 180, 60)
        for name, resid, col in models:
            ax.hist(resid, bins=bins, color=col, alpha=0.40, density=True, label=name)
            mu, sig = float(np.mean(resid)), float(np.std(resid))
            x = np.linspace(-180, 180, 300)
            ax.plot(x, 1/(sig*(2*np.pi)**0.5)*np.exp(-0.5*((x-mu)/sig)**2),
                    color=col, lw=2)
        ax.axvline(0, color=C["text"], lw=1.5, ls="--", label="Нулевая ошибка")
        ax.set_xlabel("Ошибка прогноза (мин): прогноз − факт")
        ax.set_ylabel("Плотность")
        ax.set_title("Распределение ошибок прогноза — где промахивается модель")
        ax.legend(loc="upper right")
        # Annotate MAEs
        y_top = ax.get_ylim()[1]
        for i, (name, resid, col) in enumerate(models):
            ax.text(0.02, 0.95 - i*0.08, f"{name}: MAE={mean_absolute_error(np.zeros_like(resid), resid):.0f}мин",
                    transform=ax.transAxes, color=col, fontsize=9, va="top")
        fig.tight_layout()
    return _b64(fig)


# ─────────────────────────────── chart 6: risk timeline ──────────────────────

def _chart_risk_timeline() -> str:
    t = np.linspace(0, 1, 200)   # 0 = start, 1 = end of route
    distance_km = 430            # Москва → Нижний Новгород

    # Simulate weather: gets worse halfway, clears near end
    weather_risk = 0.05 + 0.45 * np.exp(-((t - 0.48)**2) / 0.015) \
                        + 0.10 * np.exp(-((t - 0.62)**2) / 0.010)
    # Road incident around 45-60% of route
    news_risk = 0.03 + 0.55 * np.exp(-((t - 0.52)**2) / 0.008) \
                     + 0.25 * np.exp(-((t - 0.57)**2) / 0.005)
    # Base road risk (speed cameras, narrow segments)
    road_risk = 0.08 + 0.12 * np.sin(t * np.pi * 4) * 0.3 \
                     + 0.10 * np.where((t > 0.2) & (t < 0.25), 1, 0)  # construction zone
    road_risk = np.clip(road_risk, 0, 0.4)

    total = np.clip(weather_risk * 0.35 + news_risk * 0.40 + road_risk * 0.25, 0, 1)
    km = t * distance_km
    eta_min = (distance_km / max(distance_km, 1)) * 260   # ~4h 20min route
    minutes = t * eta_min

    with plt.style.context(STYLE):
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 7), sharex=True,
                                        gridspec_kw={"height_ratios": [2, 1]})

        # Stacked areas
        ax1.stackplot(km,
                      weather_risk * 0.35,
                      news_risk * 0.40,
                      road_risk * 0.25,
                      labels=["Погода (вес 35%)", "Новости / инциденты (40%)", "Дорожный риск (25%)"],
                      colors=[C["formula"], C["accent"], C["ridge"]],
                      alpha=0.75)
        ax1.plot(km, total, color=C["xgb"], lw=2.5, label="Итоговый risk_score")
        ax1.set_ylim(0, 1)
        ax1.set_ylabel("risk_score")
        ax1.set_title("Как risk_score меняется по маршруту (Москва → Нижний Новгород, 430 км)")
        ax1.legend(loc="upper right", fontsize=9)
        ax1.axhline(0.5, color="#ef4444", lw=1, ls="--", alpha=0.6)
        ax1.text(5, 0.52, "Порог тревоги 0.5", color="#ef4444", fontsize=8)

        # Annotate peak
        peak_idx = int(np.argmax(total))
        ax1.annotate(f"Пик риска {total[peak_idx]:.2f}\n(ДТП + дождь)",
                     xy=(km[peak_idx], total[peak_idx]),
                     xytext=(-60, 18), textcoords="offset points",
                     arrowprops=dict(arrowstyle="->", color=C["text"]),
                     fontsize=9, color=C["text"])

        # ETA shift (lower subplot)
        eta_shift = (total - 0.15) * 45   # minutes added to ETA
        ax2.fill_between(km, 0, eta_shift, where=eta_shift > 0,
                         color=C["accent"], alpha=0.6, label="Задержка (мин)")
        ax2.fill_between(km, eta_shift, 0, where=eta_shift < 0,
                         color=C["xgb"], alpha=0.5, label="Ускорение (мин)")
        ax2.axhline(0, color=C["text"], lw=1)
        ax2.set_xlabel("Пройдено (км)")
        ax2.set_ylabel("ΔETA (мин)")
        ax2.set_title("Влияние risk_score на корректировку ETA")
        ax2.legend(loc="upper right", fontsize=9)

        fig.tight_layout()
    return _b64(fig)


# ─────────────────────────────── cache + endpoint ────────────────────────────

_CACHE: dict = {}
_CACHE_TTL = 3600   # 1 hour


def _build_all_charts() -> dict:
    df = _generate(n=6000, seed=42)
    X = df[FEATURES].values
    y = df[TARGET].values

    X_tr, X_ts, y_tr, y_ts = train_test_split(X, y, test_size=0.20, random_state=42)
    df_ts = df.iloc[-int(len(df)*0.20):]

    sc = StandardScaler()
    X_tr_sc = sc.fit_transform(X_tr)

    ridge = Ridge(alpha=1.0).fit(X_tr_sc, y_tr)
    mlp = MLPRegressor(
        hidden_layer_sizes=(128, 64, 32),
        max_iter=400, random_state=42,
        early_stopping=True, validation_fraction=0.15,
        n_iter_no_change=20, learning_rate_init=0.001,
    ).fit(X_tr_sc, y_tr)

    xgb = None
    if _HAS_XGB:
        xgb = XGBRegressor(n_estimators=200, max_depth=6,
                           learning_rate=0.05, random_state=42,
                           verbosity=0).fit(X_tr, y_tr)

    charts = {
        "learning_curve":      _chart_learning_curve(X, y, df),
        "eta_comparison":      _chart_eta_comparison(X_tr, X_ts, y_tr, y_ts, df_ts, ridge, mlp, sc, xgb),
        "feature_importance":  _chart_feature_importance(ridge, sc, xgb),
        "loss_curve":          _chart_loss_curve(mlp),
        "error_distribution":  _chart_error_distribution(X_ts, y_ts, df_ts, ridge, mlp, sc, xgb),
        "risk_timeline":       _chart_risk_timeline(),
    }

    mae_formula = mean_absolute_error(df_ts[TARGET].values, _formula_vec(df_ts))
    X_ts_sc = sc.transform(X_ts)
    meta = {
        "n_samples": len(df),
        "mae_formula": round(mae_formula, 1),
        "mae_ridge":   round(mean_absolute_error(y_ts, ridge.predict(X_ts_sc)), 1),
        "mae_mlp":     round(mean_absolute_error(y_ts, mlp.predict(X_ts_sc)), 1),
        "mae_xgb":     round(mean_absolute_error(y_ts, xgb.predict(X_ts)), 1) if xgb else None,
        "mlp_epochs":  len(mlp.loss_curve_),
        "features":    FEAT_RU,
    }
    return {"charts": charts, "meta": meta}


@router.get("/model-charts")
def get_model_charts():
    now = time.time()
    if "data" in _CACHE and now - _CACHE.get("ts", 0) < _CACHE_TTL:
        return _CACHE["data"]
    result = _build_all_charts()
    _CACHE["data"] = result
    _CACHE["ts"] = now
    return result


@router.delete("/model-charts/cache")
def clear_model_charts_cache():
    _CACHE.clear()
    return {"ok": True}
