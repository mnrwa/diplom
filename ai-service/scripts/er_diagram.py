#!/usr/bin/env python3
"""
ER-диаграмма базы данных VELTO Logistics Platform
Запуск:
    python scripts/er_diagram.py          # показать окно
    python scripts/er_diagram.py --save   # сохранить PNG в model/charts/
"""
import argparse
from pathlib import Path
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

ROOT = Path(__file__).resolve().parent.parent

# ── Стиль ─────────────────────────────────────────────────────────────────────
HDR_BG  = "#1e3a5f"   # тёмно-синий заголовок
HDR_FG  = "#ffffff"
ROW_BG  = "#f8fafc"
ROW_ALT = "#dde8f5"
BORDER  = "#2563eb"
LINE_C  = "#c0392b"   # красный — линии связей
TXT_C   = "#1e293b"
PK_C    = "#b45309"   # коричнево-золотой — PK
FK_C    = "#4f46e5"   # индиго — FK

BOX_W = 3.8   # ширина таблицы
HDR_H = 0.55  # высота заголовка
ROW_H = 0.40  # высота строки

# ── Таблицы: (поле, тип, pk, fk) ─────────────────────────────────────────────
TABLES = {
    "User": [
        ("id",        "serial",    True,  False),
        ("email",     "text",      False, False),
        ("name",      "text",      False, False),
        ("role",      "Role",      False, False),
        ("phone",     "text",      False, False),
        ("createdAt", "timestamp", False, False),
    ],
    "DriverProfile": [
        ("id",             "serial",       True,  False),
        ("userId",         "integer",      False, True),
        ("vehicleId",      "integer",      False, True),
        ("licenseNumber",  "text",         False, False),
        ("rating",         "double",       False, False),
        ("status",         "DriverStatus", False, False),
        ("telegramChatId", "text",         False, False),
    ],
    "Vehicle": [
        ("id",          "serial",        True,  False),
        ("plateNumber", "text",          False, False),
        ("model",       "text",          False, False),
        ("status",      "VehicleStatus", False, False),
        ("mileageKm",   "double",        False, False),
        ("maxWeightKg", "double",        False, False),
    ],
    "MaintenanceRecord": [
        ("id",          "serial",    True,  False),
        ("vehicleId",   "integer",   False, True),
        ("type",        "text",      False, False),
        ("mileageKm",   "double",    False, False),
        ("scheduledAt", "timestamp", False, False),
        ("doneAt",      "timestamp", False, False),
    ],
    "LocationPoint": [
        ("id",             "serial",           True,  False),
        ("name",           "text",             False, False),
        ("code",           "text",             False, False),
        ("type",           "LocationPointType",False, False),
        ("city",           "text",             False, False),
        ("lat / lon",      "double",           False, False),
        ("geofenceRadius", "double",           False, False),
    ],
    "Route": [
        ("id",            "serial",      True,  False),
        ("name",          "text",        False, False),
        ("startLat/Lon",  "double",      False, False),
        ("endLat/Lon",    "double",      False, False),
        ("distance",      "double",      False, False),
        ("estimatedTime", "integer",     False, False),
        ("mlEta",         "integer",     False, False),
        ("riskScore",     "double",      False, False),
        ("vehicleId",     "integer",     False, True),
        ("driverId",      "integer",     False, True),
        ("dispatcherId",  "integer",     False, True),
        ("startPointId",  "integer",     False, True),
        ("endPointId",    "integer",     False, True),
        ("status",        "RouteStatus", False, False),
        ("trackingToken", "text",        False, False),
    ],
    "GpsLog": [
        ("id",        "serial",    True,  False),
        ("vehicleId", "integer",   False, True),
        ("routeId",   "integer",   False, True),
        ("lat / lon", "double",    False, False),
        ("speed",     "double",    False, False),
        ("timestamp", "timestamp", False, False),
    ],
    "Waybill": [
        ("id",           "serial",  True,  False),
        ("routeId",      "integer", False, True),
        ("driverName",   "text",    False, False),
        ("vehiclePlate", "text",    False, False),
        ("status",       "text",    False, False),
        ("checkpoints",  "jsonb",   False, False),
    ],
    "GeofenceEvent": [
        ("id",              "serial",    True,  False),
        ("routeId",         "integer",   False, True),
        ("locationPointId", "integer",   False, True),
        ("eventType",       "text",      False, False),
        ("lat / lon",       "double",    False, False),
        ("timestamp",       "timestamp", False, False),
    ],
    "DriverNews": [
        ("id",              "serial",     True,  False),
        ("driverId",        "integer",    False, True),
        ("routeId",         "integer",    False, True),
        ("locationPointId", "integer",    False, True),
        ("source",          "NewsSource", False, False),
        ("title",           "text",       False, False),
        ("severity",        "double",     False, False),
        ("publishedAt",     "timestamp",  False, False),
    ],
    "RiskEvent": [
        ("id",        "serial",    True,  False),
        ("type",      "EventType", False, False),
        ("title",     "text",      False, False),
        ("severity",  "double",    False, False),
        ("active",    "boolean",   False, False),
        ("createdAt", "timestamp", False, False),
    ],
    "MarketplaceOrder": [
        ("id",           "serial",            True,  False),
        ("title",        "text",              False, False),
        ("createdById",  "integer",           False, True),
        ("startAddress", "text",              False, False),
        ("endAddress",   "text",              False, False),
        ("budget",       "double",            False, False),
        ("status",       "MarketplaceStatus", False, False),
    ],
    "MarketplaceBid": [
        ("id",            "serial",    True,  False),
        ("orderId",       "integer",   False, True),
        ("driverId",      "integer",   False, True),
        ("proposedPrice", "double",    False, False),
        ("status",        "BidStatus", False, False),
    ],
    "MultistopRoute": [
        ("id",            "serial",      True,  False),
        ("name",          "text",        False, False),
        ("status",        "RouteStatus", False, False),
        ("totalDistance", "double",      False, False),
        ("estimatedTime", "integer",     False, False),
    ],
    "MultistopStop": [
        ("id",               "serial",  True,  False),
        ("multistopRouteId", "integer", False, True),
        ("locationPointId",  "integer", False, True),
        ("stopOrder",        "integer", False, False),
        ("status",           "text",    False, False),
    ],
}

