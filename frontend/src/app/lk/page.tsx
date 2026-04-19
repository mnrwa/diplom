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
import { LogOut } from "lucide-react";
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
    loading: () => (
      <main className="mx-auto flex min-h-screen max-w-7xl items-center px-4 py-8 md:px-6">
        <div className="w-full rounded-[20px] border border-sand bg-white p-10 text-olive">
          Загружаем диспетчерскую...
        </div>
      </main>
    ),
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
    return (
      <main className="mx-auto flex min-h-screen max-w-7xl items-center px-4 py-8 md:px-6">
        <div className="w-full rounded-[20px] border border-sand bg-white p-10 text-olive">
          Открываем личный кабинет...
        </div>
      </main>
    );
  }

  // ── Кабинет водителя ──────────────────────────────────────────────────────
  if (user.role === "DRIVER") {
    if (driverLoading || !driverData) {
      return (
        <>
          <div className="mx-auto flex w-full max-w-7xl justify-end px-4 pt-5 md:px-6">
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-2xl bg-sand px-4 py-2 text-sm text-olive transition hover:bg-warmlight"
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </button>
          </div>
          <main className="mx-auto flex min-h-screen max-w-7xl items-center px-4 py-8 md:px-6">
            <div className="w-full rounded-[20px] border border-sand bg-white p-10 text-olive">
              Загружаем кабинет водителя...
            </div>
          </main>
        </>
      );
    }

    return (
      <>
        <div className="mx-auto flex w-full max-w-7xl justify-end px-4 pt-5 md:px-6">
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-2xl bg-sand px-4 py-2 text-sm text-olive transition hover:bg-warmlight"
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
