"use client";

import MapView, { type MapLine, type MapPoint } from "@/components/map/MapView";
import type { DriverDetail, SessionUser } from "@/lib/api";
import { useGpsEmitter } from "@/hooks/useGpsEmitter";
import { VoiceAlerts } from "@/components/driver/VoiceAlerts";
import { useQuery } from "@tanstack/react-query";

const AI_URL = process.env.NEXT_PUBLIC_AI_URL ?? "http://localhost:8000";

async function fetchNewsDigests(items: { id: string; title: string; summary: string }[]) {
  if (!items.length) return {} as Record<string, string>;
  try {
    const r = await fetch(`${AI_URL}/ai/news-digest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    });
    const data: { id: string; digest: string }[] = await r.json();
    return Object.fromEntries(data.map((d) => [d.id, d.digest]));
  } catch {
    return {} as Record<string, string>;
  }
}
import { useOfflineGps } from "@/hooks/useOfflineGps";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ChatPanel } from "@/components/ChatPanel";
import {
  ArrowLeft,
  BadgeAlert,
  Clock3,
  Gauge,
  MapPin,
  Navigation,
  NavigationOff,
  Newspaper,
  Route,
  Signal,
  Truck,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

export default function DriverWorkspace({
  driver,
  mode,
  vehicleId,
  routeId,
  currentUser,
}: {
  driver: DriverDetail;
  mode: "admin" | "driver";
  vehicleId?: number | null;
  routeId?: number | null;
  currentUser?: SessionUser | null;
}) {
  const gps = useGpsEmitter(
    mode === "driver" ? vehicleId : null,
    mode === "driver" ? routeId : null,
  );

  // Admin mode: get real-time vehicle positions from WebSocket (mock simulator)
  const { positions: wsPositions } = useWebSocket();

  // Fetch OSRM route geometry when not stored in riskFactors
  const [osrmGeometry, setOsrmGeometry] = useState<[number, number][] | null>(null);
  useEffect(() => {
    const route = driver.activeRoute;
    if (!route) { setOsrmGeometry(null); return; }
    if (
      Array.isArray((route.riskFactors as any)?.routing?.geometry) &&
      (route.riskFactors as any).routing.geometry.length > 1
    ) {
      setOsrmGeometry(null);
      return;
    }
    const start = route.startPoint;
    const end = route.endPoint;
    if (!start || !end) return;
    let cancelled = false;
    fetch(
      `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?geometries=geojson&overview=full`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const coords: [number, number][] | undefined =
          data?.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length > 1) setOsrmGeometry(coords);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [driver.activeRoute?.id]);

  const lines: MapLine[] = [];
  const points: MapPoint[] = [];
  const routeCoordinates =
    osrmGeometry && osrmGeometry.length > 1
      ? osrmGeometry
      : driver.activeRoute
      ? buildLine(driver.activeRoute)
      : [];
  // Don't show backend track when driver has live GPS active — it would draw a
  // straight line from an old stored position to the real device position.
  const liveGpsActive = mode === "driver" && gps.status === "active";
  const trackCoordinates = liveGpsActive ? [] : buildTrackLine(driver.track);

  if (driver.activeRoute && routeCoordinates.length > 1) {
    lines.push({
      id: `route-${driver.activeRoute.id}`,
      name: driver.activeRoute.name,
      color: "#10b981",
      coordinates: routeCoordinates,
    });
  }

  if (trackCoordinates.length > 2) {
    lines.push({
      id: `track-${driver.id}`,
      name: "Фактический трек",
      color: "#435ee5",
      coordinates: trackCoordinates,
    });
  }

  if (driver.activeRoute?.startPoint) {
    points.push({
      id: `start-${driver.activeRoute.startPoint.id}`,
      kind: "warehouse",
      title: driver.activeRoute.startPoint.name,
      subtitle: `${driver.activeRoute.startPoint.city}, ${driver.activeRoute.startPoint.address}`,
      longitude: driver.activeRoute.startPoint.lon,
      latitude: driver.activeRoute.startPoint.lat,
    });
  }

  if (driver.activeRoute?.endPoint) {
    points.push({
      id: `end-${driver.activeRoute.endPoint.id}`,
      kind: "pickup",
      title: driver.activeRoute.endPoint.name,
      subtitle: `${driver.activeRoute.endPoint.city}, ${driver.activeRoute.endPoint.address}`,
      longitude: driver.activeRoute.endPoint.lon,
      latitude: driver.activeRoute.endPoint.lat,
    });
  }

  // Priority: real GPS from browser (driver mode) → WebSocket (admin mode) → DB snapshot
  const wsVehiclePos =
    mode === "admin" && driver.vehicle
      ? (wsPositions[driver.vehicle.id] ?? null)
      : null;

  const livePosition =
    mode === "driver" && gps.position
      ? {
          lat: gps.position.lat,
          lon: gps.position.lon,
          speed: gps.position.speed ?? null,
          timestamp: new Date(gps.position.timestamp).toISOString(),
        }
      : wsVehiclePos
      ? {
          lat: wsVehiclePos.lat,
          lon: wsVehiclePos.lon,
          speed: wsVehiclePos.speed ?? null,
          timestamp: wsVehiclePos.timestamp,
        }
      : driver.latestPosition;

  if (livePosition) {
    points.push({
      id: `driver-${driver.id}`,
      kind: mode === "admin" ? "vehicle" : "driver",
      title: mode === "admin"
        ? (driver.vehicle?.plateNumber || driver.name)
        : driver.name,
      subtitle: mode === "admin"
        ? driver.name
        : (driver.vehicle?.plateNumber || "Транспорт не назначен"),
      longitude: livePosition.lon,
      latitude: livePosition.lat,
      speed: livePosition.speed ?? undefined,
    });
  }

  const visibleNews = driver.newsFeed;

  const voiceAlerts = visibleNews
    .filter((n) => n.severity >= 0.5)
    .map((n) => `Внимание! ${n.title}. ${n.summary}`);

  const offlineGps = useOfflineGps(mode === "driver" ? (vehicleId ?? null) : null);

  const { data: newsDigests = {} } = useQuery({
    queryKey: ["news-digest", driver.id],
    queryFn: () => fetchNewsDigests(
      driver.newsFeed.map((n) => ({ id: String(n.id), title: n.title, summary: n.summary }))
    ),
    enabled: driver.newsFeed.length > 0,
    staleTime: 300_000,
  });

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-6">
      <section className="rounded-[28px] border border-sand bg-white px-6 py-6 md:px-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap gap-3">
              {mode === "admin" ? (
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-2xl bg-sand px-4 py-2 text-sm text-olive transition hover:bg-warmlight"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Назад в панель
                </Link>
              ) : null}
            </div>
            <p className="mt-4 text-xs uppercase tracking-[0.32em] text-warmsilver">
              {mode === "admin" ? "Карточка водителя" : "Кабинет водителя"}
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-plum md:text-4xl">
              {driver.name}
            </h1>
          </div>

          <div className="grid gap-3 rounded-[20px] border border-sand bg-fog p-5 text-sm text-olive md:grid-cols-2">
            <InfoItem label="Email" value={driver.email} />
            <InfoItem label="Телефон" value={driver.phone || "—"} />
            <InfoItem label="Транспорт" value={driver.vehicle?.plateNumber || "не назначен"} />
            <InfoItem label="Статус" value={driver.status} />
          </div>
        </div>
      </section>

      {/* GPS Control Panel — только для водителя */}
      {mode === "driver" && (
        <section className="mt-4 rounded-[28px] border border-sand bg-white p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className={`rounded-2xl p-3 ${gps.status === "active" ? "bg-pgreen text-white" : "bg-fog text-olive"}`}>
                {gps.status === "active" ? <Navigation className="h-5 w-5" /> : <NavigationOff className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-warmsilver">GPS-трекинг</p>
                <p className="mt-1 font-semibold text-plum">
                  {gps.status === "active" ? "Отправка активна" :
                   gps.status === "denied" ? "Доступ запрещён" :
                   gps.status === "error" ? "Ошибка GPS" : "Трекинг остановлен"}
                </p>
                {gps.position && (
                  <p className="mt-0.5 text-xs text-olive">
                    {gps.position.lat.toFixed(5)}, {gps.position.lon.toFixed(5)}
                    {gps.position.speed !== null ? ` · ${Math.round(gps.position.speed * 3.6)} км/ч` : ""}
                    {` · точность ${Math.round(gps.position.accuracy)} м`}
                  </p>
                )}
                {gps.error && (
                  <p className="mt-0.5 text-xs text-[#9e0a0a]">{gps.error}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs ${gps.connected ? "bg-pgreen/10 text-pgreen" : "bg-fog text-olive"}`}>
                {gps.connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {gps.connected ? "WebSocket подключён" : "Нет подключения"}
              </div>

              {gps.status !== "active" ? (
                <button
                  type="button"
                  onClick={gps.start}
                  disabled={!vehicleId}
                  className="inline-flex items-center gap-2 rounded-2xl bg-pinterest px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Signal className="h-4 w-4" />
                  Включить трекинг
                </button>
              ) : (
                <button
                  type="button"
                  onClick={gps.stop}
                  className="inline-flex items-center gap-2 rounded-2xl bg-sand px-5 py-3 text-sm font-semibold text-plum transition hover:bg-warmlight"
                >
                  <NavigationOff className="h-4 w-4" />
                  Остановить
                </button>
              )}
            </div>
          </div>

          {mode === "driver" && offlineGps.bufferSize > 0 && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm">
              <span className="text-amber-700">📡 Оффлайн-буфер: {offlineGps.bufferSize} точек</span>
              <button onClick={offlineGps.syncNow} className="text-amber-600 underline text-xs">Синхронизировать</button>
            </div>
          )}

          {mode === "driver" && voiceAlerts.length > 0 && (
            <div className="mt-4 flex items-center gap-3">
              <VoiceAlerts alerts={voiceAlerts} />
              <span className="text-xs text-amber-600">{voiceAlerts.length} предупреждений по маршруту</span>
            </div>
          )}

          {!vehicleId && (
            <p className="mt-3 text-xs text-amber-700">
              ⚠ Транспорт не назначен — GPS не может быть отправлен диспетчеру. Обратитесь к диспетчеру для привязки ТС.
            </p>
          )}
        </section>
      )}

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
        <article className="rounded-[28px] border border-sand bg-white p-6">
          <p className="text-xs uppercase tracking-[0.32em] text-warmsilver">Карта маршрута</p>
          <h2 className="mt-3 text-2xl font-semibold text-plum">
            {mode === "admin"
              ? wsVehiclePos
                ? "Позиция · Live GPS"
                : "Позиция · Имитация движения"
              : gps.status === "active"
              ? "Положение (Live GPS)"
              : "Положение"}
          </h2>
          {mode === "driver" && gps.status === "active" && (
            <div className="mt-3 rounded-2xl border border-pgreen/20 bg-pgreen/5 px-4 py-3 text-sm text-pgreen">
              Ваши реальные GPS-координаты отправляются диспетчеру в реальном времени.
            </div>
          )}
          {mode === "admin" && (
            <div className="mt-3 rounded-2xl border border-pgreen/20 bg-pgreen/5 px-4 py-3 text-sm text-pgreen">
              {wsVehiclePos
                ? `Live GPS · ${wsVehiclePos.lat.toFixed(4)}, ${wsVehiclePos.lon.toFixed(4)}`
                : "Имитация движения · обновляется каждые 4 сек"}
            </div>
          )}
          <div className="mt-6">
            <MapView
              lines={lines}
              points={points}
              className="h-[620px] w-full rounded-[20px]"
            />
          </div>
        </article>

        <div className="grid gap-4">
          <Panel title="Параметры" kicker="Профиль">
            <div className="mb-4 rounded-2xl border border-pgreen/20 bg-pgreen/5 px-4 py-4 text-sm text-pgreen">
              {livePosition
                ? mode === "driver" && gps.status === "active"
                  ? `Live GPS · точность ${Math.round(gps.position?.accuracy ?? 0)} м`
                  : wsVehiclePos
                  ? `WebSocket · ${formatPositionUpdatedAt(wsVehiclePos.timestamp)}`
                  : `Последнее GPS: ${formatPositionUpdatedAt(livePosition.timestamp)}`
                : "GPS пока не пришло"}
            </div>
            <div className="grid gap-3">
              <Parameter icon={<UserRound className="h-4 w-4" />} label="Опыт" value={`${driver.experienceYears} лет`} />
              <Parameter icon={<Truck className="h-4 w-4" />} label="Категория" value={driver.licenseCategory} />
              <Parameter icon={<Route className="h-4 w-4" />} label="Рейтинг" value={driver.rating.toFixed(1)} />
              <Parameter
                icon={<MapPin className="h-4 w-4" />}
                label="Координаты"
                value={livePosition
                  ? `${livePosition.lat.toFixed(5)}, ${livePosition.lon.toFixed(5)}`
                  : "нет GPS"}
              />
              <Parameter
                icon={<Gauge className="h-4 w-4" />}
                label="Скорость"
                value={typeof livePosition?.speed === "number"
                  ? `${Math.round(livePosition.speed)} км/ч`
                  : "нет данных"}
              />
              <Parameter
                icon={<Clock3 className="h-4 w-4" />}
                label="Обновление"
                value={livePosition?.timestamp
                  ? new Date(livePosition.timestamp).toLocaleString("ru-RU")
                  : "ожидаем сигнал GPS"}
              />
            </div>
          </Panel>

          <Panel title="Маршрут" kicker="Текущий рейс">
            {driver.activeRoute ? (
              (() => {
                const routeMeta = getRouteRoutingMeta(driver.activeRoute);
                return (
                  <div className="rounded-2xl border border-sand bg-white p-4">
                    <strong className="block text-plum">{driver.activeRoute.name}</strong>
                    <span className="mt-2 block text-sm text-olive">
                      {driver.activeRoute.startPoint?.name || "Старт"} → {driver.activeRoute.endPoint?.name || "Финиш"}
                    </span>
                    <div className="mt-4 grid gap-2 text-sm text-olive">
                      <span>ETA: {driver.activeRoute.estimatedTime ? `${driver.activeRoute.estimatedTime} мин` : "—"}</span>
                      <span>Риск: {Math.round((driver.activeRoute.riskScore || 0) * 100)}%</span>
                      {driver.activeRoute.distance ? (
                        <span>Расстояние: {driver.activeRoute.distance.toFixed(1)} км</span>
                      ) : null}
                      {routeMeta ? (
                        <>
                          <span>{routeMeta.isRoadNetwork ? "По дорожной сети (OSRM)" : "По упрощённой схеме"}</span>
                          {routeMeta.selectionStrategy ? <span>{routeMeta.selectionStrategy}</span> : null}
                          <span>Средняя скорость: {routeMeta.avgSpeedKmh ?? "—"} км/ч · событий: {routeMeta.eventCount}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })()
            ) : (
              <EmptyMessage text="Нет активного маршрута." />
            )}
          </Panel>
        </div>
      </section>

      {/* Chat */}
      <section className="mt-4 rounded-[28px] border border-sand bg-white p-6">
        <p className="text-xs uppercase tracking-[0.32em] text-warmsilver">Связь</p>
        <h2 className="mt-3 mb-4 text-2xl font-semibold text-plum">
          {mode === "admin" ? `Чат с водителем — ${driver.name}` : "Чат с диспетчером"}
        </h2>
        {mode === "admin" && currentUser ? (
          <ChatPanel
            senderId={currentUser.id}
            senderName={currentUser.name}
            role="DISPATCHER"
            targetDriverId={driver.id}
            routeId={driver.activeRoute?.id ?? null}
          />
        ) : mode === "driver" ? (
          <ChatPanel
            senderId={driver.id}
            senderName={driver.name}
            role="DRIVER"
            targetDriverId={driver.id}
            routeId={driver.activeRoute?.id ?? null}
          />
        ) : null}
      </section>

      <section className="mt-4 rounded-[28px] border border-sand bg-white p-6">
        <p className="text-xs uppercase tracking-[0.32em] text-warmsilver">Новости по пути</p>
        <h2 className="mt-3 text-2xl font-semibold text-plum">Telegram, VK, MAX и региональные источники</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleNews.length ? (
            visibleNews.map((item) => (
              <article key={item.id} className="rounded-[20px] border border-sand bg-fog p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-olive">
                    <BadgeAlert className="h-3.5 w-3.5" />
                    {getNewsSourceLabel(item)}
                  </div>
                  <span className="text-xs font-semibold text-[#9e0a0a]">
                    Риск {Math.round(item.severity * 100)}%
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-plum">
                  {newsDigests[item.id] || item.summary || item.title}
                </p>
                <div className="mt-4 flex items-center gap-2 text-xs text-warmsilver">
                  <Newspaper className="h-3.5 w-3.5" />
                  <span>{item.channel}</span>
                  <span>·</span>
                  <span>{new Date(item.publishedAt).toLocaleString("ru-RU")}</span>
                </div>
              </article>
            ))
          ) : (
            <EmptyMessage text="События по маршруту пока не сформированы." />
          )}
        </div>
      </section>
    </main>
  );
}

