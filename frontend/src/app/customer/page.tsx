"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  LogOut,
  MapPin,
  Package,
  RefreshCw,
  Search,
  Settings,
  User,
  X,
} from "lucide-react";

import { toast } from "@/lib/sonner";
import {
  getMarketplaceOrders,
  createMarketplaceOrder,
  publicTrackRoute,
  getMe,
  logoutApi,
  type MarketplaceOrder,
  type SessionUser,
  type PublicTrackRouteResponse,
} from "@/lib/api";
import { getStoredUser, clearSession } from "@/lib/session";

// ─── helpers ───────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatRelative(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins} мин назад`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ч назад`;
    return `${Math.floor(hrs / 24)} д назад`;
  } catch {
    return "";
  }
}

const STATUS_MAP: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  OPEN: {
    label: "Открыт",
    bg: "bg-amber-50 border border-amber-200",
    text: "text-amber-700",
  },
  IN_PROGRESS: {
    label: "В работе",
    bg: "bg-emerald-50 border border-emerald-200",
    text: "text-emerald-700",
  },
  COMPLETED: {
    label: "Завершён",
    bg: "bg-fog border border-sand",
    text: "text-warmsilver",
  },
  CANCELLED: {
    label: "Отменён",
    bg: "bg-rose-50 border border-rose-200",
    text: "text-rose-600",
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] ?? {
    label: status,
    bg: "bg-fog border border-sand",
    text: "text-warmsilver",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  );
}

// ─── Skeleton card ──────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-sand bg-white shadow-sm p-5 space-y-3 animate-pulse">
      <div className="flex items-start justify-between">
        <div className="space-y-2 flex-1">
          <div className="h-4 bg-sand rounded-full w-1/2" />
          <div className="h-3 bg-sand rounded-full w-1/3" />
        </div>
        <div className="h-6 w-16 bg-sand rounded-full" />
      </div>
      <div className="h-3 bg-sand rounded-full w-3/4" />
      <div className="h-3 bg-sand rounded-full w-1/4" />
    </div>
  );
}

// ─── Order card ─────────────────────────────────────────────────────────────

