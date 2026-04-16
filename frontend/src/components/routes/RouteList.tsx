"use client";

import { deleteRoute, recalcRoute } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";

const riskLabel = (score: number) =>
  score >= 0.7
    ? { text: "Высокий", color: "var(--danger)" }
    : score >= 0.4
      ? { text: "Средний", color: "var(--warning)" }
      : { text: "Низкий", color: "var(--success)" };

const statusLabel: Record<string, { text: string; color: string }> = {
  PLANNED: { text: "Запланирован", color: "#9ecbff" },
  ACTIVE: { text: "Активный", color: "var(--success)" },
  COMPLETED: { text: "Завершён", color: "var(--text-dim)" },
  CANCELLED: { text: "Отменён", color: "var(--danger)" },
  RECALCULATING: { text: "Пересчитывается", color: "var(--warning)" },
};

export default function RouteList({
  routes,
  onRefresh,
}: {
  routes: any[];
  onRefresh: () => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);

  const recalculate = useMutation({
    mutationFn: (id: number) => recalcRoute(id),
    onSuccess: () => {
      onRefresh();
      queryClient.invalidateQueries({ queryKey: ["routes"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteRoute(id),
    onSuccess: () => {
      onRefresh();
      queryClient.invalidateQueries({ queryKey: ["routes"] });
    },
  });

  return (
    <div style={{ padding: 28, minHeight: 640 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        <div>
          <p className="section-kicker">Route control</p>
          <h2 style={{ margin: "10px 0 0", fontFamily: "var(--font-display)", fontSize: 30 }}>
            Маршруты и статусы
          </h2>
        </div>

        <button
          onClick={onRefresh}
          className="glass-button ghost-button"
          style={{ paddingInline: 16 }}
        >
          <RefreshCw size={16} />
          Обновить
        </button>
      </div>

      {routes.length === 0 && (
        <div className="empty-state">Маршрутов пока нет. Создайте первый маршрут из dashboard.</div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        {routes.map((route: any) => {
          const risk = riskLabel(route.riskScore || 0);
          const status = statusLabel[route.status] || {
            text: route.status,
            color: "var(--text-dim)",
          };
          const isOpen = expanded === route.id;

          return (
            <article
              key={route.id}
              style={{
                borderRadius: 24,
                overflow: "hidden",
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${isOpen ? "rgba(111,220,255,0.38)" : "rgba(255,255,255,0.08)"}`,
                boxShadow: isOpen ? "0 18px 42px rgba(2,8,20,0.24)" : "none",
              }}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => setExpanded(isOpen ? null : route.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setExpanded(isOpen ? null : route.id);
                  }
                }}
                style={{
                  width: "100%",
                  border: 0,
                  cursor: "pointer",
                  color: "inherit",
                  background: "transparent",
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) auto auto",
                  gap: 16,
                  alignItems: "center",
                  padding: 20,
                  textAlign: "left",
                }}
              >
                <div>
                  <strong style={{ display: "block", fontSize: 18 }}>{route.name}</strong>
                  <span style={{ color: "var(--text-dim)", fontSize: 14 }}>
                    {route.vehicle?.plateNumber || "Транспорт не назначен"} •{" "}
                    {route.estimatedTime ? `~${route.estimatedTime} мин` : "ETA не рассчитан"}
                  </span>
                </div>

                <span
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    color: status.color,
                    background: "rgba(255,255,255,0.05)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {status.text}
                </span>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      color: risk.color,
                      background: `${risk.color}18`,
                      border: `1px solid ${risk.color}2c`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {risk.text} {route.riskScore != null ? `${Math.round(route.riskScore * 100)}%` : ""}
                  </span>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      recalculate.mutate(route.id);
                    }}
                    style={iconButtonStyle("var(--accent)")}
                    title="Пересчитать маршрут"
                  >
                    <RefreshCw size={15} className={recalculate.isPending ? "spin" : ""} />
                  </button>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      remove.mutate(route.id);
                    }}
                    style={iconButtonStyle("var(--danger)")}
                    title="Удалить маршрут"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {isOpen && (
                <div
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    padding: 20,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 14,
                  }}
                >
                  <Detail label="Старт" value={`${route.startLat.toFixed(4)}, ${route.startLon.toFixed(4)}`} />
                  <Detail label="Финиш" value={`${route.endLat.toFixed(4)}, ${route.endLon.toFixed(4)}`} />
                  <Detail label="Статус" value={status.text} />
                  <Detail
                    label="Оценка риска"
                    value={route.riskScore != null ? `${Math.round(route.riskScore * 100)}%` : "—"}
                  />
                  {route.riskFactors && (
                    <>
                      <Detail label="Погодный фактор" value={`${Math.round((route.riskFactors.weather || 0) * 100)}%`} />
                      <Detail label="Новостной фактор" value={`${Math.round((route.riskFactors.news || 0) * 100)}%`} />
                      <Detail label="Ночной режим" value={route.riskFactors.night_hours ? "Да" : "Нет"} />
                      <Detail label="Дистанция" value={`${route.riskFactors.distance_km || "—"} км`} />
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 18,
        background: "rgba(255,255,255,0.035)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <span style={{ color: "var(--text-dim)", fontSize: 13 }}>{label}</span>
      <strong style={{ display: "block", marginTop: 8 }}>{value}</strong>
    </div>
  );
}

function iconButtonStyle(color: string) {
  return {
    width: 38,
    height: 38,
    display: "grid",
    placeItems: "center",
    borderRadius: 14,
    cursor: "pointer",
    color,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
  } as const;
}
