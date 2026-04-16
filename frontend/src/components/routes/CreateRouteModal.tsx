"use client";

type Props = {
  onClose: () => void;
  onCreated: () => void;
  vehicles: any[];
};

export default function CreateRouteModal({ onClose }: Props) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        display: "grid",
        placeItems: "center",
        background: "rgba(15, 23, 42, 0.18)",
        backdropFilter: "blur(12px)",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(100%, 460px)",
          borderRadius: 28,
          background: "rgba(255,255,255,0.96)",
          border: "1px solid rgba(226,232,240,0.9)",
          padding: 24,
          boxShadow: "0 28px 80px rgba(148,163,184,0.24)",
        }}
      >
        <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.28em", textTransform: "uppercase", color: "#94a3b8" }}>
          Новый сценарий
        </p>
        <h3 style={{ margin: "14px 0 0", fontFamily: "var(--font-display)", fontSize: 28, color: "#0f172a" }}>
          Маршрут создаётся из админки
        </h3>
        <p style={{ margin: "14px 0 0", lineHeight: 1.8, color: "#475569" }}>
          В новой версии маршрут формируется от склада до ПВЗ, а не по широте и
          долготе. Используйте вкладку «Маршруты» на странице админки.
        </p>
        <button
          type="button"
          onClick={onClose}
          style={{
            marginTop: 20,
            width: "100%",
            border: 0,
            borderRadius: 999,
            padding: "14px 18px",
            background: "#0f172a",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Понятно
        </button>
      </div>
    </div>
  );
}
