#!/usr/bin/env python3
"""
ETA Model — сравнительная визуализация (7 графиков).
Три подхода: Формула → Линейная регрессия → нейронная сеть (MLP)

Запуск:
    python scripts/visualize_model.py            # интерактивные окна
    python scripts/visualize_model.py --save     # PNG в model/charts/
    python scripts/visualize_model.py --save --dpi 200

Зависимости:
    pip install matplotlib scikit-learn pandas numpy
"""

import argparse
import math
import random
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent

# ── Палитра ───────────────────────────────────────────────────────────────────

C = {
    "formula": "#94a3b8",   # серый   — формула
    "lr":      "#f59e0b",   # янтарь  — линейная регрессия
    "nn":      "#6366f1",   # индиго  — нейронная сеть
    "good":    "#10b981",   # зелёный — улучшение
    "bad":     "#ef4444",   # красный
    "warn":    "#f97316",   # оранжевый
    "bg":      "#f8fafc",
    "grid":    "#e2e8f0",
    "text":    "#1e293b",
    "sub":     "#64748b",
}

MODELS = [
    ("Формула",            "formula"),
    ("Линейная регрессия", "lr"),
    ("нейронная сеть (MLP)",     "nn"),
]


def _style(ax, title: str, xlabel: str = "", ylabel: str = ""):
    ax.set_facecolor(C["bg"])
    for sp in ["top", "right"]:
        ax.spines[sp].set_visible(False)
    for sp in ["left", "bottom"]:
        ax.spines[sp].set_color(C["grid"])
    ax.tick_params(colors=C["sub"], labelsize=9)
    ax.xaxis.label.set_color(C["sub"])
    ax.yaxis.label.set_color(C["sub"])
    ax.grid(True, color=C["grid"], linewidth=0.7, zorder=0)
    ax.set_title(title, fontsize=11, fontweight="bold", color=C["text"], pad=10)
    if xlabel:
        ax.set_xlabel(xlabel, fontsize=9)
    if ylabel:
        ax.set_ylabel(ylabel, fontsize=9)


# ── Данные ────────────────────────────────────────────────────────────────────

REGIONS = {
    "moscow":  {"base_kmh": 47,  "weight": 0.25},
    "spb":     {"base_kmh": 53,  "weight": 0.12},
    "volga":   {"base_kmh": 95,  "weight": 0.15},
    "ural":    {"base_kmh": 92,  "weight": 0.10},
    "siberia": {"base_kmh": 98,  "weight": 0.10},
    "south":   {"base_kmh": 90,  "weight": 0.12},
    "central": {"base_kmh": 93,  "weight": 0.16},
}
CARGO   = {"express": 1.08, "standard": 1.00, "heavy": 0.83, "cold": 0.89}
CARGO_W = [0.20, 0.45, 0.20, 0.15]

FEATURES = [
    "distance_km", "dist_log", "hour_of_day", "day_of_week",
    "weather_score", "news_score", "risk_score",
    "is_rush_hour", "is_night", "is_weekend",
    "weather_x_rush", "segment_avg_min",
]
FEAT_RU = [
    "Дистанция (км)", "log(Дистанция)", "Час суток", "День недели",
    "Погода", "Новости", "Риск",
    "Час пик", "Ночь", "Выходной",
    "Погода × час пик", "Ист. среднее (сегмент)",
]
TARGET = "actual_minutes"


def _base_spd(d, reg):
    if d < 30:   return min(reg, 43)
    if d < 100:  return reg * 0.72
    if d < 400:  return reg * 0.88
    if d < 1200: return reg
    return reg * 0.87


def _wf(w):
    if w < 0.10: return 1.00
    if w < 0.40: return 0.88
    if w < 0.65: return 0.75
    if w < 0.80: return 0.62
    return 0.50


