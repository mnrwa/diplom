"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  Gauge,
  MapPin,
  Navigation,
  PackageCheck,
  Truck,
  UserRound,
  Warehouse,
} from "lucide-react";
import { useWebSocket } from "@/hooks/useWebSocket";

const MapView = dynamic(() => import("@/components/map/MapView"), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type TrackData = {
  id: number;
  name: string;
  status: string;
  startPoint: { name: string; city: string; lat: number; lon: number } | null;
  endPoint: { name: string; city: string; lat: number; lon: number } | null;
  distance: number | null;
  estimatedTime: number | null;
  riskScore: number | null;
  fuelCostRub: number | null;
  driver: { name: string } | null;
  vehicle: { plateNumber: string; model: string } | null;
  latestPosition: { lat: number; lon: number; speed: number | null; timestamp: string } | null;
  waypoints: unknown;
  riskFactors: unknown;
};

const STATUS_LABEL: Record<string, string> = {
  PLANNED: "Запланирован",
  ACTIVE: "В пути",
  COMPLETED: "Доставлено",
  CANCELLED: "Отменён",
  RECALCULATING: "Пересчёт",
};

const STATUS_STYLE: Record<string, string> = {
  PLANNED: "bg-amber-100 text-amber-800 border border-amber-200",
  ACTIVE: "bg-emerald-100 text-emerald-800 border border-emerald-200",
  COMPLETED: "bg-green-100 text-green-800 border border-green-200",
  CANCELLED: "bg-red-100 text-red-800 border border-red-200",
  RECALCULATING: "bg-sky-100 text-sky-800 border border-sky-200",
};

function fmtEta(min: number) {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function TrackPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const { positions: wsPositions } = useWebSocket();

  useEffect(() => {
    if (!params?.token) return;
    const load = () =>
      fetch(`${API_URL}/public/track/${params.token}`)
        .then((r) => {
          if (!r.ok) throw new Error("Маршрут не найден");
          return r.json();
        })
        .then(setData)
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, [params?.token]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-fog">
        <div className="rounded-3xl bg-white p-12 text-center shadow-lg">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-plum border-t-transparent" />
          <p className="text-olive">Загружаем данные о маршруте...</p>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-fog">
        <div className="rounded-3xl bg-white p-12 text-center shadow-lg max-w-md">
          <div className="mb-4 text-5xl">📦</div>
          <h1 className="text-2xl font-bold text-plum">Заказ не найден</h1>
          <p className="mt-2 text-sm text-olive">
            Ссылка недействительна или срок отслеживания истёк.
          </p>
        </div>
      </main>
    );
  }

  const vehicleId = (data as any).vehicleId as number | undefined;
  const wsPos = vehicleId ? wsPositions[vehicleId] : null;
  const livePos = wsPos
    ? { lat: wsPos.lat, lon: wsPos.lon, speed: wsPos.speed ?? null, timestamp: wsPos.timestamp }
    : data.latestPosition;

  const osrmGeom = Array.isArray((data.riskFactors as any)?.routing?.geometry)
    ? (data.riskFactors as any).routing.geometry
    : null;

  const routeCoords: [number, number][] = osrmGeom
    ? osrmGeom.filter((p: any) => p?.lon != null).map((p: any) => [p.lon, p.lat] as [number, number])
    : ([
        data.startPoint ? [data.startPoint.lon, data.startPoint.lat] : null,
        data.endPoint ? [data.endPoint.lon, data.endPoint.lat] : null,
      ].filter(Boolean) as [number, number][]);

  const mapPoints = [
    ...(data.startPoint
      ? [{ id: "start", kind: "warehouse" as const, title: data.startPoint.name, subtitle: data.startPoint.city, longitude: data.startPoint.lon, latitude: data.startPoint.lat }]
      : []),
    ...(data.endPoint
      ? [{ id: "end", kind: "pickup" as const, title: data.endPoint.name, subtitle: data.endPoint.city, longitude: data.endPoint.lon, latitude: data.endPoint.lat }]
      : []),
    ...(livePos
      ? [{ id: "vehicle", kind: "vehicle" as const, title: data.vehicle?.plateNumber || "Транспорт", subtitle: data.driver?.name || undefined, longitude: livePos.lon, latitude: livePos.lat, speed: livePos.speed ?? undefined }]
      : []),
  ];

  // Progress 0..1: ratio of distance traveled / total distance
  let progress = 0;
  if (data.status === "COMPLETED") {
    progress = 1;
  } else if (livePos && data.startPoint && data.endPoint) {
    const total = haversineKm(data.startPoint.lat, data.startPoint.lon, data.endPoint.lat, data.endPoint.lon);
    const done = haversineKm(data.startPoint.lat, data.startPoint.lon, livePos.lat, livePos.lon);
    progress = total > 0 ? Math.min(done / total, 1) : 0;
  }

  const isCompleted = data.status === "COMPLETED";
  const isCancelled = data.status === "CANCELLED";
  const isActive = data.status === "ACTIVE";

  const updatedAgo = livePos?.timestamp
    ? Math.round((Date.now() - new Date(livePos.timestamp).getTime()) / 60_000)
    : null;

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-fog">
      {/* Top bar */}
      <header className="flex shrink-0 items-center justify-between border-b border-sand bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Truck className="h-5 w-5 text-plum" />
          <span className="text-xs uppercase tracking-[0.3em] text-warmsilver">VELTO Logistics</span>
        </div>
        <button
          onClick={copyLink}
          className="flex items-center gap-1.5 rounded-2xl border border-sand bg-fog px-3 py-1.5 text-xs text-olive transition hover:bg-warmlight"
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Скопировано!" : "Копировать ссылку"}
        </button>
      </header>

      {/* Two-column body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map — left */}
        <div className="relative flex-1 overflow-hidden">
          <MapView
            fitToData
            className="h-full w-full rounded-none"
            containerClassName="h-full rounded-none border-0 shadow-none"
            points={mapPoints}
            lines={
              routeCoords.length > 1
                ? [{ id: "route", name: data.name, color: "#10b981", coordinates: routeCoords }]
                : []
            }
          />
          {/* Live badge overlay */}
          {isActive && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-emerald-200 bg-white/90 px-4 py-2 text-xs font-medium text-emerald-700 backdrop-blur-sm shadow">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              {updatedAgo !== null
                ? updatedAgo === 0
                  ? "Обновлено только что"
                  : `Обновлено ${updatedAgo} мин назад`
                : "Live"}
            </div>
          )}
        </div>

        {/* Info panel — right */}
        <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-sand bg-white">
          <div className="flex flex-col gap-5 p-6">
            {/* Route name + status */}
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-warmsilver">Маршрут</p>
              <h1 className="mt-2 text-xl font-semibold text-plum leading-tight">{data.name}</h1>
              <span className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLE[data.status] ?? "bg-gray-100 text-gray-700"}`}>
                {isActive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
                {STATUS_LABEL[data.status] ?? data.status}
              </span>
            </div>

            <hr className="border-sand" />

            {/* Timeline / Chronology */}
            <div>
              <p className="mb-4 text-xs uppercase tracking-[0.3em] text-warmsilver">Хронология</p>
              <ol className="relative">
                {/* Step 1 – departure */}
                <TimelineStep
                  done={isActive || isCompleted}
                  active={false}
                  icon={<Warehouse className="h-3.5 w-3.5" />}
                  label="Отправление"
                  detail={data.startPoint ? `${data.startPoint.name}, ${data.startPoint.city}` : "—"}
                  last={false}
                />
                {/* Step 2 – in transit */}
                <TimelineStep
                  done={isCompleted}
                  active={isActive}
                  icon={<Navigation className="h-3.5 w-3.5" />}
                  label="В пути"
                  detail={
                    livePos
                      ? `${livePos.lat.toFixed(4)}, ${livePos.lon.toFixed(4)}`
                      : isCancelled
                      ? "Отменён"
                      : "Ожидание отправления"
                  }
                  last={false}
                />
                {/* Step 3 – arrival */}
                <TimelineStep
                  done={isCompleted}
                  active={false}
                  icon={<PackageCheck className="h-3.5 w-3.5" />}
                  label="Доставка"
                  detail={data.endPoint ? `${data.endPoint.name}, ${data.endPoint.city}` : "—"}
                  last
                />
              </ol>
            </div>

            {/* Progress bar */}
            {!isCancelled && (
              <div>
                <div className="mb-2 flex items-center justify-between text-xs text-warmsilver">
                  <span>Прогресс</span>
                  <span className="font-semibold text-plum">{Math.round(progress * 100)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-sand">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-plum to-purple-500 transition-all duration-700"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <hr className="border-sand" />

            {/* Stats row */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                icon={<Clock className="h-4 w-4 text-plum" />}
                label="ETA"
                value={data.estimatedTime ? fmtEta(data.estimatedTime) : "—"}
              />
              <StatCard
                icon={<Gauge className="h-4 w-4 text-sky-500" />}
                label="Скорость"
                value={typeof livePos?.speed === "number" ? `${Math.round(livePos.speed)} км/ч` : "—"}
              />
              <StatCard
                icon={<MapPin className="h-4 w-4 text-emerald-500" />}
                label="Расстояние"
                value={data.distance ? `${data.distance.toFixed(0)} км` : "—"}
              />
              <StatCard
                icon={<Navigation className="h-4 w-4 text-amber-500" />}
                label="Риск"
                value={data.riskScore != null ? `${Math.round(data.riskScore * 100)}%` : "—"}
              />
            </div>

            <hr className="border-sand" />

            {/* Driver & vehicle */}
            <div className="space-y-3">
              {data.driver && (
                <div className="flex items-center gap-3 rounded-2xl border border-sand bg-fog px-4 py-3">
                  <div className="rounded-xl bg-plum/10 p-2">
                    <UserRound className="h-4 w-4 text-plum" />
                  </div>
                  <div>
                    <p className="text-xs text-warmsilver">Водитель</p>
                    <p className="font-semibold text-plum">{data.driver.name}</p>
                  </div>
                </div>
              )}
              {data.vehicle && (
                <div className="flex items-center gap-3 rounded-2xl border border-sand bg-fog px-4 py-3">
                  <div className="rounded-xl bg-sky-100 p-2">
                    <Truck className="h-4 w-4 text-sky-600" />
                  </div>
                  <div>
                    <p className="text-xs text-warmsilver">Транспорт</p>
                    <p className="font-semibold text-plum">{data.vehicle.model} · {data.vehicle.plateNumber}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="mt-auto px-6 pb-5 text-center text-xs text-warmsilver">
            Обновляется каждые 15 сек · VELTO Logistics
          </p>
        </aside>
      </div>
    </main>
  );
}

function TimelineStep({
  done,
  active,
  icon,
  label,
  detail,
  last,
}: {
  done: boolean;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  detail: string;
  last: boolean;
}) {
  return (
    <li className="flex gap-4">
      {/* Dot + line */}
      <div className="flex flex-col items-center">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors
            ${done
              ? "border-emerald-500 bg-emerald-500 text-white"
              : active
              ? "border-plum bg-plum text-white"
              : "border-sand bg-fog text-warmsilver"
            }`}
        >
          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : active ? <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> : icon}
        </div>
        {!last && (
          <div className={`mt-1 w-0.5 flex-1 min-h-[24px] ${done || active ? "bg-emerald-200" : "bg-sand"}`} />
        )}
      </div>

      {/* Content */}
      <div className="pb-5">
        <p className={`text-sm font-semibold ${active ? "text-plum" : done ? "text-emerald-700" : "text-olive"}`}>
          {label}
        </p>
        <p className="mt-0.5 text-xs text-warmsilver">{detail}</p>
      </div>
    </li>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-sand bg-fog px-3 py-3">
      {icon}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-warmsilver">{label}</p>
        <p className="mt-0.5 text-sm font-bold text-plum">{value}</p>
      </div>
    </div>
  );
}
