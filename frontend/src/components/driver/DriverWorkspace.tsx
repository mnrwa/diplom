"use client";

import MapView, { type MapLine, type MapPoint } from "@/components/map/MapView";
import type { DriverDetail, LiveNewsItem, LiveNewsResult, SessionUser } from "@/lib/api";
import { getAiWeather, getLiveNews, getRouteGeometry } from "@/lib/api";
import { useGpsEmitter } from "@/hooks/useGpsEmitter";
import { VoiceAlerts } from "@/components/driver/VoiceAlerts";
import { useQuery } from "@tanstack/react-query";

const AI_URL = process.env.NEXT_PUBLIC_AI_URL ?? "http://localhost:8000";

type NlpResult = { reformulated: string; risk_score: number; risk_level: string; model_used: string };

// Показывается когда реальный фид новостей пуст
const MOCK_NEWS_FEED = [
  {
    id: -1, severity: 0.75, source: "TELEGRAM" as const, channel: "@road_alerts_ru",
    title: "Сильный туман на М-4 «Дон», участок 320–380 км",
    summary: "Видимость снижена до 50–100 м. Рекомендуется снизить скорость до 50 км/ч, включить противотуманные фары. Возможны внезапные торможения колонн.",
    city: "Воронежская обл.", publishedAt: new Date(Date.now() - 35 * 60000).toISOString(),
  },
  {
    id: -2, severity: 0.88, source: "TELEGRAM" as const, channel: "@gibdd_moscow",
    title: "ДТП с участием грузовика на км 47 Ленинградского шоссе",
    summary: "Столкновение фуры и легкового автомобиля. Перекрыта правая полоса в сторону области. Пробка 9 км. Работают сотрудники ДПС и скорая помощь.",
    city: "Московская обл.", publishedAt: new Date(Date.now() - 12 * 60000).toISOString(),
  },
  {
    id: -3, severity: 0.52, source: "VK" as const, channel: "rosavtodor_official",
    title: "Ремонт М-7 «Волга» — сужение до одной полосы (км 180–210)",
    summary: "Плановые дорожные работы продлятся до 22:00. Реверсивное движение организовано через каждые 30 минут. Задержка в пути ориентировочно 25–40 минут.",
    city: "Нижегородская обл.", publishedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: -4, severity: 0.65, source: "TELEGRAM" as const, channel: "@mchs_novosibirsk",
    title: "Снегопад в Новосибирской области, гололедица",
    summary: "Интенсивный снегопад ожидается с 14:00 до 21:00. На трассе А-54 зафиксированы случаи заноса транспортных средств. Дорожная служба работает в усиленном режиме.",
    city: "Новосибирск", publishedAt: new Date(Date.now() - 55 * 60000).toISOString(),
  },
  {
    id: -5, severity: 0.42, source: "INTERNAL" as const, channel: "dispatch",
    title: "Изменение маршрута объезда МКАД (внешнее кольцо)",
    summary: "Диспетчер рекомендует использовать А-107 «Бетонку» как альтернативу перегруженному участку МКАД между Ярославским и Щёлковским шоссе. Экономия времени около 20 минут.",
    city: "Москва", publishedAt: new Date(Date.now() - 8 * 60000).toISOString(),
  },
  {
    id: -6, severity: 0.60, source: "TELEGRAM" as const, channel: "@ural_dorogi",
    title: "Гололедица на Уральском тракте Р-351, множественные ДТП",
    summary: "За последний час зарегистрировано 4 ДТП на участке Екатеринбург–Тюмень. Движение затруднено. Рекомендуется использовать цепи противоскольжения, скорость не более 50 км/ч.",
    city: "Свердловская обл.", publishedAt: new Date(Date.now() - 25 * 60000).toISOString(),
  },
];

