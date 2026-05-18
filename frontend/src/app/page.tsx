"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Clock,
  MapPin,
  MessageSquare,
  Navigation,
  Package,
  Radio,
  Search,
  ShieldCheck,
  Truck,
  Zap,
} from "lucide-react";
import { toast } from "@/lib/sonner";
import { publicTrackRoute, publicGeocodeAddress, publicCreateOrder } from "@/lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────

type TrackingHistoryItem = {
  date: string;
  status: string;
  location: string;
  done: boolean;
};

type TrackingResult = {
  number: string;
  status: string;
  currentLocation: string;
  estimatedDelivery: string;
  history: TrackingHistoryItem[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function routeStatusLabel(status?: string) {
  switch (status) {
    case "PLANNED": return "Запланирован";
    case "ACTIVE": return "В пути";
    case "COMPLETED": return "Доставлено";
    case "CANCELLED": return "Отменён";
    case "RECALCULATING": return "Пересчёт маршрута";
    default: return "—";
  }
}

const MOCK_TRACKING: TrackingResult = {
  number: "VLT-2026-00042",
  status: "В пути",
  currentLocation: "Московская обл., Ногинский р-н",
  estimatedDelivery: "Сегодня до 18:00",
  history: [
    { date: "20 апр, 09:15", status: "Принят в обработку", location: "Москва, склад №1 (Южный)", done: true },
    { date: "20 апр, 11:40", status: "Передан водителю", location: "Москва, склад №1 — водитель Алексей К.", done: true },
    { date: "20 апр, 13:20", status: "Выехал на доставку", location: "Москва, МКАД 15-й км", done: true },
    { date: "20 апр, 14:55", status: "В пути", location: "Московская обл., Ногинский р-н", done: false },
  ],
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "В пути" || status === "ACTIVE";
  const isDone = status === "Доставлено" || status === "COMPLETED";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
        isDone
          ? "bg-emerald-100 text-emerald-700"
          : isActive
          ? "bg-amber-100 text-amber-700"
          : "bg-gray-100 text-gray-600"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isDone ? "bg-emerald-500" : isActive ? "bg-amber-500" : "bg-gray-400"
        }`}
      />
      {status}
    </span>
  );
}

function TrackingCard({ result }: { result: TrackingResult }) {
  return (
    <div className="mt-6 rounded-2xl border border-sand bg-white shadow-sm overflow-hidden">
      <div className="flex items-start justify-between px-5 py-4 border-b border-sand">
        <div>
          <p className="text-xs text-warmsilver uppercase tracking-widest mb-1">Номер заказа</p>
          <p className="text-base font-bold text-plum tracking-tight">{result.number}</p>
        </div>
        <StatusBadge status={result.status} />
      </div>

      <div className="flex items-center gap-2 border-b border-sand bg-fog px-5 py-3">
        <Clock className="h-4 w-4 text-emerald-600 shrink-0" />
        <span className="text-sm text-olive">Ожидаемая доставка:</span>
        <span className="text-sm font-semibold text-emerald-700">{result.estimatedDelivery}</span>
      </div>

      <div className="px-5 py-5">
        <p className="text-xs font-semibold text-warmsilver uppercase tracking-widest mb-4">История отправления</p>
        <div className="space-y-0">
          {result.history.map((item, idx) => {
            const isLast = idx === result.history.length - 1;
            return (
              <div key={idx} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                      isLast
                        ? "border-emerald-500 bg-emerald-500"
                        : item.done
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-sand bg-white"
                    }`}
                  >
                    {isLast ? (
                      <Truck className="h-3.5 w-3.5 text-white" />
                    ) : item.done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-gray-300" />
                    )}
                  </div>
                  {idx < result.history.length - 1 && (
                    <div className="w-px flex-1 bg-sand my-1" style={{ minHeight: 20 }} />
                  )}
                </div>
                <div className="flex-1 pb-4">
                  <p className={`text-sm font-semibold ${isLast ? "text-emerald-700" : "text-plum"}`}>
                    {item.status}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-warmsilver">
                    <MapPin className="h-3 w-3 shrink-0" />
                    {item.location}
                  </div>
                  <p className="mt-0.5 text-xs text-warmsilver">{item.date}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function HomePage() {
  // Tracking state
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingResult, setTrackingResult] = useState<TrackingResult | null>(null);
  const [isTracking, setIsTracking] = useState(false);

  // Order form state
  const [orderForm, setOrderForm] = useState({ from: "", to: "", weight: "", description: "" });
  const [isCreating, setIsCreating] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleDemoTrack = () => {
    setTrackingNumber("VLT-2026-00042");
    setTrackingResult(MOCK_TRACKING);
    toast.success("Демо-заказ загружен", { description: "Это тестовые данные для демонстрации трекинга" });
    document.getElementById("tracking")?.scrollIntoView({ behavior: "smooth" });
  };

  const handleTrack = async () => {
    if (!trackingNumber.trim()) {
      toast.error("Введите номер отслеживания");
      return;
    }
    const numericId = Number(trackingNumber.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(numericId) || numericId <= 0) {
      toast.error("Некорректный номер заказа");
      return;
    }
    setIsTracking(true);
    try {
      const route = await publicTrackRoute(numericId);
      const history: TrackingHistoryItem[] = (route.gpsLogs ?? [])
        .slice(0, 5)
        .map((log, idx, arr) => ({
          date: formatDate(log.timestamp),
          status: "GPS-точка",
          location: `${log.lat.toFixed(4)}, ${log.lon.toFixed(4)}`,
          done: idx < arr.length - 1,
        }));

      setTrackingResult({
        number: String(route.id ?? trackingNumber),
        status: routeStatusLabel(route.status),
        currentLocation: route.endPoint?.address ?? route.startPoint?.address ?? "—",
        estimatedDelivery: route.estimatedTime
          ? `≈ ${Math.round(route.estimatedTime / 60)} мин в пути`
          : "—",
        history,
      });
      toast.success("Заказ найден");
    } catch {
      setTrackingResult(null);
      toast.error("Заказ не найден или сервис недоступен");
    } finally {
      setIsTracking(false);
    }
  };

  const handleCreateOrder = async () => {
    if (!orderForm.from.trim() || !orderForm.to.trim()) {
      toast.error("Укажите город отправления и назначения");
      return;
    }
    setIsCreating(true);
    try {
      const [fromGeo] = await publicGeocodeAddress(orderForm.from);
      const [toGeo] = await publicGeocodeAddress(orderForm.to);
      if (!fromGeo || !toGeo) throw new Error("Геокодирование не дало результата");

      const route = await publicCreateOrder({
        startLat: fromGeo.lat,
        startLon: fromGeo.lon,
        startName: fromGeo.displayName,
        startCity: fromGeo.city,
        startAddress: fromGeo.address,
        endLat: toGeo.lat,
        endLon: toGeo.lon,
        endName: toGeo.displayName,
        endCity: toGeo.city,
        endAddress: toGeo.address,
      });
      toast.success(`Заказ создан! Номер: ${route.id}`, {
        description: "Мы свяжемся с вами для подтверждения",
      });
      setOrderForm({ from: "", to: "", weight: "", description: "" });
    } catch {
      toast.error("Не удалось создать заказ. Проверьте адреса или попробуйте позже.");
    } finally {
      setIsCreating(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-white font-sans antialiased">

      {/* ═══ HEADER ════════════════════════════════════════════════════════ */}
      <header className="fixed inset-x-0 top-0 z-50 h-16 border-b border-sand bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Wordmark */}
          <span className="text-xl font-bold tracking-tight text-plum select-none">VELTO</span>

          {/* Center nav */}
          <nav className="hidden md:flex items-center gap-7">
            <a
              href="#tracking"
              className="text-sm font-medium text-olive hover:text-plum transition-colors"
            >
              Отслеживание
            </a>
            <a
              href="#features"
              className="text-sm font-medium text-olive hover:text-plum transition-colors"
            >
              Услуги
            </a>
            <a
              href="#order"
              className="text-sm font-medium text-olive hover:text-plum transition-colors"
            >
              Маркетплейс
            </a>
          </nav>

          {/* CTA */}
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
          >
            Войти
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* ═══ HERO ══════════════════════════════════════════════════════════ */}
      <section className="pt-32 pb-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8 items-center">

            {/* Left column */}
            <div className="lg:col-span-7 flex flex-col gap-7">
              {/* Badge */}
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-sand bg-fog px-3.5 py-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-medium text-olive">GPS-мониторинг в реальном времени</span>
              </div>

              {/* H1 */}
              <h1 className="text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] text-plum">
                Доставка{" "}
                <span className="text-emerald-600">под контролем.</span>
                <br />
                Каждый километр.
              </h1>

              {/* Subtext */}
              <p className="text-lg text-warmsilver max-w-lg leading-relaxed">
                Планирование маршрутов, GPS-отслеживание каждые 4 секунды
                и встроенный грузовой маркетплейс — всё в одной платформе.
              </p>

              {/* CTAs */}
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href="#tracking"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors shadow-sm"
                >
                  <Search className="h-4 w-4" />
                  Отследить заказ
                </a>
                <Link
                  href="/login?mode=register"
                  className="inline-flex items-center gap-2 rounded-xl border border-sand px-5 py-3 text-sm font-semibold text-plum hover:bg-fog transition-colors"
                >
                  Зарегистрироваться
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              {/* Stats row */}
              <div className="flex flex-wrap items-center gap-0 divide-x divide-sand pt-2">
                {[
                  { value: "2 400+", label: "рейсов/мес" },
                  { value: "47", label: "регионов" },
                  { value: "98.3%", label: "в срок" },
                ].map((stat) => (
                  <div key={stat.label} className="px-5 first:pl-0 last:pr-0">
                    <p className="text-2xl font-bold tracking-tight text-plum">{stat.value}</p>
                    <p className="text-xs text-warmsilver mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right column — Route card */}
            <div className="lg:col-span-5 relative flex justify-center lg:justify-end">
              <div className="relative w-full max-w-sm">
                {/* Main route card */}
                <div className="rounded-3xl border border-sand bg-white shadow-sm p-5 w-full">
                  {/* Card header */}
                  <div className="flex items-center justify-between mb-5">
                    <span className="text-xs font-semibold text-warmsilver uppercase tracking-widest">Рейс</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                      В пути
                    </span>
                  </div>

                  {/* Route line */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex flex-col items-center text-center min-w-[48px]">
                      <span className="text-sm font-bold text-plum">ЕКБ</span>
                      <span className="text-[10px] text-warmsilver mt-0.5">Екатеринбург</span>
                    </div>

                    <div className="flex-1 flex flex-col gap-1">
                      <div className="relative h-1.5 rounded-full bg-sand overflow-hidden">
                        <div
                          className="absolute left-0 top-0 h-full rounded-full bg-emerald-500"
                          style={{ width: "62%" }}
                        />
                        <div
                          className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-600 shadow-sm"
                          style={{ left: "calc(62% - 7px)" }}
                        />
                      </div>
                      <p className="text-[10px] text-warmsilver text-center">62% маршрута</p>
                    </div>

                    <div className="flex flex-col items-center text-center min-w-[48px]">
                      <span className="text-sm font-bold text-plum">ТЮМ</span>
                      <span className="text-[10px] text-warmsilver mt-0.5">Тюмень</span>
                    </div>
                  </div>

                  {/* Driver info */}
                  <div className="rounded-xl bg-fog px-3 py-2.5 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-emerald-700">АК</span>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-plum">Алексей К. · MAN TGX</p>
                        <p className="text-[10px] text-warmsilver">Е512МА96</p>
                      </div>
                    </div>
                  </div>

                  {/* ETA */}
                  <div className="flex items-center gap-2 text-xs text-olive">
                    <Clock className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <span>Прибытие через <strong className="text-plum">3 ч 40 мин</strong> · 312 км</span>
                  </div>
                </div>

                {/* Floating AI alert */}
                <div className="absolute -top-4 -right-3 z-10 w-56 rounded-2xl border border-amber-200 bg-white shadow-md px-3.5 py-2.5">
                  <div className="flex items-start gap-2">
                    <BrainCircuit className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-olive leading-snug">
                      пробка на М-5, маршрут перестроен +12 мин
                    </p>
                  </div>
                </div>

                {/* Floating chat bubble */}
                <div className="absolute -bottom-4 -left-3 z-10 w-52 rounded-2xl border border-sand bg-white shadow-md px-3.5 py-2.5">
                  <div className="flex items-start gap-2">
                    <MessageSquare className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-semibold text-warmsilver mb-0.5">Диспетчер → Алексей</p>
                      <p className="text-[11px] text-olive">Объезд через Тобольское ш.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ═══ TRACKING ══════════════════════════════════════════════════════ */}
      <section id="tracking" className="py-20 bg-fog scroll-mt-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16 items-start">

            {/* Left */}
            <div>
              <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-3">Трекинг</p>
              <h2 className="text-4xl font-bold tracking-tight text-plum mb-4">
                Отследить свой заказ
              </h2>
              <p className="text-base text-warmsilver leading-relaxed max-w-sm">
                Введите номер отправления или воспользуйтесь демо, чтобы увидеть,
                как работает система отслеживания VELTO.
              </p>

              <ul className="mt-8 space-y-3">
                {[
                  "Обновление позиции каждые 4 секунды",
                  "История всех точек маршрута",
                  "Уведомления при изменении статуса",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-olive">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right */}
            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Номер заказа, например: VLT-2026-00042"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTrack()}
                  className="flex-1 rounded-xl border border-sand bg-white px-4 py-3 text-sm text-plum placeholder:text-warmsilver focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                />
                <button
                  onClick={handleTrack}
                  disabled={isTracking}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {isTracking ? (
                    <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  {isTracking ? "Ищем..." : "Найти"}
                </button>
              </div>

              <button
                onClick={handleDemoTrack}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
              >
                <Zap className="h-3.5 w-3.5" />
                Загрузить демо VLT-2026-00042
              </button>

              {trackingResult && <TrackingCard result={trackingResult} />}
            </div>

          </div>
        </div>
      </section>

      {/* ═══ QUICK ORDER ════════════════════════════════════════════════════ */}
      <section id="order" className="py-20 scroll-mt-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16 items-start">

            {/* Left — heading */}
            <div>
              <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-3">Маркетплейс</p>
              <h2 className="text-4xl font-bold tracking-tight text-plum mb-4">
                Оформить доставку
              </h2>
              <p className="text-base text-warmsilver leading-relaxed max-w-sm">
                Укажите маршрут — мы рассчитаем стоимость и подберём свободного водителя
                в ближайшее время.
              </p>

              <div className="mt-8 rounded-2xl border border-sand bg-fog p-5">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-semibold text-plum">Безопасная сделка</span>
                </div>
                <p className="text-xs text-warmsilver leading-relaxed">
                  Оплата переводится водителю только после подтверждения получения груза.
                  Страховка груза включена до 500 000 ₽.
                </p>
              </div>
            </div>

            {/* Right — form */}
            <div className="rounded-3xl border border-sand bg-white shadow-sm p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-warmsilver uppercase tracking-widest mb-2">
                    Откуда
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Город, адрес"
                      value={orderForm.from}
                      onChange={(e) => setOrderForm({ ...orderForm, from: e.target.value })}
                      className="w-full rounded-xl border border-sand pl-9 pr-4 py-3 text-sm text-plum placeholder:text-warmsilver focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-warmsilver uppercase tracking-widest mb-2">
                    Куда
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Город, адрес"
                      value={orderForm.to}
                      onChange={(e) => setOrderForm({ ...orderForm, to: e.target.value })}
                      className="w-full rounded-xl border border-sand pl-9 pr-4 py-3 text-sm text-plum placeholder:text-warmsilver focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-semibold text-warmsilver uppercase tracking-widest mb-2">
                  Вес груза (кг)
                </label>
                <input
                  type="number"
                  placeholder="Например: 250"
                  value={orderForm.weight}
                  onChange={(e) => setOrderForm({ ...orderForm, weight: e.target.value })}
                  className="w-full rounded-xl border border-sand px-4 py-3 text-sm text-plum placeholder:text-warmsilver focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                />
              </div>

              <div className="mb-6">
                <label className="block text-xs font-semibold text-warmsilver uppercase tracking-widest mb-2">
                  Описание груза
                </label>
                <textarea
                  rows={3}
                  placeholder="Тип груза, упаковка, особые условия перевозки…"
                  value={orderForm.description}
                  onChange={(e) => setOrderForm({ ...orderForm, description: e.target.value })}
                  className="w-full rounded-xl border border-sand px-4 py-3 text-sm text-plum placeholder:text-warmsilver focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors resize-none"
                />
              </div>

              <button
                onClick={handleCreateOrder}
                disabled={isCreating}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {isCreating ? (
                  <>
                    <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Создаём заказ…
                  </>
                ) : (
                  <>
                    <Package className="h-4 w-4" />
                    Оформить доставку
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      </section>

      {/* ═══ AI FEATURES ════════════════════════════════════════════════════ */}
      <section id="features" className="py-20 bg-fog scroll-mt-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-3">Технологии</p>
            <h2 className="text-4xl font-bold tracking-tight text-plum max-w-2xl mx-auto">
              Интеллектуальная платформа для логистики
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {[
              {
                icon: <BrainCircuit className="h-5 w-5 text-emerald-600" />,
                title: "Прогноз ETA",
                desc: "XGBoost-модель учитывает погоду, загруженность трасс, время суток и день недели для точного прогноза прибытия.",
                tag: "Точность ±12 мин",
              },
              {
                icon: <Navigation className="h-5 w-5 text-emerald-600" />,
                title: "GPS-мониторинг",
                desc: "Живая позиция каждые 4 секунды. История трека, телематика водителя, геозоны и автоматические уведомления.",
                tag: "Работает в реальном времени",
              },
              {
                icon: <AlertTriangle className="h-5 w-5 text-emerald-600" />,
                title: "Анализ рисков",
                desc: "Новостной парсер, погодные предупреждения Росгидромета и ML-оценка риска маршрута перед отправкой.",
                tag: "Работает в реальном времени",
              },
              {
                icon: <MessageSquare className="h-5 w-5 text-emerald-600" />,
                title: "Чат диспетчер-водитель",
                desc: "WebSocket-чат с историей сообщений, уведомления в Telegram при событиях маршрута.",
                tag: "Работает в реальном времени",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="rounded-2xl border border-sand bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                    {card.icon}
                  </div>
                  <h3 className="text-base font-bold text-plum">{card.title}</h3>
                </div>
                <p className="text-sm text-warmsilver leading-relaxed mb-4">{card.desc}</p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  <Radio className="h-3 w-3" />
                  {card.tag}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ GEOGRAPHY ══════════════════════════════════════════════════════ */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">

            {/* Left — city pairs */}
            <div>
              <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-3">Покрытие</p>
              <h2 className="text-4xl font-bold tracking-tight text-plum mb-8">Покрытие по России</h2>

              <div className="space-y-2">
                {[
                  { from: "Москва", to: "Екатеринбург", km: "1 800 км" },
                  { from: "Москва", to: "Санкт-Петербург", km: "710 км" },
                  { from: "Екатеринбург", to: "Тюмень", km: "330 км" },
                  { from: "Новосибирск", to: "Омск", km: "640 км" },
                  { from: "Казань", to: "Нижний Новгород", km: "395 км" },
                  { from: "Ростов-на-Дону", to: "Краснодар", km: "290 км" },
                  { from: "Уфа", to: "Челябинск", km: "410 км" },
                  { from: "Пермь", to: "Екатеринбург", km: "345 км" },
                ].map((route) => (
                  <div
                    key={`${route.from}-${route.to}`}
                    className="flex items-center gap-3 rounded-xl border border-sand bg-white px-4 py-3 hover:bg-fog transition-colors"
                  >
                    <MapPin className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span className="text-sm font-medium text-plum flex-1">
                      {route.from}
                    </span>
                    <div className="flex items-center gap-1.5 text-warmsilver">
                      <span className="h-px w-8 bg-sand" />
                      <span className="text-[10px]">→</span>
                      <span className="h-px w-8 bg-sand" />
                    </div>
                    <span className="text-sm font-medium text-plum flex-1 text-right">
                      {route.to}
                    </span>
                    <span className="ml-3 text-xs font-semibold text-warmsilver shrink-0 w-16 text-right">
                      {route.km}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — service columns */}
            <div className="flex flex-col gap-5 pt-16">
              {[
                {
                  icon: <Truck className="h-5 w-5 text-emerald-600" />,
                  title: "Адресная доставка",
                  items: [
                    "Доставка «от двери до двери»",
                    "Экспресс 24 ч по ключевым маршрутам",
                    "Хрупкий и температурный груз",
                    "Документы и корреспонденция",
                    "Частичная загрузка (LTL)",
                  ],
                },
                {
                  icon: <Package className="h-5 w-5 text-emerald-600" />,
                  title: "Складское хранение",
                  items: [
                    "3 собственных склада класса B+",
                    "Ответственное хранение",
                    "Кросс-докинг и сортировка",
                    "Фулфилмент для e-commerce",
                    "Онлайн-учёт остатков в ЛК",
                  ],
                },
              ].map((service) => (
                <div key={service.title} className="rounded-2xl border border-sand bg-fog p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-9 w-9 rounded-xl bg-white border border-sand flex items-center justify-center shrink-0">
                      {service.icon}
                    </div>
                    <h3 className="text-base font-bold text-plum">{service.title}</h3>
                  </div>
                  <ul className="space-y-2">
                    {service.items.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-sm text-olive">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

          </div>
        </div>
      </section>

      {/* ═══ TRUST STATS ════════════════════════════════════════════════════ */}
      <section className="py-16 bg-fog">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-y md:divide-y-0 md:divide-x divide-sand border border-sand rounded-2xl bg-white overflow-hidden">
            {[
              { value: "12 лет", label: "на рынке" },
              { value: "180+", label: "водителей" },
              { value: "3", label: "собственных склада" },
              { value: "SLA 98.3%", label: "выполнено в срок" },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col items-center justify-center py-8 px-6 text-center">
                <p className="text-3xl font-bold tracking-tight text-plum">{stat.value}</p>
                <p className="text-sm text-warmsilver mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FOOTER ═════════════════════════════════════════════════════════ */}
      <footer className="py-12 bg-plum text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">

            {/* Wordmark */}
            <div>
              <p className="text-xl font-bold tracking-tight mb-3">VELTO</p>
              <p className="text-sm text-white/50 leading-relaxed">
                Интеллектуальная платформа для управления грузоперевозками по России.
              </p>
            </div>

            {/* Col 1 */}
            <div>
              <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Услуги</p>
              <ul className="space-y-2.5">
                {["Адресная доставка", "Складское хранение", "Экспресс-доставка", "Фулфилмент", "LTL-перевозки"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-white/60 hover:text-white transition-colors">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Col 2 */}
            <div>
              <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Платформа</p>
              <ul className="space-y-2.5">
                {["Трекинг заказов", "GPS-мониторинг", "ETA-прогноз", "Маркетплейс", "Личный кабинет"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-white/60 hover:text-white transition-colors">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Col 3 */}
            <div>
              <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Компания</p>
              <ul className="space-y-2.5">
                {["О нас", "Вакансии", "Пресса", "Партнёрам", "Контакты"].map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-white/60 hover:text-white transition-colors">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

          </div>

          <div className="mt-10 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-white/40">© 2026 ООО «ВЕЛТО». Все права защищены.</p>
            {/* <p className="text-xs text-white/40">ИНН 6671234567 · ОГРН 1216600012345</p> */}
          </div>
        </div>
      </footer>

    </div>
  );
}