# ── Позиции: левый верхний угол каждой таблицы ────────────────────────────────
LAYOUT = {
    # Строка 1
    "User":              ( 0.0,  24.0),
    "DriverProfile":     ( 4.4,  24.0),
    "Vehicle":           ( 8.8,  24.0),
    "MaintenanceRecord": (13.2,  24.0),
    # Строка 2
    "LocationPoint":     ( 0.0,  13.5),
    "Route":             ( 4.8,  13.5),
    "GpsLog":            ( 9.4,  13.5),
    "Waybill":           (13.2,  13.5),
    # Строка 3
    "MarketplaceOrder":  ( 0.0,   4.5),
    "MarketplaceBid":    ( 4.4,   4.5),
    "DriverNews":        ( 8.8,   4.5),
    "RiskEvent":         (13.2,   4.5),
    # Строка 4
    "MultistopRoute":    ( 0.0,  -4.0),
    "MultistopStop":     ( 4.4,  -4.0),
    "GeofenceEvent":     ( 8.8,  -4.0),
}

# ── Связи: (откуда, куда, мощность_откуда, мощность_куда) ────────────────────
RELATIONS = [
    ("User",             "DriverProfile",     "1", "1"),
    ("Vehicle",          "DriverProfile",     "1", "1"),
    ("User",             "Route",             "1", "N"),
    ("DriverProfile",    "Route",             "1", "N"),
    ("Vehicle",          "Route",             "1", "N"),
    ("LocationPoint",    "Route",             "1", "N"),
    ("Vehicle",          "GpsLog",            "1", "N"),
    ("Route",            "GpsLog",            "1", "N"),
    ("Route",            "Waybill",           "1", "1"),
    ("Vehicle",          "MaintenanceRecord", "1", "N"),
    ("DriverProfile",    "DriverNews",        "1", "N"),
    ("Route",            "DriverNews",        "1", "N"),
    ("LocationPoint",    "DriverNews",        "1", "N"),
    ("User",             "MarketplaceOrder",  "1", "N"),
    ("MarketplaceOrder", "MarketplaceBid",    "1", "N"),
    ("DriverProfile",    "MarketplaceBid",    "1", "N"),
    ("MultistopRoute",   "MultistopStop",     "1", "N"),
    ("LocationPoint",    "MultistopStop",     "1", "N"),
    ("Route",            "GeofenceEvent",     "1", "N"),
    ("LocationPoint",    "GeofenceEvent",     "1", "N"),
]


# ── Вспомогательные функции ───────────────────────────────────────────────────

def box_h(name):
    return HDR_H + len(TABLES[name]) * ROW_H + 0.12

def box_bounds(name):
    x, y = LAYOUT[name]
    h = box_h(name)
    return x, y - h, x + BOX_W, y   # left, bottom, right, top

def edge_midpoints(name):
    l, b, r, t = box_bounds(name)
    cx, cy = (l + r) / 2, (t + b) / 2
    return {"L": (l, cy), "R": (r, cy), "T": (cx, t), "B": (cx, b)}

def best_edge_pair(n1, n2):
    ep1, ep2 = edge_midpoints(n1), edge_midpoints(n2)
    best, pair = float("inf"), (ep1["R"], ep2["L"])
    for p1 in ep1.values():
        for p2 in ep2.values():
            d = (p1[0]-p2[0])**2 + (p1[1]-p2[1])**2
            if d < best:
                best, pair = d, (p1, p2)
    return pair


