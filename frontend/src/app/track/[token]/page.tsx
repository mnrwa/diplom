"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import MapView from "@/components/map/MapView";
import { useWebSocket } from "@/hooks/useWebSocket";

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
  COMPLETED: "Доставлено ✅",
  CANCELLED: "Отменён",
  RECALCULATING: "Пересчёт маршрута",
};
const STATUS_COLOR: Record<string, string> = {
  PLANNED: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
  RECALCULATING: "bg-blue-100 text-blue-800",
};

export default function TrackPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<TrackData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
          <p className="text-olive">Загружаем информацию о заказе...</p>
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
          <p className="mt-2 text-sm text-olive">Ссылка недействительна или срок отслеживания истёк.</p>
        </div>
      </main>
    );
  }

  // Get live vehicle position from WebSocket if vehicle is known
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
    : [
        data.startPoint ? [data.startPoint.lon, data.startPoint.lat] as [number, number] : null,
        data.endPoint ? [data.endPoint.lon, data.endPoint.lat] as [number, number] : null,
      ].filter(Boolean) as [number, number][];

  const mapPoints = [
    ...(data.startPoint ? [{
      id: "start",
      kind: "warehouse" as const,
      title: data.startPoint.name,
      subtitle: data.startPoint.city,
      longitude: data.startPoint.lon,
      latitude: data.startPoint.lat,
    }] : []),
    ...(data.endPoint ? [{
      id: "end",
      kind: "pickup" as const,
      title: data.endPoint.name,
      subtitle: data.endPoint.city,
      longitude: data.endPoint.lon,
      latitude: data.endPoint.lat,
    }] : []),
    ...(livePos ? [{
      id: "vehicle",
      kind: "vehicle" as const,
      title: data.vehicle?.plateNumber || "Транспорт",
      subtitle: data.driver?.name || undefined,
      longitude: livePos.lon,
      latitude: livePos.lat,
      speed: livePos.speed ?? undefined,
    }] : []),
  ];

  const eta = data.estimatedTime
    ? `${Math.floor(data.estimatedTime / 60)} ч ${data.estimatedTime % 60} мин`
    : null;

  const updatedAgo = livePos?.timestamp
    ? Math.round((Date.now() - new Date(livePos.timestamp).getTime()) / 60_000)
    : null;

  return (
    <main className="min-h-screen bg-fog">
      {/* Header */}
      <div className="bg-white border-b border-sand px-4 py-5 text-center shadow-sm">
        <p className="text-xs uppercase tracking-widest text-warmsilver">VELTO Logistics</p>
        <h1 className="mt-1 text-2xl font-bold text-plum">{data.name}</h1>
        <span className={`mt-2 inline-block rounded-full px-4 py-1 text-sm font-medium ${STATUS_COLOR[data.status] ?? "bg-gray-100 text-gray-700"}`}>
          {STATUS_LABEL[data.status] ?? data.status}
        </span>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 space-y-5">
        {/* Map */}
        <div className="rounded-3xl overflow-hidden shadow-md">
          <MapView
            fitToData
            className="h-[340px] w-full"
            points={mapPoints}
            lines={routeCoords.length > 1 ? [{
              id: "route",
              name: data.name,
              color: "#10b981",
              coordinates: routeCoords,
            }] : []}
          />
        </div>

        {/* Route info */}
        <div className="rounded-3xl bg-white p-6 shadow-sm space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Stat label="Откуда" value={data.startPoint ? `${data.startPoint.name}, ${data.startPoint.city}` : "—"} />
            <Stat label="Куда" value={data.endPoint ? `${data.endPoint.name}, ${data.endPoint.city}` : "—"} />
            <Stat label="Расстояние" value={data.distance ? `${data.distance.toFixed(0)} км` : "—"} />
            <Stat label="Расчётное время" value={eta ?? "—"} />
            {data.driver && <Stat label="Водитель" value={data.driver.name} />}
            {data.vehicle && <Stat label="Транспорт" value={`${data.vehicle.model} · ${data.vehicle.plateNumber}`} />}
          </div>
        </div>

        {/* Live position */}
        {livePos && (
          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <p className="text-xs uppercase tracking-widest text-warmsilver mb-3">Текущее местоположение</p>
            <div className="flex items-center gap-4">
              <div className="rounded-2xl bg-emerald-100 p-3">
                <span className="text-2xl">📍</span>
              </div>
              <div>
                <p className="font-semibold text-plum">
                  {livePos.lat.toFixed(5)}, {livePos.lon.toFixed(5)}
                </p>
                {typeof livePos.speed === "number" && (
                  <p className="text-sm text-olive">{Math.round(livePos.speed)} км/ч</p>
                )}
                <p className="text-xs text-warmsilver mt-0.5">
                  {updatedAgo !== null
                    ? updatedAgo === 0 ? "Только что" : `${updatedAgo} мин назад`
                    : new Date(livePos.timestamp).toLocaleTimeString("ru-RU")}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </div>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-warmsilver pb-4">
          Информация обновляется каждые 15 секунд · VELTO Logistics
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-warmsilver">{label}</p>
      <p className="mt-1 font-semibold text-plum">{value}</p>
    </div>
  );
}
