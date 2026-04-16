"use client";

import MapView, { type MapLine, type MapPoint } from "@/components/map/MapView";
import type { DriverDetail } from "@/lib/api";
import {
  ArrowLeft,
  Clock3,
  Gauge,
  MapPin,
  Newspaper,
  Route,
  Truck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export default function DriverWorkspace({
  driver,
  mode,
}: {
  driver: DriverDetail;
  mode: "admin" | "driver";
}) {
  const lines: MapLine[] = [];
  const points: MapPoint[] = [];

  if (driver.activeRoute) {
    const routeCoordinates = buildLine(driver.activeRoute);
    if (routeCoordinates.length > 1) {
      lines.push({
        id: `route-${driver.activeRoute.id}`,
        name: driver.activeRoute.name,
        color: "#0f766e",
        coordinates: routeCoordinates,
      });
    }
  }

  if (driver.track?.length > 1) {
    lines.push({
      id: `track-${driver.id}`,
      name: "Фактический трек",
      color: "#2563eb",
      coordinates: driver.track.map((point) => [point.lon, point.lat]),
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

  if (driver.latestPosition) {
    points.push({
      id: `driver-${driver.id}`,
      kind: "driver",
      title: driver.name,
      subtitle: driver.vehicle?.plateNumber || "Транспорт не назначен",
      longitude: driver.latestPosition.lon,
      latitude: driver.latestPosition.lat,
      speed: driver.latestPosition.speed,
    });
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-6">
      <section className="rounded-[36px] border border-white/70 bg-white/92 px-6 py-6 shadow-[0_30px_90px_rgba(148,163,184,0.18)] md:px-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap gap-3">
              {mode === "admin" ? (
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Назад в админку
                </Link>
              ) : null}
            </div>
            <p className="mt-4 text-xs uppercase tracking-[0.32em] text-slate-400">
              {mode === "admin" ? "Карточка водителя" : "Кабинет водителя"}
            </p>
            <h1 className="mt-3 font-[Georgia] text-3xl text-slate-900 md:text-4xl">
              {driver.name}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">
              Здесь отображаются параметры водителя, текущий маршрут, его живая
              геопозиция, трек движения и лента новостей по направлению
              следования.
            </p>
          </div>

          <div className="grid gap-3 rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5 text-sm text-slate-600 md:grid-cols-2">
            <InfoItem label="Email" value={driver.email} />
            <InfoItem label="Телефон" value={driver.phone || "—"} />
            <InfoItem
              label="Транспорт"
              value={driver.vehicle?.plateNumber || "не назначен"}
            />
            <InfoItem label="Статус" value={driver.status} />
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
        <article className="rounded-[34px] border border-white/70 bg-white/95 p-6 shadow-[0_30px_90px_rgba(148,163,184,0.18)]">
          <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
            Карта маршрута
          </p>
          <h2 className="mt-3 font-[Georgia] text-2xl text-slate-900">
            Положение водителя и линия движения
          </h2>
          <div className="mt-3 rounded-[22px] border border-emerald-200/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700">
            Моковое GPS обновляется каждые 10 секунд. Текущая точка водителя
            сразу отображается на карте и в карточках справа.
          </div>
          <div className="mt-6">
            <MapView
              lines={lines}
              points={points}
              className="h-[620px] w-full rounded-[28px]"
            />
          </div>
        </article>

        <div className="grid gap-4">
          <Panel title="Параметры" kicker="Профиль">
            <div className="mb-4 rounded-[24px] border border-emerald-200/80 bg-emerald-50/80 px-4 py-4 text-sm text-emerald-700">
              {driver.latestPosition
                ? `Последнее GPS-обновление: ${formatPositionUpdatedAt(
                    driver.latestPosition.timestamp,
                  )}.`
                : "GPS пока не пришло: как только моковая точка будет отправлена, она появится здесь."}
            </div>
            <div className="grid gap-3">
              <Parameter
                icon={<UserRound className="h-4 w-4" />}
                label="Опыт"
                value={`${driver.experienceYears} лет`}
              />
              <Parameter
                icon={<Truck className="h-4 w-4" />}
                label="Категория"
                value={driver.licenseCategory}
              />
              <Parameter
                icon={<Route className="h-4 w-4" />}
                label="Рейтинг"
                value={driver.rating.toFixed(1)}
              />
              <Parameter
                icon={<MapPin className="h-4 w-4" />}
                label="Координаты"
                value={
                  driver.latestPosition
                    ? `${driver.latestPosition.lat.toFixed(4)}, ${driver.latestPosition.lon.toFixed(4)}`
                    : "нет GPS"
                }
              />
              <Parameter
                icon={<Gauge className="h-4 w-4" />}
                label="Скорость"
                value={
                  typeof driver.latestPosition?.speed === "number"
                    ? `${Math.round(driver.latestPosition.speed)} км/ч`
                    : "нет данных"
                }
              />
              <Parameter
                icon={<Clock3 className="h-4 w-4" />}
                label="Обновление"
                value={
                  driver.latestPosition?.timestamp
                    ? new Date(driver.latestPosition.timestamp).toLocaleString(
                        "ru-RU",
                      )
                    : "ожидаем сигнал GPS"
                }
              />
            </div>
          </Panel>

          <Panel title="Маршрут" kicker="Текущий рейс">
            {driver.activeRoute ? (
              (() => {
                const routeMeta = getRouteRoutingMeta(driver.activeRoute);

                return (
                  <div className="rounded-[24px] border border-slate-200/80 bg-white p-4">
                    <strong className="block text-slate-900">
                      {driver.activeRoute.name}
                    </strong>
                    <span className="mt-2 block text-sm text-slate-500">
                      {driver.activeRoute.startPoint?.name || "Старт"} →{" "}
                      {driver.activeRoute.endPoint?.name || "Финиш"}
                    </span>
                    <div className="mt-4 grid gap-3 text-sm text-slate-600">
                      <span>
                        ETA:{" "}
                        {driver.activeRoute.estimatedTime
                          ? `${driver.activeRoute.estimatedTime} мин`
                          : "—"}
                      </span>
                      <span>
                        Risk:{" "}
                        {Math.round((driver.activeRoute.riskScore || 0) * 100)}%
                      </span>
                      {routeMeta ? (
                        <>
                          <span>
                            {routeMeta.isRoadNetwork
                              ? "Маршрут подобран по дорожной сети"
                              : "Маршрут подобран по упрощённой схеме"}{" "}
                            ({routeMeta.sourceLabel})
                          </span>
                          <span>
                            Выбран дорожный вариант:{" "}
                            {typeof driver.activeRoute.distance === "number"
                              ? driver.activeRoute.distance.toFixed(1)
                              : "—"}{" "}
                            км,{" "}
                            {driver.activeRoute.estimatedTime
                              ? driver.activeRoute.estimatedTime
                              : "—"}{" "}
                            мин. Учтены дорожные события:{" "}
                            {routeMeta.roadEventsSummary}.
                          </span>
                          <span>
                            Средняя скорость {routeMeta.avgSpeedKmh ?? "—"} км/ч
                            · событий по пути {routeMeta.eventCount}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })()
            ) : (
              <EmptyMessage text="У водителя пока нет активного маршрута." />
            )}
          </Panel>
        </div>
      </section>

      <section className="mt-4 rounded-[34px] border border-white/70 bg-white/95 p-6 shadow-[0_30px_90px_rgba(148,163,184,0.18)]">
        <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
          Новости по пути
        </p>
        <h2 className="mt-3 font-[Georgia] text-2xl text-slate-900">
          Telegram, VK и MAX сигналы
        </h2>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {driver.newsFeed.length ? (
            driver.newsFeed.map((item) => (
              <article
                key={item.id}
                className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5"
              >
                {item.source !== "INTERNAL" ? (
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs uppercase tracking-[0.22em] text-slate-500">
                    <Newspaper className="h-3.5 w-3.5" />
                    {item.source}
                  </div>
                ) : null}
                <p className="text-sm leading-7 text-slate-700">
                  {item.summary || item.title}
                </p>
                <div className="mt-4 grid gap-2 text-xs text-slate-500">
                  <span>{item.channel}</span>
                  <span>
                    {new Date(item.publishedAt).toLocaleString("ru-RU")}
                  </span>
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

function Panel({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-[34px] border border-white/70 bg-white/95 p-6 shadow-[0_30px_90px_rgba(148,163,184,0.18)]">
      <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
        {kicker}
      </p>
      <h2 className="mt-3 font-[Georgia] text-2xl text-slate-900">{title}</h2>
      <div className="mt-6">{children}</div>
    </article>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs uppercase tracking-[0.24em] text-slate-400">
        {label}
      </span>
      <strong className="mt-2 block text-base text-slate-900">{value}</strong>
    </div>
  );
}

function Parameter({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[24px] border border-slate-200/80 bg-slate-50/80 px-4 py-4">
      <div className="rounded-2xl bg-slate-900 p-2.5 text-white">{icon}</div>
      <div>
        <span className="block text-xs uppercase tracking-[0.24em] text-slate-400">
          {label}
        </span>
        <strong className="mt-1 block text-slate-900">{value}</strong>
      </div>
    </div>
  );
}

function EmptyMessage({ text }: { text: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 px-4 py-5 text-sm text-slate-500">
      {text}
    </div>
  );
}

function buildLine(route: DriverDetail["activeRoute"]) {
  if (!route) return [];

  const coordinates: [number, number][] = [];

  if (route.startLat != null && route.startLon != null) {
    coordinates.push([route.startLon, route.startLat]);
  }

  if (Array.isArray(route.waypoints)) {
    route.waypoints.forEach((item) => {
      if (item?.lon != null && item?.lat != null) {
        coordinates.push([item.lon, item.lat]);
      }
    });
  }

  if (route.endLat != null && route.endLon != null) {
    coordinates.push([route.endLon, route.endLat]);
  }

  return coordinates;
}

function getRouteRoutingMeta(route: DriverDetail["activeRoute"]) {
  const routing = route?.riskFactors?.routing;
  if (!routing) return null;

  const roadEvents = Array.isArray(routing.road_events) ? routing.road_events : [];
  const roadEventTitles = roadEvents
    .map((event: any) =>
      typeof event?.title === "string" ? event.title.trim() : "",
    )
    .filter(Boolean)
    .slice(0, 5);

  const roadEventsSummary = roadEventTitles.length
    ? roadEventTitles.join(", ")
    : "критичных дорожных событий по трассе не найдено";

  return {
    isRoadNetwork: routing.source === "osrm",
    sourceLabel:
      routing.source === "osrm" ? "OSRM / дорожная сеть" : "Fallback / demo",
    avgSpeedKmh:
      typeof routing.avg_speed_kmh === "number"
        ? Math.round(routing.avg_speed_kmh)
        : null,
    eventCount: roadEvents.length,
    roadEventsSummary,
  };
}

function formatPositionUpdatedAt(timestamp: string) {
  const diffMs = Date.now() - new Date(timestamp).getTime();

  if (diffMs < 60_000) {
    return "меньше минуты назад";
  }

  const diffMinutes = Math.round(diffMs / 60_000);
  return `${diffMinutes} мин назад`;
}