async function fetchNlpAnalysis(items: { id: string; title: string; summary: string }[]) {
  if (!items.length) return {} as Record<string, NlpResult>;
  try {
    const r = await fetch(`${AI_URL}/ai/news-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items),
    });
    const data: Array<{ id: string } & NlpResult> = await r.json();
    return Object.fromEntries(data.map((d) => [d.id, d]));
  } catch {
    // fallback to keyword digest
    try {
      const r2 = await fetch(`${AI_URL}/ai/news-digest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items),
      });
      const data2: { id: string; digest: string }[] = await r2.json();
      return Object.fromEntries(
        data2.map((d) => [d.id, { reformulated: d.digest, risk_score: 0, risk_level: "low", model_used: "keywords" }])
      );
    } catch {
      return {} as Record<string, NlpResult>;
    }
  }
}
import { useOfflineGps } from "@/hooks/useOfflineGps";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ChatPanel } from "@/components/ChatPanel";
import {
  ArrowLeft,
  BadgeAlert,
  CheckCircle2,
  Clock3,
  Gauge,
  MapPin,
  Navigation,
  NavigationOff,
  Newspaper,
  PackageCheck,
  Route,
  Signal,
  Thermometer,
  Truck,
  UserRound,
  Warehouse,
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

  // Fetch OSRM route geometry via backend (avoids CORS / rate-limit issues with public OSRM)
  const [osrmGeometry, setOsrmGeometry] = useState<[number, number][] | null>(null);
  useEffect(() => {
    const route = driver.activeRoute;
    if (!route) { setOsrmGeometry(null); return; }

    let cancelled = false;
    getRouteGeometry(route.id)
      .then((coords) => {
        if (cancelled) return;
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

  const NEWS_TTL_MS = 48 * 60 * 60_000;
  const nowMs = Date.now();

  const visibleNews = driver.newsFeed.length > 0 ? driver.newsFeed : (MOCK_NEWS_FEED as any[]);

  const voiceAlerts = visibleNews
    .filter((n) => n.severity >= 0.5)
    .map((n) => `Внимание! ${n.title}. ${n.summary}`);

  const offlineGps = useOfflineGps(mode === "driver" ? (vehicleId ?? null) : null);

  const { data: nlpAnalysis = {} } = useQuery({
    queryKey: ["news-nlp", driver.id],
    queryFn: () => fetchNlpAnalysis(
      driver.newsFeed.map((n) => ({ id: String(n.id), title: n.title, summary: n.summary }))
    ),
    enabled: driver.newsFeed.length > 0,
    staleTime: 300_000,
  });

  // Live position → destination news, refreshed when GPS moves significantly
  const endPoint = driver.activeRoute?.endPoint;
  const liveGpsForQuery = mode === "driver" && gps.status === "active" && gps.position && endPoint
    ? gps.position
    : null;

  const { data: liveNewsResult } = useQuery<LiveNewsResult | null>({
    queryKey: [
      "live-news",
      driver.id,
      // Round to ~2km grid so query only refetches when driver moves meaningfully
      liveGpsForQuery ? Math.round(liveGpsForQuery.lat * 50) : 0,
      liveGpsForQuery ? Math.round(liveGpsForQuery.lon * 50) : 0,
    ],
    queryFn: () =>
      liveGpsForQuery && endPoint
        ? getLiveNews({
            current_lat: liveGpsForQuery.lat,
            current_lon: liveGpsForQuery.lon,
            end_lat: endPoint.lat,
            end_lon: endPoint.lon,
            end_name: endPoint.name,
            end_city: endPoint.city,
            max_items: 10,
          })
        : Promise.resolve(null),
    enabled: !!liveGpsForQuery && !!endPoint,
    staleTime: 4 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Weather at current GPS position — rounded to ~1km grid to avoid excessive refetches
  const weatherGridLat = livePosition ? Math.round(livePosition.lat * 100) / 100 : null;
  const weatherGridLon = livePosition ? Math.round(livePosition.lon * 100) / 100 : null;
  const { data: posWeather } = useQuery({
    queryKey: ["driver-weather", weatherGridLat, weatherGridLon],
    queryFn: () => getAiWeather(weatherGridLat!, weatherGridLon!),
    enabled: weatherGridLat != null && weatherGridLon != null,
    staleTime: 10 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  // Add news event markers (live items with geo, expire after 48h)
  if (liveNewsResult?.items) {
    for (const item of liveNewsResult.items) {
      if (item.lat == null || item.lon == null) continue;
      const publishedMs = item.published_at ? new Date(item.published_at).getTime() : nowMs;
      if (nowMs - publishedMs > NEWS_TTL_MS) continue;
      points.push({
        id: `news-evt-${item.id}`,
        kind: "event",
        title: item.reformulated
          ? item.reformulated.slice(0, 60) + (item.reformulated.length > 60 ? "…" : "")
          : item.title.slice(0, 60),
        subtitle: item.city ?? item.channel,
        longitude: item.lon,
        latitude: item.lat,
        expiresAt: new Date(publishedMs + NEWS_TTL_MS).toISOString(),
        riskLevel: item.risk_level,
      });
    }
  }

  // Map center: follow live GPS position; fall back to driver's initial position
  const mapCenter: [number, number] | undefined =
    livePosition ? [livePosition.lon, livePosition.lat] : undefined;

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

      {/* Route progress tracker */}
      {driver.activeRoute && (
        <RouteProgressPanel
          route={driver.activeRoute}
          livePosition={livePosition}
          mode={mode}
        />
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
              center={mapCenter}
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
                icon={<Thermometer className="h-4 w-4" />}
                label="Температура"
                value={
                  posWeather?.temperature != null
                    ? `${Math.round(posWeather.temperature)}°C${posWeather.description ? ` · ${posWeather.description}` : ""}`
                    : livePosition
                    ? "загрузка…"
                    : "нет GPS"
                }
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-warmsilver">Новости по пути</p>
            <h2 className="mt-3 text-2xl font-semibold text-plum">Telegram, VK, MAX и региональные источники</h2>
          </div>
          {liveNewsResult && (
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                Live · {liveNewsResult.segment}
              </span>
              <span className="text-xs text-warmsilver">{liveNewsResult.count} новостей по текущему отрезку</span>
            </div>
          )}
        </div>

        {/* Live news block — shown when GPS is active */}
        {liveNewsResult && liveNewsResult.items.length > 0 && (
          <div className="mt-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-700">
              С текущей позиции до назначения
            </p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {liveNewsResult.items.map((item) => (
                <LiveNewsCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* Static feed — always shown as baseline */}
        {visibleNews.length > 0 && (
          <div className={liveNewsResult ? "mt-8 border-t border-sand pt-6" : "mt-6"}>
            {liveNewsResult && (
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-warmsilver">
                Все новости по маршруту (база)
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleNews.map((item) => {
                const nlp = nlpAnalysis[String(item.id)];
                const riskScore = nlp ? nlp.risk_score : item.severity;
                const riskLevel = nlp?.risk_level ?? (item.severity >= 0.6 ? "high" : item.severity >= 0.35 ? "medium" : "low");
                const riskColor = riskLevel === "high" ? "text-rose-600" : riskLevel === "medium" ? "text-amber-600" : "text-emerald-600";
                return (
                  <article key={item.id} className="rounded-[20px] border border-sand bg-fog p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-olive">
                        <BadgeAlert className="h-3.5 w-3.5" />
                        {getNewsSourceLabel(item)}
                      </div>
                      <span className={`text-xs font-semibold ${riskColor}`}>
                        Риск {Math.round(riskScore * 100)}%
                      </span>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-plum">
                      {nlp?.reformulated || item.summary || item.title}
                    </p>
                    <div className="mt-4 flex items-center gap-2 text-xs text-warmsilver">
                      <Newspaper className="h-3.5 w-3.5" />
                      <span>{item.channel}</span>
                      <span>·</span>
                      <span>{new Date(item.publishedAt).toLocaleString("ru-RU")}</span>
                      {nlp && (
                        <>
                          <span>·</span>
                          <span className="rounded-full bg-white px-2 py-0.5 font-medium text-olive">
                            {"📝 Анализ"}
                          </span>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {!liveNewsResult && visibleNews.length === 0 && (
          <div className="mt-6">
            <EmptyMessage text="События по маршруту пока не сформированы." />
          </div>
        )}
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

function fmtEta(min: number) {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

type ActiveRoute = NonNullable<DriverDetail["activeRoute"]>;
type LivePos = { lat: number; lon: number; speed?: number | null; timestamp: string } | null;

function RouteProgressPanel({
  route,
  livePosition,
  mode,
}: {
  route: ActiveRoute;
  livePosition: LivePos;
  mode: "admin" | "driver";
}) {
  const isCompleted = route.status === "COMPLETED";
  const isActive = route.status === "ACTIVE";
  const isCancelled = route.status === "CANCELLED";

  let progress = 0;
  if (isCompleted) {
    progress = 1;
  } else if (livePosition && route.startPoint && route.endPoint) {
    const total = haversineKm(
      route.startPoint.lat, route.startPoint.lon,
      route.endPoint.lat, route.endPoint.lon,
    );
    const done = haversineKm(
      route.startPoint.lat, route.startPoint.lon,
      livePosition.lat, livePosition.lon,
    );
    progress = total > 0 ? Math.min(done / total, 1) : 0;
  }

  const STATUS_LABEL: Record<string, string> = {
    PLANNED: "Запланирован",
    ACTIVE: "В пути",
    COMPLETED: "Доставлено",
    CANCELLED: "Отменён",
    RECALCULATING: "Пересчёт",
  };
  const STATUS_STYLE: Record<string, string> = {
    PLANNED: "bg-amber-100 text-amber-800",
    ACTIVE: "bg-emerald-100 text-emerald-800",
    COMPLETED: "bg-green-100 text-green-800",
    CANCELLED: "bg-red-100 text-red-800",
    RECALCULATING: "bg-sky-100 text-sky-800",
  };

  return (
    <section className="mt-4 rounded-[28px] border border-sand bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-warmsilver">
            {mode === "admin" ? "Отслеживание" : "Мой маршрут"}
          </p>
          <h2 className="mt-2 text-xl font-semibold text-plum">{route.name}</h2>
        </div>
        <span className={`mt-1 inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLE[route.status] ?? "bg-gray-100 text-gray-700"}`}>
          {isActive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
          {STATUS_LABEL[route.status] ?? route.status}
        </span>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Timeline */}
        <ol>
          <TrackerStep
            done={isActive || isCompleted}
            active={false}
            icon={<Warehouse className="h-3.5 w-3.5" />}
            label="Отправление"
            detail={route.startPoint ? `${route.startPoint.name}, ${route.startPoint.city}` : "—"}
            last={false}
          />
          <TrackerStep
            done={isCompleted}
            active={isActive}
            icon={<Navigation className="h-3.5 w-3.5" />}
            label="В пути"
            detail={
              livePosition
                ? `${livePosition.lat.toFixed(4)}, ${livePosition.lon.toFixed(4)}${typeof livePosition.speed === "number" ? ` · ${Math.round(livePosition.speed)} км/ч` : ""}`
                : isCancelled ? "Отменён" : "Ожидание отправки"
            }
            last={false}
          />
          <TrackerStep
            done={isCompleted}
            active={false}
            icon={<PackageCheck className="h-3.5 w-3.5" />}
            label="Доставка"
            detail={route.endPoint ? `${route.endPoint.name}, ${route.endPoint.city}` : "—"}
            last
          />
        </ol>

        {/* Stats */}
        <div className="space-y-3">
          {!isCancelled && (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs text-warmsilver">
                <span>Прогресс маршрута</span>
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

          <div className="grid grid-cols-2 gap-2.5">
            <MiniStat icon={<Clock3 className="h-3.5 w-3.5 text-plum" />} label="ETA" value={route.estimatedTime ? fmtEta(route.estimatedTime) : "—"} />
            <MiniStat icon={<Gauge className="h-3.5 w-3.5 text-sky-500" />} label="Скорость" value={typeof livePosition?.speed === "number" ? `${Math.round(livePosition.speed)} км/ч` : "—"} />
            <MiniStat icon={<MapPin className="h-3.5 w-3.5 text-emerald-500" />} label="Расстояние" value={route.distance ? `${route.distance.toFixed(0)} км` : "—"} />
            <MiniStat icon={<Navigation className="h-3.5 w-3.5 text-amber-500" />} label="Риск" value={route.riskScore != null ? `${Math.round(route.riskScore * 100)}%` : "—"} />
          </div>
        </div>
      </div>
    </section>
  );
}

function TrackerStep({
  done,
  active,
  icon,
  label,
  detail,
  last,
}: {
  done: boolean;
  active: boolean;
  icon: ReactNode;
  label: string;
  detail: string;
  last: boolean;
}) {
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors
            ${done ? "border-emerald-500 bg-emerald-500 text-white" : active ? "border-plum bg-plum text-white" : "border-sand bg-fog text-warmsilver"}`}
        >
          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : active ? <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> : icon}
        </div>
        {!last && (
          <div className={`mt-1 w-0.5 flex-1 min-h-[20px] ${done || active ? "bg-emerald-200" : "bg-sand"}`} />
        )}
      </div>
      <div className="pb-4">
        <p className={`text-sm font-semibold ${active ? "text-plum" : done ? "text-emerald-700" : "text-olive"}`}>{label}</p>
        <p className="mt-0.5 text-xs text-warmsilver">{detail}</p>
      </div>
    </li>
  );
}

function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-sand bg-fog px-3 py-2.5">
      {icon}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-warmsilver">{label}</p>
        <p className="mt-0.5 text-sm font-bold text-plum">{value}</p>
      </div>
    </div>
  );
}

function LiveNewsCard({ item }: { item: LiveNewsItem }) {
  const riskColor =
    item.risk_level === "high"
      ? "text-rose-600"
      : item.risk_level === "medium"
      ? "text-amber-600"
      : "text-emerald-600";

  const riskBg =
    item.risk_level === "high"
      ? "bg-rose-50 border-rose-100"
      : item.risk_level === "medium"
      ? "bg-amber-50 border-amber-100"
      : "bg-fog border-sand";

  return (
    <article className={`rounded-[20px] border p-5 ${riskBg}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-olive">
          <BadgeAlert className="h-3.5 w-3.5" />
          {item.city || item.channel || "Региональные"}
        </div>
        <span className={`text-xs font-semibold ${riskColor}`}>
          Риск {Math.round(item.risk_score * 100)}%
        </span>
      </div>

      <p className="mt-4 text-sm leading-6 text-plum">
        {item.reformulated || item.summary || item.title}
      </p>

      {item.distance_km != null && (
        <p className="mt-2 text-xs text-warmsilver">
          ~{Math.round(item.distance_km)} км от вас
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-warmsilver">
        <Newspaper className="h-3.5 w-3.5" />
        <span>{item.channel}</span>
        {item.published_at && (
          <>
            <span>·</span>
            <span>{new Date(item.published_at).toLocaleString("ru-RU")}</span>
          </>
        )}
        <span>·</span>
        <span className="rounded-full bg-white px-2 py-0.5 font-medium text-olive">
          {"📝 Анализ"}
        </span>
      </div>
    </article>
  );
}