function Panel({ title, kicker, children }: { title: string; kicker: string; children: ReactNode }) {
  return (
    <article className="rounded-[28px] border border-sand bg-white p-6">
      <p className="text-xs uppercase tracking-[0.32em] text-warmsilver">{kicker}</p>
      <h2 className="mt-3 text-2xl font-semibold text-plum">{title}</h2>
      <div className="mt-6">{children}</div>
    </article>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs uppercase tracking-[0.24em] text-warmsilver">{label}</span>
      <strong className="mt-2 block text-base text-plum">{value}</strong>
    </div>
  );
}

function Parameter({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-sand bg-fog px-4 py-4">
      <div className="rounded-2xl bg-pinterest p-2.5 text-white">{icon}</div>
      <div>
        <span className="block text-xs uppercase tracking-[0.24em] text-warmsilver">{label}</span>
        <strong className="mt-1 block text-plum">{value}</strong>
      </div>
    </div>
  );
}

function EmptyMessage({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-sand bg-fog px-4 py-5 text-sm text-olive">{text}</div>
  );
}

function buildLine(route: DriverDetail["activeRoute"]) {
  if (!route) return [];
  if (Array.isArray(route.riskFactors?.routing?.geometry) && route.riskFactors.routing.geometry.length > 1) {
    return route.riskFactors.routing.geometry
      .filter((item: any) => item?.lon != null && item?.lat != null)
      .map((item: any) => [item.lon, item.lat] as [number, number]);
  }
  const coordinates: [number, number][] = [];
  if (route.startLat != null && route.startLon != null) coordinates.push([route.startLon, route.startLat]);
  if (Array.isArray(route.waypoints)) {
    route.waypoints.forEach((item) => {
      if (item?.lon != null && item?.lat != null) coordinates.push([item.lon, item.lat]);
    });
  }
  if (route.endLat != null && route.endLon != null) coordinates.push([route.endLon, route.endLat]);
  return coordinates;
}

