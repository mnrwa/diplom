"use client";

/**
 * /lk — единая точка входа в личный кабинет.
 * Роль определяется из localStorage (данные сохраняются после логина).
 * Токен хранится в httpOnly cookie — axios отправляет его автоматически.
 *
 * DRIVER       → кабинет водителя (DriverWorkspace)
 * ADMIN / DISPATCHER → диспетчерская (DashboardPage)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import DriverWorkspace from "@/components/driver/DriverWorkspace";
import { getMyDriverProfile, logoutApi } from "@/lib/api";
import { clearSession, getStoredUser } from "@/lib/session";
import type { SessionUser } from "@/lib/api";

// Lazy-import of the dispatcher dashboard to keep the driver bundle lean
import dynamic from "next/dynamic";

const DashboardPage = dynamic(
  () => import("@/app/dashboard/page"),
  {
    loading: () => <LoadingScreen label="Загружаем диспетчерскую..." />,
    ssr: false,
  },
);

export default function LkPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) {
      router.replace("/login");
      return;
    }
    setUser(stored);
    setReady(true);
  }, [router]);

  // Driver profile — only fetched for DRIVER role
  const { data: driverData, isLoading: driverLoading } = useQuery({
    queryKey: ["driver-me"],
    queryFn: getMyDriverProfile,
    enabled: ready && user?.role === "DRIVER",
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const handleLogout = async () => {
    try {
      await logoutApi();
    } catch {
      // ignore
    }
    clearSession();
    router.replace("/");
  };

  if (!ready || !user) {
    return <LoadingScreen label="Открываем личный кабинет..." />;
  }

  // ── Кабинет водителя ──────────────────────────────────────────────────────
  if (user.role === "DRIVER") {
    if (driverLoading || !driverData) {
      return <LoadingScreen label="Загружаем кабинет водителя..." onLogout={handleLogout} />;
    }

    return (
      <>
        <div className="flex w-full justify-end px-4 pt-4 md:px-6">
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-xl border border-sand bg-white px-3 py-2 text-sm text-olive shadow-card transition hover:bg-fog"
          >
            <LogOut className="h-4 w-4" />
            Выйти
          </button>
        </div>
        <DriverWorkspace
          driver={driverData}
          mode="driver"
          vehicleId={driverData.vehicle?.id ?? null}
          routeId={driverData.activeRoute?.id ?? null}
        />
      </>
    );
  }

  // ── Диспетчерская (ADMIN / DISPATCHER) ────────────────────────────────────
  return <DashboardPage />;
}

function LoadingScreen({ label, onLogout }: { label: string; onLogout?: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-fog">
      {onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-xl border border-sand bg-white px-3 py-2 text-sm text-olive shadow-card hover:bg-white/80"
        >
          <LogOut className="h-4 w-4" />
          Выйти
        </button>
      )}
      <span className="text-[11px] font-bold tracking-[0.12em] text-plum/40 uppercase select-none">
        VELTO
      </span>
      <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      <p className="text-sm text-warmsilver">{label}</p>
    </div>
  );
}
