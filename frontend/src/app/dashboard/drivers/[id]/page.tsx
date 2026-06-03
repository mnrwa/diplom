"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  MessageSquare,
  MapPin,
  Zap,
  Star,
  Briefcase,
  CreditCard,
  Activity,
  Copy,
  Check,
  AlertTriangle,
  Navigation,
  Clock,
  Fuel,
  Radio,
  Gauge,
} from "lucide-react";

import {
  getDriver,
  getDriverTelematics,
  type DriverDetail,
  type TelematicsResult,
} from "@/lib/api";
import { getStoredUser } from "@/lib/session";
import type { SessionUser } from "@/lib/api";
import MapView from "@/components/map/MapView";
import { ChatPanel } from "@/components/ChatPanel";
import type { MapLine, MapPoint } from "@/components/map/MapView";

// ─── helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function statusMeta(status: DriverDetail["status"]) {
  if (status === "ON_SHIFT")
    return { label: "На смене", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  if (status === "RESTING")
    return { label: "Отдыхает", cls: "bg-amber-100 text-amber-700 border-amber-200" };
  return { label: "Офлайн", cls: "bg-[#E8E2D8] text-[#948C84] border-[#E8E2D8]" };
}

function routeStatusMeta(status: string) {
  const map: Record<string, { label: string; cls: string }> = {
    ACTIVE: { label: "Активен", cls: "bg-emerald-100 text-emerald-700" },
    PLANNED: { label: "Запланирован", cls: "bg-blue-100 text-blue-700" },
    COMPLETED: { label: "Завершён", cls: "bg-[#E8E2D8] text-[#948C84]" },
    CANCELLED: { label: "Отменён", cls: "bg-rose-100 text-rose-700" },
    RECALCULATING: { label: "Пересчёт", cls: "bg-amber-100 text-amber-700" },
  };
  return map[status] ?? { label: status, cls: "bg-[#E8E2D8] text-[#948C84]" };
}

function riskColor(score: number) {
  if (score < 0.3) return "bg-emerald-500";
  if (score < 0.6) return "bg-amber-500";
  return "bg-rose-500";
}

function riskLabel(score: number) {
  if (score < 0.3) return "text-emerald-700";
  if (score < 0.6) return "text-amber-700";
  return "text-rose-700";
}

function formatEta(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  return `${h} ч ${m > 0 ? `${m} мин` : ""}`.trim();
}

function minutesAgo(ts: string) {
  return Math.round((Date.now() - new Date(ts).getTime()) / 60_000);
}

function gpsColorCls(mins: number) {
  if (mins < 5) return "text-emerald-600";
  if (mins < 30) return "text-amber-600";
  return "text-[#948C84]";
}

function gpsDotCls(mins: number) {
  if (mins < 5) return "bg-emerald-500 animate-pulse";
  if (mins < 30) return "bg-amber-500";
  return "bg-[#948C84]";
}

function severityDot(severity: number) {
  if (severity >= 8) return "bg-rose-500";
  if (severity >= 5) return "bg-amber-500";
  return "bg-emerald-500";
}