function buildTrackLine(track: DriverDetail["track"]) {
  if (!Array.isArray(track)) return [];

  const coordinates: [number, number][] = [];

  track.forEach((point) => {
    if (point?.lon == null || point?.lat == null) return;

    const nextPoint: [number, number] = [point.lon, point.lat];
    const previousPoint = coordinates[coordinates.length - 1];

    if (
      previousPoint &&
      previousPoint[0] === nextPoint[0] &&
      previousPoint[1] === nextPoint[1]
    ) {
      return;
    }

    coordinates.push(nextPoint);
  });

  return coordinates;
}

function getRouteRoutingMeta(route: DriverDetail["activeRoute"]) {
  const routing = route?.riskFactors?.routing;
  if (!routing) return null;
  const roadEvents = Array.isArray(routing.road_events) ? routing.road_events : [];
  return {
    isRoadNetwork: routing.source === "osrm",
    sourceLabel: routing.source === "osrm" ? "OSRM" : "Fallback",
    selectionStrategy:
      routing.selection_strategy === "shortest_road_path"
        ? "Кратчайший путь по дорожной сети"
        : routing.selection_strategy === "fallback_direct_path"
          ? "Резервная схема"
          : null,
    avgSpeedKmh: typeof routing.avg_speed_kmh === "number" ? Math.round(routing.avg_speed_kmh) : null,
    eventCount: roadEvents.length,
  };
}

function getNewsSourceLabel(item: DriverDetail["newsFeed"][number]) {
  switch (item.source) {
    case "TELEGRAM":
      return "Telegram";
    case "VK":
      return "VK";
    case "MAX":
      return "MAX";
    default:
      return "Региональные новости";
  }
}

function formatPositionUpdatedAt(timestamp: string) {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (diffMs < 60_000) return "меньше минуты назад";
  return `${Math.round(diffMs / 60_000)} мин назад`;
}
