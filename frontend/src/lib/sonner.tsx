"use client";

import { useEffect, useMemo, useState } from "react";

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
  // Sonner supports many more props. Keep it permissive so we don't block usage.
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
  listeners.forEach((listener) => listener(toast));
}

function createId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function pushToast(
  variant: ToastVariant,
  title: string,
  options?: { description?: string; duration?: number },
) {
  const durationMs = Math.max(
    1200,
    Math.round((options?.duration ?? defaultDurationMs(variant)) * 1),
  );

  const item: ToastItem = {
    id: createId(),
    variant,
    title,
    description: options?.description,
    createdAt: Date.now(),
    durationMs,
  };

  emit(item);
  return item.id;
}

function defaultDurationMs(variant: ToastVariant) {
  if (variant === "error") return 5200;
  if (variant === "success") return 3400;
  return 3200;
}

export const toast = {
  message: (title: string, options?: { description?: string; duration?: number }) =>
    pushToast("message", title, options),
  success: (title: string, options?: { description?: string; duration?: number }) =>
    pushToast("success", title, options),
  error: (title: string, options?: { description?: string; duration?: number }) =>
    pushToast("error", title, options),
};

export function Toaster(props: ToasterProps) {
  const {
    className,
    position = "bottom-right",
    duration,
    visibleToasts = 4,
    toastOptions,
  } = props;

  const toastClassName = toastOptions?.classNames?.toast;
  const descriptionClassName = toastOptions?.classNames?.description;

  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: ToastListener = (toastItem) => {
      const derived: ToastItem = {
        ...toastItem,
        durationMs:
          typeof duration === "number"
            ? Math.max(1200, duration)
            : toastItem.durationMs,
      };

      setItems((current) => {
        const next = [derived, ...current];
        return next.slice(0, Math.max(1, visibleToasts));
      });
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [duration, visibleToasts]);

  useEffect(() => {
    if (!items.length) return;
    const timers = items.map((item) =>
      window.setTimeout(() => {
        setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      }, item.durationMs),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [items]);

  const containerClassName = useMemo(() => {
    const base = "fixed z-[9999] flex max-w-[min(420px,calc(100vw-2rem))] flex-col gap-2 p-4";
    const placement =
      position === "top-left"
        ? "left-0 top-0 items-start"
        : position === "top-right"
          ? "right-0 top-0 items-end"
          : position === "bottom-left"
            ? "left-0 bottom-0 items-start"
            : "right-0 bottom-0 items-end";

    return `${base} ${placement} ${className || ""}`.trim();
  }, [className, position]);

  if (!items.length) return null;

  return (
    <div className={containerClassName} aria-live="polite" aria-relevant="additions">
      {items.map((item) => (
        <div
          key={item.id}
          className={
            toastClassName ||
            "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-lg"
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-6">
                {variantLabel(item.variant)}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                {item.title}
              </p>
              {item.description ? (
                <p
                  className={
                    descriptionClassName ||
                    "mt-1 text-xs leading-5 text-slate-500"
                  }
                >
                  {item.description}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function variantLabel(variant: ToastVariant) {
  if (variant === "success") return "Success";
  if (variant === "error") return "Error";
  return "Message";
}