// ─── skeleton ────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-xl bg-[#E8E2D8] ${className ?? ""}`} />
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      {/* top bar */}
      <div className="sticky top-0 z-30 border-b border-[#E8E2D8] bg-white px-6 py-3 flex items-center gap-4">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-5 w-48 ml-4" />
      </div>
      {/* hero */}
      <div className="bg-[#F2EEE8] px-8 py-10">
        <div className="mx-auto max-w-7xl flex gap-6 items-center">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="ml-auto flex gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-28 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
      {/* body */}
      <div className="mx-auto max-w-7xl px-6 py-8 grid grid-cols-3 gap-6">
        <div className="col-span-2 flex flex-col gap-6">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
        <div className="flex flex-col gap-6">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function DriverAdminPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [ready, setReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }
    if (user.role === "DRIVER") { router.replace("/lk"); return; }
    setCurrentUser(user);
    setReady(true);
  }, [router]);

  const driverId = Number(params?.id);

  const { data, isLoading, error } = useQuery({
    queryKey: ["driver", driverId],
    queryFn: () => getDriver(driverId),
    enabled: ready && Number.isFinite(driverId) && driverId > 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const { data: telematics } = useQuery({
    queryKey: ["driver-telematics", driverId],
    queryFn: () => getDriverTelematics(driverId),
    enabled: ready && Number.isFinite(driverId) && driverId > 0,
    refetchInterval: 30_000,
  });

  if (!ready || isLoading) return <LoadingSkeleton />;

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
        <div className="rounded-2xl border border-[#E8E2D8] bg-white shadow-sm p-10 text-center max-w-sm">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-rose-400" />
          <p className="text-lg font-semibold text-[#1A1916] mb-1">Водитель не найден</p>
          <p className="text-sm text-[#948C84] mb-6">Профиль недоступен или был удалён</p>
          <button
            onClick={() => router.back()}
            className="rounded-xl bg-[#F2EEE8] px-5 py-2 text-sm font-medium text-[#3A3730] hover:bg-[#E8E2D8] transition"
          >
            ← Назад
          </button>
        </div>
      </div>
    );
  }

  // ── map data ─────────────────────────────────────────────────────────────

  const pos = data.latestPosition;
  const route = data.activeRoute;

  const mapPoints: MapPoint[] = [];
  if (pos) {
    mapPoints.push({
      id: `driver-${data.id}`,
      entityId: data.id,
      kind: "driver",
      title: data.name,
      subtitle: pos.speed != null ? `${Math.round(pos.speed)} км/ч` : undefined,
      longitude: pos.lon,
      latitude: pos.lat,
      speed: pos.speed,
    });
  }
  if (route) {
    mapPoints.push({
      id: "route-start",
      kind: "warehouse",
      title: route.startPoint?.name ?? "Отправление",
      longitude: route.startLon,
      latitude: route.startLat,
    });
    mapPoints.push({
      id: "route-end",
      kind: "pickup",
      title: route.endPoint?.name ?? "Назначение",
      longitude: route.endLon,
      latitude: route.endLat,
    });
  }

  const mapLines: MapLine[] = [];
  if (route) {
    // prefer OSRM geometry from riskFactors, else straight line
    const geo = route.riskFactors?.["geometry"] as [number, number][] | undefined;
    const coords: [number, number][] = geo && geo.length > 1
      ? geo
      : [[route.startLon, route.startLat], [route.endLon, route.endLat]];
    mapLines.push({ id: "active-route", name: route.name, color: "#059669", coordinates: coords });
  }

  const mapCenter: [number, number] | undefined =
    pos ? [pos.lon, pos.lat] : route ? [route.startLon, route.startLat] : undefined;

  // ── GPS freshness ─────────────────────────────────────────────────────────
  const gpsAgo = pos ? minutesAgo(pos.timestamp) : null;

  // ── status ────────────────────────────────────────────────────────────────
  const sm = statusMeta(data.status);
  const isLive = gpsAgo != null && gpsAgo < 5;

  // ── tracking link copy ────────────────────────────────────────────────────
  const trackingUrl = route?.trackingToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/track/${route.trackingToken}`
    : null;

  const handleCopy = () => {
    if (!trackingUrl) return;
    navigator.clipboard.writeText(trackingUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── risk score ────────────────────────────────────────────────────────────
  const risk = route?.riskScore ?? null;

  return (
    <div className="min-h-screen bg-[#FAF9F6]">

      {/* ── sticky top bar ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-[#E8E2D8] bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <button
            onClick={() => router.push("/dashboard/drivers")}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-[#3A3730] hover:bg-[#F2EEE8] transition"
          >
            <ArrowLeft className="h-4 w-4" />
            Водители
          </button>

          <div className="h-4 w-px bg-[#E8E2D8]" />

          <span className="text-base font-semibold text-[#1A1916]">{data.name}</span>
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${sm.cls}`}>
            {sm.label}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              disabled
              className="flex items-center gap-1.5 rounded-xl border border-[#E8E2D8] bg-white px-4 py-2 text-sm font-medium text-[#948C84] cursor-not-allowed opacity-60"
            >
              <Download className="h-4 w-4" />
              Экспорт PDF
            </button>
            <button
              onClick={() => {
                const el = document.getElementById("chat-section");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition"
            >
              <MessageSquare className="h-4 w-4" />
              Открыть чат
            </button>
          </div>
        </div>
      </div>

      {/* ── profile hero ───────────────────────────────────────────────────── */}
      <div className="bg-[#F2EEE8] px-8 py-10">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-center gap-6">
            {/* avatar */}
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-2xl font-bold select-none">
              {initials(data.name)}
            </div>

            {/* name + meta */}
            <div>
              <h1 className="text-2xl font-bold text-[#1A1916]">{data.name}</h1>
              <p className="mt-0.5 text-sm text-[#948C84]">
                {data.licenseCategory} · {data.email}
              </p>
            </div>

            {/* status badge */}
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${sm.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${data.status === "ON_SHIFT" ? "bg-emerald-500" : data.status === "RESTING" ? "bg-amber-500" : "bg-[#948C84]"}`} />
              {sm.label}
            </span>

            {/* stat cards */}
            <div className="ml-auto flex flex-wrap gap-3">
              <StatCard icon={<Star className="h-4 w-4 text-amber-500" />} label="Рейтинг" value={data.rating.toFixed(1)} />
              <StatCard icon={<Briefcase className="h-4 w-4 text-[#948C84]" />} label="Опыт" value={`${data.experienceYears} лет`} />
              <StatCard icon={<CreditCard className="h-4 w-4 text-[#948C84]" />} label="Категория ВУ" value={data.licenseCategory} />
              <StatCard
                icon={<Activity className="h-4 w-4 text-emerald-600" />}
                label="Телематика"
                value={data.telematicsScore != null ? `${Math.round(data.telematicsScore)}/100` : "—"}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── main content ───────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid grid-cols-3 gap-6">

          {/* ── LEFT column (2/3) ──────────────────────────────────────────── */}
          <div className="col-span-2 flex flex-col gap-6">

            {/* live map card */}
            <div className="rounded-2xl border border-[#E8E2D8] bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-[#E8E2D8]">
                <MapPin className="h-4 w-4 text-[#948C84]" />
                <span className="text-sm font-semibold text-[#1A1916]">Позиция · GPS</span>
                {isLive && (
                  <span className="ml-1 flex items-center gap-1 text-xs text-emerald-600">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    live
                  </span>
                )}
              </div>
              <div className="h-80">
                <MapView
                  points={mapPoints}
                  lines={mapLines}
                  center={mapCenter}
                  fitToData={!mapCenter}
                  className="h-full w-full rounded-none"
                  containerClassName="h-full rounded-none border-0 shadow-none"
                />
              </div>
            </div>

            {/* current route card */}
            {route ? (
              <div className="rounded-2xl border border-[#E8E2D8] bg-white shadow-sm p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Navigation className="h-4 w-4 text-[#948C84]" />
                    <span className="text-sm font-semibold text-[#1A1916]">{route.name}</span>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${routeStatusMeta(route.status).cls}`}>
                    {routeStatusMeta(route.status).label}
                  </span>
                </div>

                {/* from → to */}
                <div className="flex items-center gap-3 mb-5">
                  <div className="text-center">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 mx-auto mb-1" />
                    <p className="text-xs text-[#948C84]">Откуда</p>
                    <p className="text-sm font-medium text-[#1A1916] max-w-[140px] truncate">
                      {route.startPoint?.name ?? `${route.startLat.toFixed(3)}, ${route.startLon.toFixed(3)}`}
                    </p>
                  </div>
                  <div className="flex-1 h-px bg-[#E8E2D8] relative">
                    <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-center">
                      <div className="h-px w-full border-t border-dashed border-[#948C84]" />
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="h-2 w-2 rounded-full bg-rose-400 mx-auto mb-1" />
                    <p className="text-xs text-[#948C84]">Куда</p>
                    <p className="text-sm font-medium text-[#1A1916] max-w-[140px] truncate">
                      {route.endPoint?.name ?? `${route.endLat.toFixed(3)}, ${route.endLon.toFixed(3)}`}
                    </p>
                  </div>
                </div>

                {/* stats row */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {route.distance != null && (
                    <div className="rounded-xl bg-[#F2EEE8] px-3 py-2">
                      <p className="text-xs text-[#948C84]">Дистанция</p>
                      <p className="text-sm font-semibold text-[#1A1916]">{route.distance.toFixed(1)} км</p>
                    </div>
                  )}
                  {route.estimatedTime != null && (
                    <div className="rounded-xl bg-[#F2EEE8] px-3 py-2">
                      <p className="text-xs text-[#948C84]">ETA</p>
                      <p className="text-sm font-semibold text-[#1A1916]">{formatEta(route.estimatedTime)}</p>
                    </div>
                  )}
                  {route.fuelCostRub != null && (
                    <div className="rounded-xl bg-[#F2EEE8] px-3 py-2">
                      <p className="text-xs text-[#948C84]">Топливо</p>
                      <p className="text-sm font-semibold text-[#1A1916]">{Math.round(route.fuelCostRub)} ₽</p>
                    </div>
                  )}
                </div>

                {/* risk bar */}
                {risk != null && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[#948C84]">Риск маршрута</span>
                      <span className={`text-xs font-semibold ${riskLabel(risk)}`}>
                        {Math.round(risk * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#E8E2D8] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${riskColor(risk)}`}
                        style={{ width: `${Math.round(risk * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* tracking link */}
                {trackingUrl && (
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-2 rounded-xl border border-[#E8E2D8] bg-[#F2EEE8] px-3 py-2 text-xs text-[#3A3730] hover:bg-[#E8E2D8] transition w-full"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-[#948C84]" />}
                    <span className="truncate">{copied ? "Ссылка скопирована" : trackingUrl}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-[#E8E2D8] bg-white shadow-sm p-8 flex flex-col items-center text-center gap-2">
                <Navigation className="h-8 w-8 text-[#E8E2D8]" />
                <p className="text-sm font-medium text-[#1A1916]">Водитель не в рейсе</p>
                <p className="text-xs text-[#948C84]">Активный маршрут не назначен</p>
              </div>
            )}

            {/* news digest */}
            <div className="rounded-2xl border border-[#E8E2D8] bg-white shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <Radio className="h-4 w-4 text-[#948C84]" />
                <span className="text-sm font-semibold text-[#1A1916]">Дорожные предупреждения</span>
                {data.newsFeed?.length > 0 && (
                  <span className="ml-auto rounded-full bg-[#F2EEE8] px-2 py-0.5 text-xs text-[#948C84]">
                    {data.newsFeed.length}
                  </span>
                )}
              </div>
              {data.newsFeed && data.newsFeed.length > 0 ? (
                <div className="flex flex-col divide-y divide-[#F2EEE8]">
                  {data.newsFeed.slice(0, 6).map((item) => {
                    const pubDate = new Date(item.publishedAt);
                    const now = new Date();
                    const isToday = pubDate.toDateString() === now.toDateString();
                    const timeLabel = isToday
                      ? pubDate.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
                      : pubDate.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) +
                        " " + pubDate.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
                    const sourcePlatform = item.channel ?? item.source ?? "";
                    const isTg = sourcePlatform.toLowerCase().includes("telegram") || sourcePlatform.startsWith("@");
                    const isVk = sourcePlatform.toLowerCase().includes("vk");
                    const sourceLabel = isTg ? "Telegram" : isVk ? "VK" : item.source;
                    return (
                      <div key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityDot(item.severity)}`} />
                        <div className="min-w-0 flex-1">
                          {item.url ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-[#1A1916] leading-snug hover:underline"
                            >
                              {item.title}
                            </a>
                          ) : (
                            <p className="text-sm font-medium text-[#1A1916] leading-snug">{item.title}</p>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            {sourceLabel && (
                              <span className="text-xs text-[#948C84]">{sourceLabel}</span>
                            )}
                            {item.city && (
                              <span className="text-xs text-[#948C84]">· {item.city}</span>
                            )}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-[#948C84] whitespace-nowrap">
                          {timeLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-[#948C84] text-center py-4">Нет дорожных предупреждений</p>
              )}
            </div>
          </div>

          {/* ── RIGHT column (1/3) ────────────────────────────────────────── */}
          <div className="flex flex-col gap-6">

            {/* GPS freshness card */}
            <div className="rounded-2xl border border-[#E8E2D8] bg-white shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="h-4 w-4 text-[#948C84]" />
                <span className="text-sm font-semibold text-[#1A1916]">GPS-сигнал</span>
                {gpsAgo != null && (
                  <span className={`ml-auto inline-flex items-center gap-1 text-xs font-medium ${gpsColorCls(gpsAgo)}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${gpsDotCls(gpsAgo)}`} />
                    {gpsAgo < 1 ? "только что" : `${gpsAgo} мин назад`}
                  </span>
                )}
              </div>
              {pos ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-[#F2EEE8] px-3 py-2">
                    <p className="text-xs text-[#948C84]">Скорость</p>
                    <p className="text-sm font-semibold text-[#1A1916]">
                      {pos.speed != null ? `${Math.round(pos.speed)} км/ч` : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[#F2EEE8] px-3 py-2">
                    <p className="text-xs text-[#948C84]">Координаты</p>
                    <p className="text-xs font-mono text-[#3A3730]">
                      {pos.lat.toFixed(4)}, {pos.lon.toFixed(4)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[#948C84]">Нет данных о позиции</p>
              )}
            </div>

            {/* telematics card */}
            <div className="rounded-2xl border border-[#E8E2D8] bg-white shadow-sm p-5">
              <div className="flex items-center gap-2 mb-3">
                <Gauge className="h-4 w-4 text-[#948C84]" />
                <span className="text-sm font-semibold text-[#1A1916]">Телематика</span>
              </div>
              {telematics ? (
                <div className="flex flex-col gap-3">
                  {/* score bar */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[#948C84]">Балл</span>
                      <span className="text-sm font-bold text-[#1A1916]">{Math.round(telematics.score)}/100</span>
                    </div>
                    <div className="h-2 rounded-full bg-[#E8E2D8] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          telematics.score >= 70 ? "bg-emerald-500" : telematics.score >= 40 ? "bg-amber-500" : "bg-rose-500"
                        }`}
                        style={{ width: `${telematics.score}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-[#F2EEE8] px-3 py-2">
                      <p className="text-xs text-[#948C84]">Превышения</p>
                      <p className="text-sm font-semibold text-rose-600">{telematics.speedViolations}</p>
                    </div>
                    <div className="rounded-xl bg-[#F2EEE8] px-3 py-2">
                      <p className="text-xs text-[#948C84]">Резк. торм.</p>
                      <p className="text-sm font-semibold text-amber-600">{telematics.harshBraking}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[#948C84]">Загружаем данные телематики...</p>
              )}
            </div>

            {/* chat panel */}
            <div id="chat-section" className="rounded-2xl border border-[#E8E2D8] bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-[#E8E2D8]">
                <MessageSquare className="h-4 w-4 text-[#948C84]" />
                <span className="text-sm font-semibold text-[#1A1916]">Чат с водителем</span>
              </div>
              <ChatPanel
                senderId={currentUser?.id ?? 0}
                senderName="Диспетчер"
                role="DISPATCHER"
                targetDriverId={driverId}
                routeId={data.activeRoute?.id ?? null}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── stat card sub-component ─────────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-[#E8E2D8] bg-white px-4 py-3 min-w-[100px] shadow-sm">
      <div className="flex items-center gap-1.5 text-xs text-[#948C84]">
        {icon}
        {label}
      </div>
      <p className="text-base font-bold text-[#1A1916]">{value}</p>
    </div>
  );
}