function OrderCard({
  order,
}: {
  order: MarketplaceOrder;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border border-sand bg-white shadow-sm overflow-hidden">
      {/* main row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-5 hover:bg-fog/40 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="font-semibold text-plum text-sm leading-tight">
                {order.title}
              </span>
              <StatusBadge status={order.status} />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-warmsilver">
              <MapPin className="h-3 w-3 shrink-0" />
              <span>
                {order.startCity}
                <span className="mx-1 text-sand">→</span>
                {order.endCity}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {order.budget ? (
              <span className="text-sm font-semibold text-plum">
                {order.budget.toLocaleString("ru-RU")} ₽
              </span>
            ) : (
              <span className="text-xs text-warmsilver">Договорная</span>
            )}
            <span className="text-xs text-warmsilver">
              {formatRelative(order.createdAt)}
            </span>
          </div>
          <div className="shrink-0 text-warmsilver">
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </div>
        </div>
      </button>

      {/* expanded panel */}
      {expanded && (
        <div className="border-t border-sand bg-fog/30 px-5 py-4 space-y-4">
          {/* bids */}
          {order.bids.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-warmsilver uppercase tracking-wide mb-2">
                Ставки ({order.bids.length})
              </p>
              <div className="space-y-2">
                {order.bids.map((bid) => (
                  <div
                    key={bid.id}
                    className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-sm ${
                      bid.status === "ACCEPTED"
                        ? "bg-emerald-50 border border-emerald-200"
                        : "bg-white border border-sand"
                    }`}
                  >
                    <div>
                      <span className="font-medium text-plum">
                        {bid.driver?.user?.name ?? "Водитель"}
                      </span>
                      {bid.proposedPrice && (
                        <span className="ml-2 text-emerald-700 font-semibold">
                          {bid.proposedPrice.toLocaleString("ru-RU")} ₽
                        </span>
                      )}
                      {bid.estimatedTime && (
                        <span className="ml-2 text-warmsilver">
                          {bid.estimatedTime} мин
                        </span>
                      )}
                      {bid.message && (
                        <p className="mt-0.5 text-xs text-warmsilver">
                          {bid.message}
                        </p>
                      )}
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        bid.status === "ACCEPTED"
                          ? "bg-emerald-100 text-emerald-700"
                          : bid.status === "REJECTED"
                          ? "bg-rose-100 text-rose-600"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {bid.status === "ACCEPTED"
                        ? "Принята"
                        : bid.status === "REJECTED"
                        ? "Отклонена"
                        : "Ожидает"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-warmsilver">
              Ставок пока нет — водители ещё не откликнулись.
            </p>
          )}

          {/* details */}
          <div className="text-xs text-warmsilver space-y-1">
            <p>
              <span className="text-olive font-medium">Откуда:</span>{" "}
              {order.startAddress}
            </p>
            <p>
              <span className="text-olive font-medium">Куда:</span>{" "}
              {order.endAddress}
            </p>
            <p>
              <span className="text-olive font-medium">Создан:</span>{" "}
              {formatDate(order.createdAt)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Quick create form ───────────────────────────────────────────────────────

function QuickCreateForm({
  onCreated,
}: {
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    startCity: "",
    endCity: "",
    budget: "",
  });

  const mut = useMutation({
    mutationFn: () =>
      createMarketplaceOrder({
        title: form.title,
        startCity: form.startCity,
        endCity: form.endCity,
        startAddress: form.startCity,
        endAddress: form.endCity,
        startLat: 55.75,
        startLon: 37.62,
        endLat: 59.93,
        endLon: 30.32,
        budget: form.budget ? Number(form.budget) : undefined,
      }),
    onSuccess: () => {
      toast.success("Заказ создан и размещён на бирже");
      setForm({ title: "", startCity: "", endCity: "", budget: "" });
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["my-marketplace-orders"] });
      onCreated();
    },
    onError: () => toast.error("Не удалось создать заказ"),
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border-2 border-dashed border-sand bg-white hover:bg-fog/60 transition-colors px-5 py-4 text-sm text-warmsilver flex items-center gap-2"
      >
        <Package className="h-4 w-4" />
        Создать новый заказ
        <ArrowRight className="h-3.5 w-3.5 ml-auto" />
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-sand bg-white shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between mb-1">
        <p className="font-semibold text-plum text-sm">Новый заказ</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-warmsilver hover:text-olive transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-olive mb-1">
          Заголовок *
        </label>
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Перевозка груза"
          className="w-full rounded-xl border border-sand bg-fog/40 px-3 py-2 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-olive mb-1">
            Откуда *
          </label>
          <input
            value={form.startCity}
            onChange={(e) => setForm({ ...form, startCity: e.target.value })}
            placeholder="Москва"
            className="w-full rounded-xl border border-sand bg-fog/40 px-3 py-2 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-olive mb-1">
            Куда *
          </label>
          <input
            value={form.endCity}
            onChange={(e) => setForm({ ...form, endCity: e.target.value })}
            placeholder="Санкт-Петербург"
            className="w-full rounded-xl border border-sand bg-fog/40 px-3 py-2 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-olive mb-1">
          Бюджет ₽ (необязательно)
        </label>
        <input
          type="number"
          value={form.budget}
          onChange={(e) => setForm({ ...form, budget: e.target.value })}
          placeholder="15 000"
          className="w-full rounded-xl border border-sand bg-fog/40 px-3 py-2 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition"
        />
      </div>

      <button
        type="button"
        disabled={!form.title || !form.startCity || !form.endCity || mut.isPending}
        onClick={() => mut.mutate()}
        className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 flex items-center justify-center gap-2 transition-colors"
      >
        {mut.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Package className="h-4 w-4" />
        )}
        Разместить заказ
      </button>
    </div>
  );
}

// ─── Tracking tab ────────────────────────────────────────────────────────────

function TrackingTab() {
  const [input, setInput] = useState("");
  const [routeId, setRouteId] = useState<number | null>(null);
  const [searched, setSearched] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<PublicTrackRouteResponse>({
    queryKey: ["track-route", routeId],
    queryFn: () => publicTrackRoute(routeId!),
    enabled: routeId !== null,
    retry: false,
  });

  function handleSearch() {
    const n = parseInt(input.trim(), 10);
    if (!n || isNaN(n)) {
      toast.error("Введите корректный числовой ID маршрута");
      return;
    }
    setRouteId(n);
    setSearched(true);
  }

  function loadDemo() {
    setInput("42");
    setRouteId(42);
    setSearched(true);
  }

  const ROUTE_STATUS: Record<string, string> = {
    PLANNED: "Запланирован",
    ACTIVE: "В пути",
    COMPLETED: "Завершён",
    CANCELLED: "Отменён",
    RECALCULATING: "Пересчёт",
  };

  return (
    <div className="space-y-5">
      {/* search bar */}
      <div className="rounded-2xl border border-sand bg-white shadow-sm p-5">
        <p className="text-sm font-semibold text-plum mb-3">
          Отслеживание маршрута
        </p>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Введите ID маршрута (например, 42)"
            className="flex-1 rounded-xl border border-sand bg-fog/40 px-3 py-2.5 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition"
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={isLoading}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 text-sm font-semibold flex items-center gap-2 transition-colors"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Найти
          </button>
        </div>
        <button
          type="button"
          onClick={loadDemo}
          className="mt-2 text-xs text-warmsilver hover:text-olive underline transition-colors"
        >
          Загрузить демо (VLT-2026-00042)
        </button>
      </div>

      {/* loading */}
      {isLoading && (
        <div className="rounded-2xl border border-sand bg-white shadow-sm p-8 flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-emerald-500" />
          <p className="text-sm text-warmsilver">Получаем данные маршрута...</p>
        </div>
      )}

      {/* error */}
      {isError && searched && !isLoading && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 flex items-start gap-3">
          <X className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-rose-700">
              Маршрут не найден
            </p>
            <p className="text-xs text-rose-500 mt-0.5">
              Проверьте ID или попробуйте позже. Сервис может быть временно
              недоступен.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 text-xs text-rose-600 hover:text-rose-700 underline flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              Повторить
            </button>
          </div>
        </div>
      )}

      {/* result */}
      {data && !isLoading && (
        <div className="rounded-2xl border border-sand bg-white shadow-sm overflow-hidden">
          {/* header */}
          <div className="bg-emerald-600 px-5 py-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-white font-semibold">{data.name}</p>
                <p className="text-emerald-100 text-xs mt-0.5">
                  ID {data.id} · {formatDate(data.createdAt)}
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-white/20 text-white px-2.5 py-0.5 text-xs font-medium">
                {ROUTE_STATUS[data.status] ?? data.status}
              </span>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* route info */}
            <div className="grid grid-cols-2 gap-4">
              {data.startPoint && (
                <div>
                  <p className="text-xs text-warmsilver mb-0.5">Откуда</p>
                  <p className="text-sm font-medium text-plum">
                    {data.startPoint.city}
                  </p>
                  <p className="text-xs text-olive">{data.startPoint.name}</p>
                </div>
              )}
              {data.endPoint && (
                <div>
                  <p className="text-xs text-warmsilver mb-0.5">Куда</p>
                  <p className="text-sm font-medium text-plum">
                    {data.endPoint.city}
                  </p>
                  <p className="text-xs text-olive">{data.endPoint.name}</p>
                </div>
              )}
            </div>

            {data.distance && (
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-warmsilver text-xs">Расстояние</span>
                  <p className="text-plum font-medium">
                    {Math.round(data.distance)} км
                  </p>
                </div>
                {data.estimatedTime && (
                  <div>
                    <span className="text-warmsilver text-xs">Расч. время</span>
                    <p className="text-plum font-medium">
                      {Math.round(data.estimatedTime)} мин
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* GPS timeline */}
            {data.gpsLogs && data.gpsLogs.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-warmsilver uppercase tracking-wide mb-3">
                  GPS-точки ({data.gpsLogs.length})
                </p>
                <div className="space-y-0">
                  {data.gpsLogs.slice(-6).map((log, i, arr) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${
                            i === arr.length - 1
                              ? "bg-emerald-500 ring-2 ring-emerald-200"
                              : "bg-sand"
                          }`}
                        />
                        {i < arr.length - 1 && (
                          <div className="w-px flex-1 bg-sand min-h-[20px]" />
                        )}
                      </div>
                      <div className="pb-3">
                        <p className="text-xs text-warmsilver">
                          {new Date(log.timestamp).toLocaleString("ru-RU", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {log.speed !== undefined && (
                            <span className="ml-2 text-emerald-600">
                              {Math.round(log.speed)} км/ч
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-olive">
                          {log.lat.toFixed(4)}°, {log.lon.toFixed(4)}°
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                {data.gpsLogs.length > 6 && (
                  <p className="text-xs text-warmsilver mt-1">
                    … и ещё {data.gpsLogs.length - 6} точек
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-warmsilver">
                GPS-данных пока нет — маршрут ещё не начался.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Settings tab ────────────────────────────────────────────────────────────

function SettingsTab({ user }: { user: SessionUser }) {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    staleTime: 60_000,
  });

  const profile = me ?? user;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-sand bg-white shadow-sm p-5 space-y-5">
        <p className="font-semibold text-plum">Профиль</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-warmsilver mb-1">
              Имя
            </label>
            <div className="rounded-xl border border-sand bg-fog/40 px-3 py-2.5 text-sm text-plum">
              {profile.name}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-warmsilver mb-1">
              Email
            </label>
            <div className="rounded-xl border border-sand bg-fog/40 px-3 py-2.5 text-sm text-plum">
              {profile.email}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-warmsilver mb-1">
              Роль
            </label>
            <div className="rounded-xl border border-sand bg-fog/40 px-3 py-2.5 text-sm text-olive capitalize">
              {profile.role === "ADMIN"
                ? "Администратор"
                : profile.role === "DISPATCHER"
                ? "Диспетчер"
                : "Клиент"}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-sand bg-white shadow-sm p-5">
        <p className="font-semibold text-plum mb-2">Скоро</p>
        <ul className="space-y-2 text-sm text-warmsilver">
          <li className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-sand shrink-0" />
            Редактирование профиля и фотографии
          </li>
          <li className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-sand shrink-0" />
            Push-уведомления о статусе заказов
          </li>
          <li className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-sand shrink-0" />
            API-ключи для интеграции
          </li>
          <li className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-sand shrink-0" />
            История платежей и документы
          </li>
        </ul>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type TabId = "orders" | "tracking" | "settings";

export default function CustomerPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("orders");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/login");
      return;
    }
    setUser(stored);
    setReady(true);
  }, [router]);

  // All marketplace orders
  const {
    data: allOrders = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<MarketplaceOrder[]>({
    queryKey: ["my-marketplace-orders"],
    queryFn: () => getMarketplaceOrders(),
    enabled: ready,
    refetchInterval: 30_000,
    retry: 1,
  });

  // Filter to current user's orders
  const myOrders = user
    ? allOrders.filter((o) => o.createdBy.id === user.id)
    : [];

  const activeOrders = myOrders.filter(
    (o) => o.status === "OPEN" || o.status === "IN_PROGRESS"
  );
  const completedOrders = myOrders.filter((o) => o.status === "COMPLETED");
  const totalBids = myOrders.reduce((sum, o) => sum + o.bids.length, 0);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logoutApi();
    } catch {
      // ignore — still clear session
    }
    clearSession();
    router.replace("/login");
  }

  // Not yet ready
  if (!ready || !user) {
    return (
      <div className="min-h-screen bg-fog flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: "orders", label: "Мои заказы", icon: <Package className="h-4 w-4" /> },
    { id: "tracking", label: "Отслеживание", icon: <MapPin className="h-4 w-4" /> },
    { id: "settings", label: "Настройки", icon: <Settings className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen bg-fog">
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white border-b border-sand h-16 flex items-center px-6">
        <div className="max-w-4xl mx-auto w-full flex items-center justify-between">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight text-plum select-none"
          >
            VELTO
          </Link>

          <div className="flex items-center gap-3">
            <span className="text-sm text-olive font-medium hidden sm:block">
              {user.name}
            </span>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sand bg-white hover:bg-fog px-3 py-1.5 text-sm text-olive font-medium transition-colors disabled:opacity-50"
            >
              {loggingOut ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <LogOut className="h-3.5 w-3.5" />
              )}
              Выйти
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        {/* ── Profile hero ───────────────────────────────────────────────── */}
        <div className="bg-fog px-0 pt-8 pb-6">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div
              className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl font-bold shrink-0 select-none"
              aria-label={user.name}
            >
              {getInitials(user.name)}
            </div>

            <div>
              <p className="text-lg font-bold text-plum leading-tight">
                {user.name}
              </p>
              <p className="text-sm text-warmsilver">Клиент VELTO</p>
            </div>
          </div>

          {/* Stat chips */}
          <div className="flex gap-2 mt-5 flex-wrap">
            <div className="inline-flex items-center gap-2 rounded-xl bg-white border border-sand px-3.5 py-2 text-sm">
              <Clock className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-olive font-medium">
                {activeOrders.length}
              </span>
              <span className="text-warmsilver">активных заказов</span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-xl bg-white border border-sand px-3.5 py-2 text-sm">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-olive font-medium">
                {completedOrders.length}
              </span>
              <span className="text-warmsilver">выполнено</span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-xl bg-white border border-sand px-3.5 py-2 text-sm">
              <User className="h-3.5 w-3.5 text-plum" />
              <span className="text-olive font-medium">{totalBids}</span>
              <span className="text-warmsilver">ставок</span>
            </div>
          </div>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <div className="pb-10">
          {/* Tab bar */}
          <div className="flex gap-1 bg-white rounded-2xl border border-sand p-1 mb-5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? "bg-plum text-white shadow-sm"
                    : "text-warmsilver hover:text-olive hover:bg-fog/60"
                }`}
              >
                {tab.icon}
                <span className="hidden sm:block">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* ── Tab: Мои заказы ─────────────────────────────────────────── */}
          {activeTab === "orders" && (
            <div className="space-y-3">
              {/* Create form always on top */}
              <QuickCreateForm onCreated={() => setActiveTab("orders")} />

              {isLoading && (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              )}

              {isError && !isLoading && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 flex items-start gap-3">
                  <X className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-rose-700">
                      Не удалось загрузить заказы
                    </p>
                    <p className="text-xs text-rose-500 mt-0.5">
                      Проверьте соединение или попробуйте позже.
                    </p>
                    <button
                      type="button"
                      onClick={() => refetch()}
                      className="mt-2 text-xs text-rose-600 hover:text-rose-700 underline flex items-center gap-1"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Повторить
                    </button>
                  </div>
                </div>
              )}

              {!isLoading && !isError && myOrders.length === 0 && (
                <div className="rounded-2xl border border-sand bg-white shadow-sm p-10 flex flex-col items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-fog flex items-center justify-center">
                    <Package className="h-7 w-7 text-warmsilver" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-plum">
                      У вас ещё нет заказов
                    </p>
                    <p className="text-sm text-warmsilver mt-1">
                      Создайте заказ выше или посмотрите биржу грузов
                    </p>
                  </div>
                  <Link
                    href="/marketplace"
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 transition-colors"
                  >
                    Перейти на биржу
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}

              {!isLoading &&
                myOrders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))}
            </div>
          )}

          {/* ── Tab: Отслеживание ────────────────────────────────────────── */}
          {activeTab === "tracking" && <TrackingTab />}

          {/* ── Tab: Настройки ──────────────────────────────────────────── */}
          {activeTab === "settings" && <SettingsTab user={user} />}
        </div>
      </div>
    </div>
  );
}
