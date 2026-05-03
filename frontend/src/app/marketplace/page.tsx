"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  LogIn,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Trash2,
  Truck,
  User,
  X,
} from "lucide-react";

import { toast } from "@/lib/sonner";
import {
  getMarketplaceOrders,
  createMarketplaceOrder,
  submitBid,
  acceptBid,
  completeMarketplaceOrder,
  deleteMarketplaceOrder,
  getMyBids,
  geocodeAddress,
  publicGeocodeAddress,
  type MarketplaceOrder,
  type MarketplaceBid,
  type GeocodeResult,
} from "@/lib/api";
import { getStoredUser } from "@/lib/session";
import type { SessionUser } from "@/lib/api";

// ─── helpers ───────────────────────────────────────────────────────────────

function formatRelative(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "только что";
    if (mins < 60) return `${mins} мин назад`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ч назад`;
    return `${Math.floor(hrs / 24)} д назад`;
  } catch {
    return "";
  }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

const STATUS_MAP: Record<string, { label: string; bg: string; text: string }> =
  {
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

function SkeletonOrderCard() {
  return (
    <div className="rounded-2xl border border-sand bg-white shadow-sm p-5 space-y-3 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-sand rounded-full w-2/3" />
          <div className="h-3 bg-sand rounded-full w-1/3" />
        </div>
        <div className="h-6 w-16 bg-sand rounded-full" />
      </div>
      <div className="h-3 bg-sand rounded-full w-1/2" />
      <div className="flex gap-2">
        <div className="h-8 bg-sand rounded-xl flex-1" />
      </div>
    </div>
  );
}

// ─── Geocode autocomplete ────────────────────────────────────────────────────

function CityInput({
  label,
  value,
  onChange,
  onSelect,
  placeholder,
  isAuthenticated,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSelect: (r: GeocodeResult) => void;
  placeholder?: string;
  isAuthenticated: boolean;
}) {
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    (q: string) => {
      if (debounce.current) clearTimeout(debounce.current);
      if (!q || q.length < 2) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      debounce.current = setTimeout(async () => {
        setLoading(true);
        try {
          const fn = isAuthenticated ? geocodeAddress : publicGeocodeAddress;
          const results = await fn(q);
          setSuggestions(results.slice(0, 5));
          setOpen(results.length > 0);
        } catch {
          setSuggestions([]);
        } finally {
          setLoading(false);
        }
      }, 400);
    },
    [isAuthenticated]
  );

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-olive mb-1">
        {label} *
      </label>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            search(e.target.value);
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder ?? "Введите город или адрес"}
          className="w-full rounded-xl border border-sand bg-fog/40 px-3 py-2.5 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition pr-8"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-warmsilver" />
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-sand bg-white shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onMouseDown={() => {
                onSelect(s);
                onChange(s.city || s.displayName);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-fog transition-colors border-b border-sand last:border-0"
            >
              <p className="font-medium text-plum truncate">{s.city}</p>
              <p className="text-xs text-warmsilver truncate">{s.displayName}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Inline bid form ────────────────────────────────────────────────────────

function BidForm({
  orderId,
  onClose,
  isAuthenticated,
}: {
  orderId: number;
  onClose: () => void;
  isAuthenticated: boolean;
}) {
  const qc = useQueryClient();
  const [price, setPrice] = useState("");
  const [time, setTime] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();

  const mut = useMutation({
    mutationFn: () =>
      submitBid(orderId, {
        proposedPrice: price ? Number(price) : undefined,
        estimatedTime: time ? Number(time) : undefined,
        message: message || undefined,
      }),
    onSuccess: () => {
      toast.success("Ставка подана успешно");
      qc.invalidateQueries({ queryKey: ["marketplace-open"] });
      onClose();
    },
    onError: () => toast.error("Ошибка при подаче ставки"),
  });

  if (!isAuthenticated) {
    return (
      <div className="rounded-xl border border-sand bg-fog/60 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-olive">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
          Войдите, чтобы подать ставку
        </div>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 transition-colors shrink-0"
        >
          <LogIn className="h-3.5 w-3.5" />
          Войти
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-emerald-800">Подать ставку</p>
        <button
          type="button"
          onClick={onClose}
          className="text-warmsilver hover:text-olive transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-olive mb-1">
            Цена ₽
          </label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="15 000"
            className="w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-olive mb-1">
            Время (мин)
          </label>
          <input
            type="number"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="240"
            className="w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition"
          />
        </div>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Сообщение клиенту (необязательно)"
        rows={2}
        className="w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition resize-none"
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold py-2 flex items-center justify-center gap-2 transition-colors"
        >
          {mut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Truck className="h-4 w-4" />
          )}
          Подать ставку
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-sand bg-white hover:bg-fog text-olive text-sm font-medium px-4 py-2 transition-colors"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}

// ─── Open order card (browse tab) ───────────────────────────────────────────

function OpenOrderCard({
  order,
  user,
}: {
  order: MarketplaceOrder;
  user: SessionUser | null;
}) {
  const [bidOpen, setBidOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isAuthenticated = !!user;

  return (
    <div className="rounded-2xl border border-sand bg-white shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="font-semibold text-plum text-sm">
                {order.title}
              </span>
              <StatusBadge status={order.status} />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-warmsilver mb-1">
              <MapPin className="h-3 w-3 shrink-0" />
              <span>
                {order.startCity}
                <span className="mx-1.5 opacity-50">→</span>
                {order.endCity}
              </span>
            </div>
            {order.description && (
              <p className="text-xs text-olive mt-1 line-clamp-2">
                {order.description}
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            {order.budget ? (
              <span className="text-sm font-bold text-plum">
                от {order.budget.toLocaleString("ru-RU")} ₽
              </span>
            ) : (
              <span className="text-xs text-warmsilver italic">договорная</span>
            )}
            <span className="text-xs text-warmsilver">
              {formatRelative(order.createdAt)}
            </span>
          </div>
        </div>

        {/* meta row */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-sand">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs text-warmsilver hover:text-olive transition-colors"
            >
              <User className="h-3.5 w-3.5" />
              {order.bids.length > 0
                ? `${order.bids.length} ${
                    order.bids.length === 1
                      ? "ставка"
                      : order.bids.length < 5
                      ? "ставки"
                      : "ставок"
                  }`
                : "Нет ставок"}
              {expanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
            <span className="text-xs text-warmsilver hidden sm:block">
              {order.createdBy.name}
            </span>
          </div>

          {order.status === "OPEN" && (
            <button
              type="button"
              onClick={() => setBidOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-plum hover:bg-olive text-white text-xs font-semibold px-3 py-1.5 transition-colors"
            >
              <Truck className="h-3.5 w-3.5" />
              Подать ставку
            </button>
          )}
        </div>
      </div>

      {/* inline bid form */}
      {bidOpen && order.status === "OPEN" && (
        <div className="px-5 pb-5">
          <BidForm
            orderId={order.id}
            onClose={() => setBidOpen(false)}
            isAuthenticated={isAuthenticated}
          />
        </div>
      )}

      {/* expanded bids list */}
      {expanded && order.bids.length > 0 && (
        <div className="border-t border-sand bg-fog/30 px-5 py-4 space-y-2">
          <p className="text-xs font-semibold text-warmsilver uppercase tracking-wide mb-2">
            Ставки
          </p>
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
                  <p className="text-xs text-warmsilver mt-0.5">{bid.message}</p>
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
      )}
    </div>
  );
}

// ─── My order card (manage tab) ─────────────────────────────────────────────

function MyOrderCard({
  order,
  onAccept,
  onComplete,
  onDelete,
  acceptLoading,
  completeLoading,
  deleteLoading,
}: {
  order: MarketplaceOrder;
  onAccept: (bidId: number) => void;
  onComplete: () => void;
  onDelete: () => void;
  acceptLoading: boolean;
  completeLoading: boolean;
  deleteLoading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const canDelete = order.status === "OPEN" && order.bids.length === 0;

  return (
    <div className="rounded-2xl border border-sand bg-white shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="font-semibold text-plum text-sm">
                {order.title}
              </span>
              <StatusBadge status={order.status} />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-warmsilver">
              <MapPin className="h-3 w-3 shrink-0" />
              {order.startCity}
              <span className="opacity-50">→</span>
              {order.endCity}
            </div>
            <p className="text-xs text-warmsilver mt-0.5">
              {formatDate(order.createdAt)}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            {order.budget && (
              <span className="text-sm font-bold text-plum">
                {order.budget.toLocaleString("ru-RU")} ₽
              </span>
            )}
            <div className="flex gap-1.5">
              {order.status === "IN_PROGRESS" && (
                <button
                  type="button"
                  onClick={onComplete}
                  disabled={completeLoading}
                  className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
                >
                  {completeLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle className="h-3.5 w-3.5" />
                  )}
                  Завершить
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={deleteLoading}
                  className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 disabled:opacity-50 text-rose-600 text-xs font-semibold px-3 py-1.5 transition-colors"
                >
                  {deleteLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Удалить
                </button>
              )}
            </div>
          </div>
        </div>

        {/* bids toggle */}
        {order.bids.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 pt-3 border-t border-sand w-full flex items-center justify-between text-xs text-warmsilver hover:text-olive transition-colors"
          >
            <span>
              {order.bids.length}{" "}
              {order.bids.length === 1
                ? "ставка"
                : order.bids.length < 5
                ? "ставки"
                : "ставок"}
            </span>
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>

      {/* expanded bids */}
      {expanded && order.bids.length > 0 && (
        <div className="border-t border-sand bg-fog/30 px-5 py-4 space-y-2">
          <p className="text-xs font-semibold text-warmsilver uppercase tracking-wide mb-2">
            Ставки водителей
          </p>
          {order.bids.map((bid) => (
            <div
              key={bid.id}
              className={`rounded-xl px-4 py-3 border ${
                bid.status === "ACCEPTED"
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-white border-sand"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-plum">
                    {bid.driver?.user?.name ?? "Водитель"}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {bid.proposedPrice && (
                      <span className="text-sm text-emerald-700 font-bold">
                        {bid.proposedPrice.toLocaleString("ru-RU")} ₽
                      </span>
                    )}
                    {bid.estimatedTime && (
                      <span className="text-xs text-warmsilver flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {bid.estimatedTime} мин
                      </span>
                    )}
                  </div>
                  {bid.message && (
                    <p className="text-xs text-olive mt-1">{bid.message}</p>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  {bid.status === "PENDING" && order.status === "OPEN" && (
                    <button
                      type="button"
                      onClick={() => onAccept(bid.id)}
                      disabled={acceptLoading}
                      className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 transition-colors"
                    >
                      {acceptLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle className="h-3.5 w-3.5" />
                      )}
                      Принять
                    </button>
                  )}
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      bid.status === "ACCEPTED"
                        ? "bg-emerald-100 text-emerald-700"
                        : bid.status === "REJECTED"
                        ? "bg-rose-100 text-rose-600"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}
                  >
                    {bid.status === "ACCEPTED"
                      ? "Принята"
                      : bid.status === "REJECTED"
                      ? "Отклонена"
                      : "Ожидает"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create order form ───────────────────────────────────────────────────────

function CreateOrderForm({
  user,
  onCreated,
}: {
  user: SessionUser | null;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();

  const [form, setForm] = useState({
    title: "",
    description: "",
    startCity: "",
    startAddress: "",
    startLat: 0,
    startLon: 0,
    endCity: "",
    endAddress: "",
    endLat: 0,
    endLon: 0,
    budget: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mut = useMutation({
    mutationFn: () =>
      createMarketplaceOrder({
        title: form.title,
        description: form.description || undefined,
        startCity: form.startCity,
        startAddress: form.startAddress || form.startCity,
        startLat: form.startLat || 55.75,
        startLon: form.startLon || 37.62,
        endCity: form.endCity,
        endAddress: form.endAddress || form.endCity,
        endLat: form.endLat || 59.93,
        endLon: form.endLon || 30.32,
        budget: form.budget ? Number(form.budget) : undefined,
      }),
    onSuccess: () => {
      toast.success("Заказ размещён на бирже");
      setForm({
        title: "",
        description: "",
        startCity: "",
        startAddress: "",
        startLat: 0,
        startLon: 0,
        endCity: "",
        endAddress: "",
        endLat: 0,
        endLon: 0,
        budget: "",
      });
      qc.invalidateQueries({ queryKey: ["marketplace-open"] });
      qc.invalidateQueries({ queryKey: ["marketplace-my"] });
      onCreated();
    },
    onError: () => toast.error("Ошибка при создании заказа"),
  });

  function validate() {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = "Введите заголовок";
    if (!form.startCity.trim()) e.startCity = "Укажите город отправления";
    if (!form.endCity.trim()) e.endCity = "Укажите город назначения";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit() {
    if (!user) {
      toast.error("Войдите, чтобы создать заказ");
      router.push("/login");
      return;
    }
    if (validate()) mut.mutate();
  }

  const isAuthenticated = !!user;

  return (
    <div className="max-w-2xl">
      {!isAuthenticated && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-5 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-amber-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">
              Необходима авторизация
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Войдите в аккаунт, чтобы разместить заказ на бирже.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-2 transition-colors shrink-0"
          >
            <LogIn className="h-3.5 w-3.5" />
            Войти
          </Link>
        </div>
      )}

      <div className="rounded-2xl border border-sand bg-white shadow-sm p-6 space-y-5">
        <div>
          <p className="font-bold text-plum">Новый заказ</p>
          <p className="text-sm text-warmsilver mt-0.5">
            Заполните детали — водители предложат свои условия
          </p>
        </div>

        {/* title */}
        <div>
          <label className="block text-xs font-medium text-olive mb-1">
            Заголовок *
          </label>
          <input
            value={form.title}
            onChange={(e) => {
              setForm({ ...form, title: e.target.value });
              if (errors.title) setErrors({ ...errors, title: "" });
            }}
            placeholder="Перевозка груза Москва → Санкт-Петербург"
            className={`w-full rounded-xl border px-3 py-2.5 text-sm text-plum placeholder:text-warmsilver outline-none transition focus:ring-2 ${
              errors.title
                ? "border-rose-400 bg-rose-50 focus:border-rose-400 focus:ring-rose-100"
                : "border-sand bg-fog/40 focus:border-emerald-500 focus:ring-emerald-100"
            }`}
          />
          {errors.title && (
            <p className="text-xs text-rose-500 mt-1">{errors.title}</p>
          )}
        </div>

        {/* description */}
        <div>
          <label className="block text-xs font-medium text-olive mb-1">
            Описание (необязательно)
          </label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Тип груза, требования к ТС, особые условия..."
            rows={3}
            className="w-full rounded-xl border border-sand bg-fog/40 px-3 py-2.5 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition resize-none"
          />
        </div>

        {/* cities */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CityInput
            label="Откуда"
            value={form.startCity}
            onChange={(v) => {
              setForm({ ...form, startCity: v });
              if (errors.startCity) setErrors({ ...errors, startCity: "" });
            }}
            onSelect={(r) =>
              setForm({
                ...form,
                startCity: r.city || r.displayName,
                startAddress: r.address || r.displayName,
                startLat: r.lat,
                startLon: r.lon,
              })
            }
            placeholder="Москва"
            isAuthenticated={isAuthenticated}
          />
          <CityInput
            label="Куда"
            value={form.endCity}
            onChange={(v) => {
              setForm({ ...form, endCity: v });
              if (errors.endCity) setErrors({ ...errors, endCity: "" });
            }}
            onSelect={(r) =>
              setForm({
                ...form,
                endCity: r.city || r.displayName,
                endAddress: r.address || r.displayName,
                endLat: r.lat,
                endLon: r.lon,
              })
            }
            placeholder="Санкт-Петербург"
            isAuthenticated={isAuthenticated}
          />
        </div>
        <div className="flex gap-2 -mt-1">
          {errors.startCity && (
            <p className="text-xs text-rose-500 flex-1">{errors.startCity}</p>
          )}
          {errors.endCity && (
            <p className="text-xs text-rose-500 flex-1">{errors.endCity}</p>
          )}
        </div>

        {/* budget */}
        <div>
          <label className="block text-xs font-medium text-olive mb-1">
            Бюджет ₽ (необязательно)
          </label>
          <input
            type="number"
            value={form.budget}
            onChange={(e) => setForm({ ...form, budget: e.target.value })}
            placeholder="20 000"
            className="w-full rounded-xl border border-sand bg-fog/40 px-3 py-2.5 text-sm text-plum placeholder:text-warmsilver outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition"
          />
          <p className="text-xs text-warmsilver mt-1">
            Оставьте пустым, чтобы принять любую ставку
          </p>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={mut.isPending}
          className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 flex items-center justify-center gap-2 transition-colors"
        >
          {mut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Разместить заказ
        </button>
      </div>
    </div>
  );
}

// ─── My bids tab ─────────────────────────────────────────────────────────────

function MyBidsTab({ user }: { user: SessionUser | null }) {
  const {
    data: bids = [],
    isLoading,
    isError,
  } = useQuery<MarketplaceBid[]>({
    queryKey: ["my-bids"],
    queryFn: getMyBids,
    enabled: !!user,
    refetchInterval: 20_000,
  });

  if (!user) {
    return (
      <div className="rounded-2xl border border-sand bg-white shadow-sm p-10 flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-fog flex items-center justify-center">
          <Truck className="h-7 w-7 text-warmsilver" />
        </div>
        <div className="text-center">
          <p className="font-semibold text-plum">Войдите, чтобы видеть ставки</p>
          <p className="text-sm text-warmsilver mt-1">
            Раздел доступен после авторизации
          </p>
        </div>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 transition-colors"
        >
          <LogIn className="h-4 w-4" />
          Войти
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <SkeletonOrderCard key={i} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
        <p className="text-sm text-rose-700">
          Не удалось загрузить ставки. Попробуйте позже.
        </p>
      </div>
    );
  }

  if (bids.length === 0) {
    return (
      <div className="rounded-2xl border border-sand bg-white shadow-sm p-10 flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-fog flex items-center justify-center">
          <Truck className="h-7 w-7 text-warmsilver" />
        </div>
        <div className="text-center">
          <p className="font-semibold text-plum">
            Вы ещё не подавали ставок
          </p>
          <p className="text-sm text-warmsilver mt-1">
            Перейдите в «Все заказы» и откликнитесь на подходящий маршрут
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {bids.map((bid) => (
        <div
          key={bid.id}
          className="rounded-2xl border border-sand bg-white shadow-sm p-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-warmsilver mb-0.5">
                Заказ #{bid.orderId}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                {bid.proposedPrice && (
                  <span className="text-sm font-bold text-plum">
                    {bid.proposedPrice.toLocaleString("ru-RU")} ₽
                  </span>
                )}
                {bid.estimatedTime && (
                  <span className="text-xs text-warmsilver flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {bid.estimatedTime} мин
                  </span>
                )}
              </div>
              {bid.message && (
                <p className="text-xs text-olive mt-1">{bid.message}</p>
              )}
              <p className="text-xs text-warmsilver mt-1.5">
                {formatRelative(bid.createdAt)}
              </p>
            </div>

            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 ${
                bid.status === "ACCEPTED"
                  ? "bg-emerald-100 text-emerald-700"
                  : bid.status === "REJECTED"
                  ? "bg-rose-100 text-rose-600"
                  : "bg-amber-50 text-amber-700 border border-amber-200"
              }`}
            >
              {bid.status === "ACCEPTED"
                ? "Принята"
                : bid.status === "REJECTED"
                ? "Отклонена"
                : "Ожидает"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type TabId = "browse" | "my" | "create" | "bids";

export default function MarketplacePage() {
  const qc = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("browse");

  useEffect(() => {
    const stored = getStoredUser();
    setUser(stored);
    setReady(true);
  }, []);

  // Open orders — public
  const {
    data: openOrders = [],
    isLoading: openLoading,
    isError: openError,
    refetch: refetchOpen,
  } = useQuery<MarketplaceOrder[]>({
    queryKey: ["marketplace-open"],
    queryFn: () => getMarketplaceOrders("OPEN"),
    enabled: ready,
    refetchInterval: 20_000,
  });

  // My orders — auth required
  const {
    data: allOrders = [],
    isLoading: myLoading,
  } = useQuery<MarketplaceOrder[]>({
    queryKey: ["marketplace-my"],
    queryFn: () => getMarketplaceOrders(),
    enabled: ready && !!user,
    refetchInterval: 20_000,
  });

  const myOrders = user
    ? allOrders.filter((o) => o.createdBy.id === user.id)
    : [];

  // Mutations
  const acceptMut = useMutation({
    mutationFn: ({ orderId, bidId }: { orderId: number; bidId: number }) =>
      acceptBid(orderId, bidId),
    onSuccess: () => {
      toast.success("Ставка принята");
      qc.invalidateQueries({ queryKey: ["marketplace-my"] });
      qc.invalidateQueries({ queryKey: ["marketplace-open"] });
    },
    onError: () => toast.error("Не удалось принять ставку"),
  });

  const completeMut = useMutation({
    mutationFn: (id: number) => completeMarketplaceOrder(id),
    onSuccess: () => {
      toast.success("Заказ завершён");
      qc.invalidateQueries({ queryKey: ["marketplace-my"] });
    },
    onError: () => toast.error("Не удалось завершить заказ"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteMarketplaceOrder(id),
    onSuccess: () => {
      toast.success("Заказ удалён");
      qc.invalidateQueries({ queryKey: ["marketplace-my"] });
    },
    onError: () => toast.error("Не удалось удалить заказ"),
  });

  const tabs: { id: TabId; label: string }[] = [
    { id: "browse", label: "Все заказы" },
    { id: "my", label: "Мои заказы" },
    { id: "create", label: "Создать заказ" },
    { id: "bids", label: "Мои ставки" },
  ];

  return (
    <div className="min-h-screen bg-fog">
      {/* ── Sticky header ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white border-b border-sand">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-xl font-bold tracking-tight text-plum select-none"
            >
              VELTO
            </Link>
            <div className="hidden sm:block w-px h-5 bg-sand" />
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-olive leading-tight">
                Биржа грузов
              </p>
              <p className="text-xs text-warmsilver leading-tight">
                Свободный рынок грузоперевозок
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* open orders chip */}
            <div className="hidden sm:flex items-center gap-1.5 rounded-xl bg-fog border border-sand px-3 py-1.5 text-sm">
              <Package className="h-3.5 w-3.5 text-emerald-600" />
              <span className="font-bold text-plum">
                {openOrders.length}
              </span>
              <span className="text-warmsilver">открытых</span>
            </div>

            {user ? (
              <span className="text-sm text-olive font-medium hidden sm:block">
                {user.name}
              </span>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-xl bg-plum hover:bg-olive text-white text-sm font-semibold px-3 py-1.5 transition-colors"
              >
                <LogIn className="h-3.5 w-3.5" />
                Войти
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* ── Tab bar ─────────────────────────────────────────────────── */}
        <div className="bg-fog rounded-2xl border border-sand p-1 flex gap-0.5 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-white text-plum shadow-sm"
                  : "text-warmsilver hover:text-olive"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Все заказы ─────────────────────────────────────────── */}
        {activeTab === "browse" && (
          <div className="space-y-3">
            {openLoading && (
              <>
                <SkeletonOrderCard />
                <SkeletonOrderCard />
                <SkeletonOrderCard />
              </>
            )}

            {openError && !openLoading && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-rose-700">
                    Сервис временно недоступен
                  </p>
                  <p className="text-xs text-rose-500 mt-0.5">
                    Не удалось загрузить заказы с биржи.
                  </p>
                  <button
                    type="button"
                    onClick={() => refetchOpen()}
                    className="mt-2 text-xs text-rose-600 hover:text-rose-700 underline flex items-center gap-1"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Повторить
                  </button>
                </div>
              </div>
            )}

            {!openLoading && !openError && openOrders.length === 0 && (
              <div className="rounded-2xl border border-sand bg-white shadow-sm p-10 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-fog flex items-center justify-center">
                  <Package className="h-7 w-7 text-warmsilver" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-plum">
                    Нет открытых заказов
                  </p>
                  <p className="text-sm text-warmsilver mt-1">
                    Разместите первый заказ, чтобы начать
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("create")}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Создать заказ
                </button>
              </div>
            )}

            {!openLoading &&
              openOrders.map((order) => (
                <OpenOrderCard key={order.id} order={order} user={user} />
              ))}
          </div>
        )}

        {/* ── Tab: Мои заказы ─────────────────────────────────────────── */}
        {activeTab === "my" && (
          <div className="space-y-3">
            {!user && (
              <div className="rounded-2xl border border-sand bg-white shadow-sm p-10 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-fog flex items-center justify-center">
                  <User className="h-7 w-7 text-warmsilver" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-plum">Требуется вход</p>
                  <p className="text-sm text-warmsilver mt-1">
                    Войдите, чтобы управлять своими заказами
                  </p>
                </div>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 transition-colors"
                >
                  <LogIn className="h-4 w-4" />
                  Войти
                </Link>
              </div>
            )}

            {user && myLoading && (
              <>
                <SkeletonOrderCard />
                <SkeletonOrderCard />
              </>
            )}

            {user && !myLoading && myOrders.length === 0 && (
              <div className="rounded-2xl border border-sand bg-white shadow-sm p-10 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-fog flex items-center justify-center">
                  <Package className="h-7 w-7 text-warmsilver" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-plum">У вас нет заказов</p>
                  <p className="text-sm text-warmsilver mt-1">
                    Создайте первый заказ — водители предложат свои условия
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("create")}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Создать заказ
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {user &&
              !myLoading &&
              myOrders.map((order) => (
                <MyOrderCard
                  key={order.id}
                  order={order}
                  onAccept={(bidId) =>
                    acceptMut.mutate({ orderId: order.id, bidId })
                  }
                  onComplete={() => completeMut.mutate(order.id)}
                  onDelete={() => deleteMut.mutate(order.id)}
                  acceptLoading={acceptMut.isPending}
                  completeLoading={completeMut.isPending}
                  deleteLoading={deleteMut.isPending}
                />
              ))}
          </div>
        )}

        {/* ── Tab: Создать заказ ───────────────────────────────────────── */}
        {activeTab === "create" && (
          <CreateOrderForm
            user={user}
            onCreated={() => setActiveTab("my")}
          />
        )}

        {/* ── Tab: Мои ставки ─────────────────────────────────────────── */}
        {activeTab === "bids" && <MyBidsTab user={user} />}
      </div>
    </div>
  );
}
