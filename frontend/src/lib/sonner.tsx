"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

export type ToasterProps = {
  theme?: "light" | "dark" | "system";
  className?: string;
  toastOptions?: {
    classNames?: {
      toast?: string;
      description?: string;
      actionButton?: string;
      cancelButton?: string;
    };
  };
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  duration?: number;
  visibleToasts?: number;
  richColors?: boolean;
  closeButton?: boolean;
  expand?: boolean;
  offset?: string | number;
  [key: string]: any;
};

type ToastVariant = "message" | "success" | "error";

type ToastItem = {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  createdAt: number;
  durationMs: number;
};

type ToastListener = (toast: ToastItem) => void;

const listeners = new Set<ToastListener>();

function emit(toast: ToastItem) {
  listeners.forEach((l) => l(toast));
}

function createId() {
  try { return crypto.randomUUID(); }
  catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

function defaultDurationMs(variant: ToastVariant) {
  if (variant === "error") return 5500;
  if (variant === "success") return 3500;
  return 3500;
}

function pushToast(variant: ToastVariant, title: string, options?: { description?: string; duration?: number }) {
  const durationMs = Math.max(1200, options?.duration ?? defaultDurationMs(variant));
  const item: ToastItem = { id: createId(), variant, title, description: options?.description, createdAt: Date.now(), durationMs };
  emit(item);
  return item.id;
}

export const toast = {
  message: (title: string, options?: { description?: string; duration?: number }) => pushToast("message", title, options),
  success: (title: string, options?: { description?: string; duration?: number }) => pushToast("success", title, options),
  error: (title: string, options?: { description?: string; duration?: number }) => pushToast("error", title, options),
};

const VARIANT_CONFIG = {
  success: {
    icon: CheckCircle2,
    label: "Успешно",
    bar: "bg-emerald-500",
    icon_color: "text-emerald-500",
    border: "border-emerald-100",
    bg: "bg-white",
  },
  error: {
    icon: XCircle,
    label: "Ошибка",
    bar: "bg-rose-500",
    icon_color: "text-rose-500",
    border: "border-rose-100",
    bg: "bg-white",
  },
  message: {
    icon: Info,
    label: "Уведомление",
    bar: "bg-sky-500",
    icon_color: "text-sky-500",
    border: "border-sky-100",
    bg: "bg-white",
  },
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [progress, setProgress] = useState(100);
  const cfg = VARIANT_CONFIG[item.variant];
  const Icon = cfg.icon;

  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / item.durationMs) * 100);
      setProgress(pct);
      if (pct > 0) requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [item.durationMs]);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl border ${cfg.border} ${cfg.bg} shadow-xl shadow-black/8 animate-in slide-in-from-right-4 fade-in duration-300`}
      style={{ minWidth: 300, maxWidth: 400 }}
    >
      {/* progress bar */}
      <div
        className={`absolute bottom-0 left-0 h-[3px] ${cfg.bar} transition-none`}
        style={{ width: `${progress}%` }}
      />

      <div className="flex items-start gap-3 px-4 py-3.5 pr-10">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${cfg.icon_color}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-800 leading-5">{cfg.label}</p>
          <p className="mt-0.5 text-[13px] leading-5 text-slate-600">{item.title}</p>
          {item.description && (
            <p className="mt-1 text-xs text-slate-400 leading-4">{item.description}</p>
          )}
        </div>
      </div>

      <button
        onClick={() => onDismiss(item.id)}
        className="absolute right-2.5 top-2.5 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
        aria-label="Закрыть"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function Toaster(props: ToasterProps) {
  const { className, position = "bottom-right", duration, visibleToasts = 5 } = props;
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = (id: string) => setItems((c) => c.filter((i) => i.id !== id));

  useEffect(() => {
    const listener: ToastListener = (toastItem) => {
      const derived: ToastItem = {
        ...toastItem,
        durationMs: typeof duration === "number" ? Math.max(1200, duration) : toastItem.durationMs,
      };
      setItems((c) => [derived, ...c].slice(0, Math.max(1, visibleToasts)));
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [duration, visibleToasts]);

  useEffect(() => {
    if (!items.length) return;
    const timers = items.map((item) =>
      window.setTimeout(() => dismiss(item.id), item.durationMs),
    );
    return () => { timers.forEach(clearTimeout); };
  }, [items]);

  const containerClassName = useMemo(() => {
    const base = "fixed z-[9999] flex max-w-[min(420px,calc(100vw-2rem))] flex-col gap-2 p-4";
    const placement =
      position === "top-left" ? "left-0 top-0 items-start"
      : position === "top-right" ? "right-0 top-0 items-end"
      : position === "bottom-left" ? "left-0 bottom-0 items-start"
      : "right-0 bottom-0 items-end";
    return `${base} ${placement} ${className || ""}`.trim();
  }, [className, position]);

  if (!items.length) return null;

  return (
    <div className={containerClassName} aria-live="polite" aria-relevant="additions">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>
  );
}