def generate(n: int = 8000, seed: int = 42) -> pd.DataFrame:
    rng = random.Random(seed)
    np.random.seed(seed)
    reg_names   = list(REGIONS.keys())
    reg_weights = [REGIONS[r]["weight"] for r in reg_names]
    cargo_names = list(CARGO.keys())
    hist: dict[tuple, list] = {}
    rows = []
    for _ in range(n):
        reg   = rng.choices(reg_names,   weights=reg_weights)[0]
        cargo = rng.choices(cargo_names, weights=CARGO_W)[0]
        dt    = rng.choices(["city","reg","hwy","long"], weights=[0.25,0.35,0.30,0.10])[0]
        d = {"city": rng.uniform(5,50), "reg": rng.uniform(50,300),
             "hwy": rng.uniform(300,1000), "long": rng.uniform(1000,4000)}[dt]
        h, dow = rng.randint(0, 23), rng.randint(0, 6)
        ws = float(np.random.beta(1.5, 6))
        ns = float(np.random.beta(1.2, 8))
        rs = float(np.random.beta(1.5, 5))
        rush  = 1 if (7 <= h <= 9 or 17 <= h <= 20) else 0
        night = 1 if (h >= 23 or h <= 5) else 0
        wknd  = 1 if dow >= 5 else 0
        spd   = _base_spd(d, REGIONS[reg]["base_kmh"]) * CARGO[cargo]
        cw    = min(1.0, 60.0 / max(d, 1.0))
        if rush:  spd *= rng.uniform(0.55, 0.75)*cw + rng.uniform(0.90, 0.98)*(1-cw)
        if night: spd *= rng.uniform(0.90, 0.97)
        if wknd:  spd *= rng.uniform(0.98, 1.06)
        spd *= _wf(ws) * (1-ns*0.22) * (1-rs*0.15)
        if rush and ws > 0.4:
            spd *= 1 - cw * rng.uniform(0.15, 0.30)
        spd  = max(18.0, spd)
        mins = (d / spd) * 60
        if d > 500:
            mins += int(d // 250) * rng.uniform(20, 45)
        mins = max(5.0, mins * float(np.random.normal(1.0, 0.12)))
        bucket  = (dt, round(d / 50) * 50)
        seg_avg = float(np.mean(hist[bucket])) if bucket in hist and hist[bucket] else mins
        hist.setdefault(bucket, []).append(mins)
        rows.append({
            "distance_km":    round(d, 2),
            "dist_log":       round(math.log1p(d), 4),
            "hour_of_day":    h,
            "day_of_week":    dow,
            "weather_score":  round(ws, 3),
            "news_score":     round(ns, 3),
            "risk_score":     round(rs, 3),
            "is_rush_hour":   rush,
            "is_night":       night,
            "is_weekend":     wknd,
            "weather_x_rush": round(ws * rush, 3),
            "segment_avg_min": round(seg_avg, 1),
            TARGET:           round(mins, 1),
        })
    return pd.DataFrame(rows)


def formula_vec(df: pd.DataFrame) -> np.ndarray:
    d  = df["distance_km"].values
    h  = df["hour_of_day"].values
    ws = df["weather_score"].values
    ns = df["news_score"].values
    rs = df["risk_score"].values
    dw = df["day_of_week"].values
    base  = np.where(d < 60, 52., np.where(d < 250, 90., np.where(d < 700, 105., 95.)))
    cw    = np.minimum(1., 60. / np.maximum(d, 1.))
    rush  = ((h >= 7) & (h <= 9)) | ((h >= 17) & (h <= 19))
    night = (h >= 23) | (h <= 5)
    tod   = np.where(rush, 0.70 + 0.25*(1-cw), np.where(night, 0.93, 1.0))
    spd   = np.maximum(25., base * tod * np.where(dw >= 5, 1.04, 1.0)
                           * (1-ws*0.28) * (1-ns*0.18) * (1-rs*0.12))
    return np.maximum(5., np.ceil(d / spd * 60))


# ── Обучение моделей ──────────────────────────────────────────────────────────

def train_models(df: pd.DataFrame) -> dict:
    X = df[FEATURES].values
    y = df[TARGET].values
    X_tr, X_ts, y_tr, y_ts = train_test_split(X, y, test_size=0.20, random_state=42)
    df_ts = df.iloc[len(df) - len(y_ts):]

    # Линейная регрессия
    print("  Линейная регрессия...", end=" ", flush=True)
    lr_pipe = Pipeline([("sc", StandardScaler()), ("lr", LinearRegression())])
    lr_pipe.fit(X_tr, y_tr)
    print("готово")

    # нейронная сеть
    print("  нейронная сеть MLP 128→64→32...", end=" ", flush=True)
    nn_pipe = Pipeline([
        ("sc", StandardScaler()),
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
    nn_pipe.fit(X_tr, y_tr)
    nn = nn_pipe.named_steps["nn"]
    print(f"готово ({len(nn.loss_curve_)} эпох)")

    return dict(
        lr_pipe=lr_pipe, nn_pipe=nn_pipe, nn=nn,
        X_tr=X_tr, X_ts=X_ts, y_tr=y_tr, y_ts=y_ts, df_ts=df_ts,
    )


# ══════════════════════════════════════════════════════════════════════════════
#  ГРАФИК 1 — Кривая обучения
# ══════════════════════════════════════════════════════════════════════════════

def plot_learning_curve(ax, df: pd.DataFrame, m: dict):
    sizes  = [200, 500, 1000, 2000, 3500, 5500, 8000]
    sizes  = [s for s in sizes if s <= int(len(df) * 0.8)]
    X_all  = df[FEATURES].values
    y_all  = df[TARGET].values
    _, X_ts, _, y_ts = train_test_split(X_all, y_all, test_size=0.20, random_state=42)

    f_mae  = mean_absolute_error(formula_vec(m["df_ts"]), m["df_ts"][TARGET].values)
    lr_maes, nn_maes = [], []

    rng    = np.random.default_rng(7)
    X_pool = X_all[:int(len(df)*0.8)]
    y_pool = y_all[:int(len(df)*0.8)]

    for sz in sizes:
        idx = rng.choice(len(X_pool), min(sz, len(X_pool)), replace=False)

        lp = Pipeline([("sc", StandardScaler()), ("lr", LinearRegression())])
        lp.fit(X_pool[idx], y_pool[idx])
        lr_maes.append(mean_absolute_error(y_ts, lp.predict(X_ts)))

        np_ = Pipeline([("sc", StandardScaler()),
                        ("nn", MLPRegressor(hidden_layer_sizes=(64, 32),
                                            max_iter=200, random_state=42))])
        np_.fit(X_pool[idx], y_pool[idx])
        nn_maes.append(mean_absolute_error(y_ts, np_.predict(X_ts)))

    ax.axhline(f_mae, ls="--", color=C["formula"], lw=2,
               label=f"Формула  {f_mae:.0f} мин (не обучается)")
    ax.plot(sizes[:len(lr_maes)], lr_maes, "s-", color=C["lr"], lw=2, markersize=6,
            label="Линейная регрессия")
    ax.plot(sizes[:len(nn_maes)], nn_maes, "o-", color=C["nn"], lw=2, markersize=6,
            label="нейронная сеть (MLP)")

    ax.fill_between(sizes[:len(nn_maes)], nn_maes, f_mae,
                    where=[v < f_mae for v in nn_maes],
                    color=C["good"], alpha=0.10)

    ax.set_xscale("log")
    _style(ax, "① Точность моделей по мере накопления рейсов",
           "Кол-во исторических рейсов", "MAE (мин)")
    ax.legend(fontsize=9, framealpha=0.92)

    # Аннотация итогового выигрыша нейронной сети
    if nn_maes:
        gain = (f_mae - nn_maes[-1]) / f_mae * 100
        ax.annotate(f"−{gain:.0f}% ошибки\n(нейронная сеть vs формула)",
                    xy=(sizes[:len(nn_maes)][-1], nn_maes[-1]),
                    xytext=(-120, 20), textcoords="offset points",
                    arrowprops=dict(arrowstyle="->", color=C["good"], lw=1),
                    fontsize=8.5, color=C["good"], fontweight="bold")


# ══════════════════════════════════════════════════════════════════════════════
#  ГРАФИК 2 — Факт vs Прогноз
# ══════════════════════════════════════════════════════════════════════════════

def plot_eta_comparison(ax, m: dict):
    y_ts  = m["y_ts"]
    df_ts = m["df_ts"]
    X_ts  = m["X_ts"]
    cap   = 600

    preds = [
        ("Формула",            formula_vec(df_ts),          C["formula"], "o"),
        ("Линейная регрессия", m["lr_pipe"].predict(X_ts),  C["lr"],      "s"),
        ("нейронная сеть (MLP)",     m["nn_pipe"].predict(X_ts),  C["nn"],      "^"),
    ]

    actual_cap = np.minimum(y_ts, cap)
    for name, pred, col, mk in preds:
        pc  = np.minimum(pred, cap)
        mae = mean_absolute_error(actual_cap, pc)
        r2  = r2_score(actual_cap, pc)
        ax.scatter(pc, actual_cap, alpha=0.12, s=5, color=col, marker=mk,
                   label=f"{name}  MAE={mae:.0f}м  R²={r2:.3f}")

    ax.plot([0, cap], [0, cap], "--", color="#475569", lw=1.4, label="Идеал")
    _style(ax, "② Факт vs Прогноз ETA", "Прогноз (мин)", "Фактическое время (мин)")
    ax.set_xlim(0, cap); ax.set_ylim(0, cap)
    ax.legend(fontsize=8.5, framealpha=0.92)


# ══════════════════════════════════════════════════════════════════════════════
#  ГРАФИК 3 — Важность признаков
# ══════════════════════════════════════════════════════════════════════════════

def plot_feature_importance(ax, m: dict):
    print("  [3/7] Permutation importance (~30 сек)...", flush=True)

    # нейронная сеть — permutation importance
    pi = permutation_importance(
        m["nn_pipe"], m["X_ts"], m["y_ts"],
        n_repeats=8, random_state=42, scoring="neg_mean_absolute_error",
    )
    nn_imp = pi.importances_mean

    # Линейная регрессия — нормированные |коэффициенты|
    coef   = np.abs(m["lr_pipe"].named_steps["lr"].coef_)
    lr_imp = coef / (coef.sum() + 1e-9) * nn_imp.max()  # масштаб как у нейронной сети

    order  = np.argsort(nn_imp)
    labels = [FEAT_RU[i] for i in order]
    y_pos  = np.arange(len(labels))

    ax.barh(y_pos - 0.2, lr_imp[order], 0.35, color=C["lr"],
            alpha=0.80, label="Лин. регрессия |коэф|", zorder=3)
    bars = ax.barh(y_pos + 0.2, nn_imp[order], 0.35, color=C["nn"],
                   alpha=0.80, label="нейронная сеть (perm. importance)", zorder=3)

    # Выделяем исторический признак
    hist_local = list(order).index(FEATURES.index("segment_avg_min"))
    bars[hist_local].set_edgecolor(C["warn"])
    bars[hist_local].set_linewidth(2.5)

    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=8)
    _style(ax, "③ Важность признаков: линейная регрессия vs нейронная сеть")
    ax.legend(fontsize=8.5, framealpha=0.92)
    ax.text(0.98, 0.03, "★ оранжевая рамка = историческое среднее сегмента",
            transform=ax.transAxes, ha="right", va="bottom",
            fontsize=7.5, color=C["warn"])


# ══════════════════════════════════════════════════════════════════════════════
#  ГРАФИК 4 — Кривая обучения нейронной сети
# ══════════════════════════════════════════════════════════════════════════════

def plot_loss_curve(ax, m: dict):
    curve = np.array(m["nn"].loss_curve_)
    iters = np.arange(1, len(curve) + 1)

    ax.plot(iters, curve, color=C["nn"], lw=1.5, alpha=0.40,
            label="Train loss (каждая эпоха)")

    w      = max(3, len(curve) // 12)
    smooth = np.convolve(curve, np.ones(w)/w, mode="valid")
    ax.plot(np.arange(w, len(curve)+1), smooth, color=C["nn"], lw=2.5,
            label=f"Сглажено (окно {w})")

    # Линейная регрессия — нет эпох, просто одна точка MAE² для сравнения
    mae_lr = mean_absolute_error(m["y_ts"], m["lr_pipe"].predict(m["X_ts"]))
    ax.axhline(mae_lr**2, ls="--", color=C["lr"], lw=1.6,
               label=f"Лин. регрессия MSE={mae_lr**2:.0f} (финал)")

    min_i = int(np.argmin(curve))
    ax.axvline(min_i + 1, ls="--", color=C["warn"], lw=1.2)
    ax.scatter([min_i + 1], [curve[min_i]], color=C["warn"], s=70, zorder=5)
    ax.annotate(f"Мин. loss эпоха {min_i+1}",
                xy=(min_i+1, curve[min_i]),
                xytext=(22, 10), textcoords="offset points",
                arrowprops=dict(arrowstyle="->", color=C["warn"], lw=0.9),
                fontsize=8, color=C["warn"])

    _style(ax, f"④ Как нейронная сеть обучалась ({len(curve)} эпох) vs линейная регрессия",
           "Эпоха", "MSE loss (лог)")
    ax.set_yscale("log")
    ax.legend(fontsize=8.5, framealpha=0.92)
    ax.text(0.98, 0.97,
            "нейронная сеть: 128 → 64 → 32 → 1\nReLU · Adam · Early stopping\n"
            "Лин. регрессия: одна итерация МНК",
            transform=ax.transAxes, ha="right", va="top", fontsize=8,
            bbox=dict(boxstyle="round,pad=0.4", facecolor="white", alpha=0.88))


# ══════════════════════════════════════════════════════════════════════════════
#  ГРАФИК 5 — Распределение ошибок
# ══════════════════════════════════════════════════════════════════════════════

def plot_error_distribution(ax, m: dict):
    y_ts  = m["y_ts"]
    df_ts = m["df_ts"]
    X_ts  = m["X_ts"]

    series = [
        ("Формула",            formula_vec(df_ts)           - y_ts, C["formula"]),
        ("Линейная регрессия", m["lr_pipe"].predict(X_ts)   - y_ts, C["lr"]),
        ("нейронная сеть (MLP)",     m["nn_pipe"].predict(X_ts)   - y_ts, C["nn"]),
    ]

    bins = np.linspace(-260, 260, 85)
    for name, resid, col in series:
        mu, sig = float(np.mean(resid)), float(np.std(resid))
        mae     = float(np.mean(np.abs(resid)))
        ax.hist(resid, bins=bins, color=col, alpha=0.25, density=True)
        x = np.linspace(-260, 260, 500)
        ax.plot(x, np.exp(-0.5*((x-mu)/sig)**2) / (sig*(2*np.pi)**0.5),
                color=col, lw=2.2,
                label=f"{name}  MAE={mae:.0f}м  σ={sig:.0f}м  смещ={mu:+.0f}м")

    ax.axvline(0, color=C["text"], lw=1.5, ls="--", alpha=0.5, label="0 = идеал")
    _style(ax, "⑤ Распределение ошибок: Формула → Лин. регрессия → нейронная сеть",
           "Ошибка: прогноз − факт (мин)", "Плотность")
    ax.legend(fontsize=8.5, framealpha=0.92)


# ══════════════════════════════════════════════════════════════════════════════
#  ГРАФИК 6 — Risk score по маршруту
# ══════════════════════════════════════════════════════════════════════════════

def plot_risk_timeline(ax):
    t  = np.linspace(0, 1, 300)
    km = t * 430

    weather = np.clip(0.04 + 0.48*np.exp(-((t-0.46)**2)/0.014)
                           + 0.14*np.exp(-((t-0.62)**2)/0.008), 0, 1)
    news    = np.clip(0.03 + 0.60*np.exp(-((t-0.48)**2)/0.006)
                           + 0.28*np.exp(-((t-0.54)**2)/0.004), 0, 1)
    road    = np.clip(0.08 + 0.22*np.exp(-((t-0.20)**2)/0.003)
                           + 0.10*np.sin(t*np.pi*5)*0.3
                           + 0.12*np.where(t > 0.90, 1.0, 0.0), 0, 0.45)
    total   = np.clip(weather*0.35 + news*0.40 + road*0.25, 0, 1)

    ax.stackplot(km, weather*0.35, news*0.40, road*0.25,
                 labels=["Погода (35%)", "Инциденты / новости (40%)", "Дорога (25%)"],
                 colors=[C["formula"], C["lr"], C["nn"]], alpha=0.72)
    ax.plot(km, total, color=C["bad"], lw=2.5, label="Итоговый risk_score")
    ax.axhline(0.5, color=C["bad"], lw=1.0, ls="--", alpha=0.6)
    ax.text(4, 0.52, "Порог тревоги 0.5", color=C["bad"], fontsize=8)

    pk = int(np.argmax(total))
    ax.annotate(f"Пик {total[pk]:.2f}\n(ДТП + дождь)",
                xy=(km[pk], total[pk]),
                xytext=(-60, 14), textcoords="offset points",
                arrowprops=dict(arrowstyle="->", color=C["text"], lw=0.9),
                fontsize=8, color=C["text"])

    repair = (km >= 0.18*430) & (km <= 0.23*430)
    ax.fill_between(km, 0, total, where=repair, color=C["bad"],
                    alpha=0.12, label="Зона ремонта дороги")
    ax.set_ylim(0, 1)
    _style(ax, "⑥ Динамика risk_score по маршруту (Москва → Н.Новгород 430 км)",
           "Пройдено (км)", "risk_score")
    ax.legend(fontsize=8.5, framealpha=0.92, loc="upper right")


# ══════════════════════════════════════════════════════════════════════════════
#  ГРАФИК 7 — До / После по типам маршрутов
# ══════════════════════════════════════════════════════════════════════════════

def plot_before_after(ax, m: dict):
    buckets = [
        (0,    50,   "Город\n<50 км"),
        (50,   300,  "Регион\n50–300 км"),
        (300,  1000, "Трасса\n300–1000 км"),
        (1000, 9999, "Дальний\n>1000 км"),
    ]

    X_ts  = m["X_ts"]
    y_ts  = m["y_ts"]
    df_ts = m["df_ts"]
    dist  = df_ts["distance_km"].values

    f_maes, lr_maes, nn_maes = [], [], []
    for lo, hi, _ in buckets:
        mask = np.where((dist >= lo) & (dist < hi))[0]
        if len(mask) < 5:
            f_maes.append(0); lr_maes.append(0); nn_maes.append(0)
            continue
        yt  = y_ts[mask]
        f_maes.append( mean_absolute_error(yt, formula_vec(df_ts.iloc[mask])))
        lr_maes.append(mean_absolute_error(yt, m["lr_pipe"].predict(X_ts[mask])))
        nn_maes.append(mean_absolute_error(yt, m["nn_pipe"].predict(X_ts[mask])))

    labels = [b[2] for b in buckets]
    x, w   = np.arange(len(labels)), 0.24

    b_f  = ax.bar(x - w,   f_maes,  w, color=C["formula"], alpha=0.85,
                  label="Формула (baseline)", zorder=3)
    b_lr = ax.bar(x,       lr_maes, w, color=C["lr"],      alpha=0.85,
                  label="Лин. регрессия", zorder=3)
    b_nn = ax.bar(x + w,   nn_maes, w, color=C["nn"],      alpha=0.85,
                  label="нейронная сеть (MLP)", zorder=3)

    for bars, vals in [(b_f, f_maes), (b_lr, lr_maes), (b_nn, nn_maes)]:
        for rect, v in zip(bars, vals):
            if v > 0:
                ax.text(rect.get_x() + rect.get_width()/2, rect.get_height() + 1.5,
                        f"{v:.0f}", ha="center", va="bottom",
                        fontsize=8, color=C["text"])

    # Стрелки: формула → лин. регрессия → нейронная сеть
    for i in range(len(buckets)):
        fm, lm, nm = f_maes[i], lr_maes[i], nn_maes[i]
        if fm <= 0:
            continue
        top = max(fm, lm, nm)
        # Формула → лин. регрессия
        pct_lr = (fm - lm) / fm * 100
        if pct_lr > 0.5:
            ax.annotate(f"−{pct_lr:.0f}%",
                        xy=(x[i], lm), xytext=(x[i] - w*0.5, top + top*0.08),
                        ha="center", fontsize=7.5, color=C["lr"], fontweight="bold",
                        arrowprops=dict(arrowstyle="-|>", color=C["lr"],
                                        lw=1.0, mutation_scale=8))
        # Формула → нейронная сеть
        pct_nn = (fm - nm) / fm * 100
        if pct_nn > 0.5:
            ax.annotate(f"−{pct_nn:.0f}%",
                        xy=(x[i] + w, nm), xytext=(x[i] + w*1.5, top + top*0.08),
                        ha="center", fontsize=7.5, color=C["nn"], fontweight="bold",
                        arrowprops=dict(arrowstyle="-|>", color=C["nn"],
                                        lw=1.0, mutation_scale=8))

    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=10)
    _style(ax, "⑦ До / После: MAE по типам маршрутов  (Формула → Лин. регрессия → нейронная сеть)",
           "Тип маршрута", "MAE (мин)")
    ax.legend(fontsize=9, framealpha=0.92, loc="upper right")

    # Итоговая строка
    mae_f  = mean_absolute_error(m["y_ts"], formula_vec(m["df_ts"]))
    mae_lr = mean_absolute_error(m["y_ts"], m["lr_pipe"].predict(m["X_ts"]))
    mae_nn = mean_absolute_error(m["y_ts"], m["nn_pipe"].predict(m["X_ts"]))
    ax.text(0.01, 0.97,
            f"Итого — Формула: {mae_f:.1f} мин  →  "
            f"Лин. регр.: {mae_lr:.1f} мин (−{(mae_f-mae_lr)/mae_f*100:.0f}%)  →  "
            f"нейронная сеть: {mae_nn:.1f} мин (−{(mae_f-mae_nn)/mae_f*100:.0f}%)",
            transform=ax.transAxes, va="top", fontsize=9, color=C["text"],
            bbox=dict(boxstyle="round,pad=0.4", facecolor="white", alpha=0.90))


# ══════════════════════════════════════════════════════════════════════════════
#  Main
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--save",    action="store_true")
    parser.add_argument("--dpi",     type=int, default=140)
    parser.add_argument("--samples", type=int, default=8000)
    args = parser.parse_args()

    print(f"\n[1/3] Генерация {args.samples:,} исторических рейсов...", flush=True)
    df = generate(n=args.samples)

    print("\n[2/3] Обучение моделей...")
    m = train_models(df)

    mae_f  = mean_absolute_error(m["y_ts"], formula_vec(m["df_ts"]))
    mae_lr = mean_absolute_error(m["y_ts"], m["lr_pipe"].predict(m["X_ts"]))
    mae_nn = mean_absolute_error(m["y_ts"], m["nn_pipe"].predict(m["X_ts"]))

    print(f"\n  ─── MAE на тестовой выборке ───────────────────────────────")
    print(f"  Формула              : {mae_f:.1f} мин  (базовая линия)")
    print(f"  Линейная регрессия   : {mae_lr:.1f} мин  ({(mae_f-mae_lr)/mae_f*100:+.1f}% vs формула)")
    print(f"  нейронная сеть (MLP)       : {mae_nn:.1f} мин  ({(mae_f-mae_nn)/mae_f*100:+.1f}% vs формула)")
    print(f"  нейронная сеть vs лин. рег : {(mae_lr-mae_nn)/mae_lr*100:+.1f}%")
    print(f"  ──────────────────────────────────────────────────────────────")

    print("\n[3/3] Построение графиков...")

    charts = [
        ("① Точность по рейсам",       (12, 6.5), lambda fig: plot_learning_curve(    fig.add_subplot(111), df, m)),
        ("② Факт vs Прогноз ETA",       (9,  8.5), lambda fig: plot_eta_comparison(    fig.add_subplot(111), m)),
        ("③ Важность признаков",        (12, 7.5), lambda fig: plot_feature_importance(fig.add_subplot(111), m)),
        ("④ Кривая обучения нейронной сети",  (11, 6.5), lambda fig: plot_loss_curve(        fig.add_subplot(111), m)),
        ("⑤ Распределение ошибок",      (12, 6.5), lambda fig: plot_error_distribution(fig.add_subplot(111), m)),
        ("⑥ Risk score по маршруту",    (13, 6.5), lambda fig: plot_risk_timeline(     fig.add_subplot(111))),
        ("⑦ До / После по типам",       (14, 7.5), lambda fig: plot_before_after(      fig.add_subplot(111), m)),
    ]

    if args.save:
        out_dir = ROOT / "model" / "charts"
        out_dir.mkdir(parents=True, exist_ok=True)

    for i, (title, size, draw_fn) in enumerate(charts, 1):
        print(f"  [{i}/7] {title}...", flush=True)
        fig = plt.figure(figsize=size, facecolor="white", num=title)
        fig.suptitle(f"VELTO Logistics — {title}",
                     fontsize=12, fontweight="bold", color=C["text"], y=0.998)
        draw_fn(fig)
        fig.tight_layout(rect=[0, 0, 1, 0.97])

        if args.save:
            slug     = title.split()[1].replace("/", "_")
            out_path = out_dir / f"chart_{i:02d}_{slug}.png"
            fig.savefig(out_path, dpi=args.dpi, bbox_inches="tight", facecolor="white")
            print(f"         Сохранено: {out_path}")

    if not args.save:
        print(f"\n  Открываю 7 окон matplotlib...")
        plt.show()


if __name__ == "__main__":
    main()