def draw_table(ax, name):
    x, y = LAYOUT[name]
    cols = TABLES[name]
    h    = box_h(name)

    # Основной прямоугольник (тень)
    shadow = mpatches.FancyBboxPatch(
        (x + 0.07, y - h - 0.07), BOX_W, h,
        boxstyle="round,pad=0.04",
        linewidth=0, facecolor="#c0c0c0", alpha=0.35, zorder=1,
    )
    ax.add_patch(shadow)

    # Тело
    body = mpatches.FancyBboxPatch(
        (x, y - h), BOX_W, h,
        boxstyle="round,pad=0.04",
        linewidth=1.6, edgecolor=BORDER, facecolor=ROW_BG, zorder=2,
    )
    ax.add_patch(body)

    # Заголовок
    hdr = mpatches.Rectangle(
        (x, y - HDR_H), BOX_W, HDR_H,
        linewidth=0, facecolor=HDR_BG, zorder=3,
    )
    ax.add_patch(hdr)
    ax.text(x + BOX_W / 2, y - HDR_H / 2, name,
            ha="center", va="center", fontsize=8.5,
            fontweight="bold", color=HDR_FG, zorder=4)

    # Строки
    for i, (col, typ, pk, fk) in enumerate(cols):
        ry   = y - HDR_H - (i + 1) * ROW_H
        bg   = ROW_ALT if i % 2 == 0 else ROW_BG
        row  = mpatches.Rectangle(
            (x, ry), BOX_W, ROW_H,
            linewidth=0, facecolor=bg, zorder=3,
        )
        ax.add_patch(row)

        mid_y = ry + ROW_H / 2
        if pk:
            prefix, col_color, weight = "PK ", PK_C, "bold"
        elif fk:
            prefix, col_color, weight = "FK ", FK_C, "bold"
        else:
            prefix, col_color, weight = "",    TXT_C, "normal"

        ax.text(x + 0.14, mid_y, f"{prefix}{col}:",
                ha="left", va="center", fontsize=7,
                color=col_color, fontweight=weight, zorder=4)
        ax.text(x + BOX_W - 0.12, mid_y, typ,
                ha="right", va="center", fontsize=6.5,
                color="#64748b", zorder=4)

    # Горизонтальная линия под заголовком
    ax.plot([x, x + BOX_W], [y - HDR_H, y - HDR_H],
            color=BORDER, lw=1.0, zorder=4)


def draw_relation(ax, n1, n2, c1, c2):
    p1, p2 = best_edge_pair(n1, n2)
    ax.annotate("", xy=p2, xytext=p1,
                arrowprops=dict(
                    arrowstyle="-",
                    color=LINE_C,
                    lw=1.3,
                    connectionstyle="arc3,rad=0.0",
                ), zorder=1)

    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    length = max((dx**2 + dy**2) ** 0.5, 0.001)
    nx, ny = -dy / length, dx / length   # нормаль для смещения текста
    off    = 0.22

    ax.text(p1[0] + dx * 0.10 + nx * off,
            p1[1] + dy * 0.10 + ny * off,
            c1, fontsize=8.5, color=LINE_C, fontweight="bold",
            ha="center", va="center", zorder=5)
    ax.text(p2[0] - dx * 0.10 + nx * off,
            p2[1] - dy * 0.10 + ny * off,
            c2, fontsize=8.5, color=LINE_C, fontweight="bold",
            ha="center", va="center", zorder=5)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--save", action="store_true")
    parser.add_argument("--dpi",  type=int, default=150)
    args = parser.parse_args()

    fig, ax = plt.subplots(figsize=(30, 24))
    fig.patch.set_facecolor("#ffffff")
    ax.set_facecolor("#eef3f9")
    ax.axis("off")
    ax.set_aspect("equal")

    fig.suptitle(
        "Логическая модель базы данных (ER-диаграмма)\nVELTO Logistics Platform",
        fontsize=14, fontweight="bold", color=TXT_C, y=0.98,
    )

    # Связи — рисуем первыми (под таблицами)
    for n1, n2, c1, c2 in RELATIONS:
        draw_relation(ax, n1, n2, c1, c2)

    # Таблицы
    for name in TABLES:
        draw_table(ax, name)

    # Легенда
    legend = [
        mpatches.Patch(facecolor=PK_C,  label="PK — первичный ключ"),
        mpatches.Patch(facecolor=FK_C,  label="FK — внешний ключ"),
        mpatches.Patch(facecolor=LINE_C, label="— связь (1:1 / 1:N)"),
    ]
    ax.legend(handles=legend, loc="lower right",
              fontsize=9, framealpha=0.95, edgecolor=BORDER)

    # Автомасштаб
    xs = [LAYOUT[n][0] for n in LAYOUT] + [LAYOUT[n][0] + BOX_W for n in LAYOUT]
    ys = [LAYOUT[n][1] for n in LAYOUT] + [LAYOUT[n][1] - box_h(n) for n in LAYOUT]
    ax.set_xlim(min(xs) - 0.6, max(xs) + 0.6)
    ax.set_ylim(min(ys) - 0.8, max(ys) + 1.2)

    plt.tight_layout(rect=[0, 0, 1, 0.96])

    if args.save:
        out = ROOT / "model" / "charts"
        out.mkdir(parents=True, exist_ok=True)
        path = out / "er_diagram.png"
        fig.savefig(path, dpi=args.dpi, bbox_inches="tight", facecolor="white")
        print(f"Сохранено: {path}")
    else:
        plt.show()


if __name__ == "__main__":
    main()
