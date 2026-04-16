"use client";

import DriverWorkspace from "@/components/driver/DriverWorkspace";
import { getMyDriverProfile } from "@/lib/api";
import { clearSession, getStoredToken, getStoredUser } from "@/lib/session";
import { useQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function DriverPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    const user = getStoredUser();

    if (!token || !user) {
      router.replace("/login");
      return;
    }

    if (user.role !== "DRIVER") {
      router.replace("/dashboard");
      return;
    }

    setReady(true);
  }, [router]);

  const { data, isLoading } = useQuery({
    queryKey: ["driver-me"],
    queryFn: getMyDriverProfile,
    enabled: ready,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  if (!ready || isLoading || !data) {
    return (
      <main className="mx-auto flex min-h-screen max-w-7xl items-center px-4 py-8 md:px-6">
        <div className="w-full rounded-[36px] border border-white/70 bg-white/90 p-10 text-slate-600 shadow-[0_30px_90px_rgba(148,163,184,0.18)]">
          Загружаем кабинет водителя...
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="mx-auto flex w-full max-w-7xl justify-end px-4 pt-5 md:px-6">
        <button
          type="button"
          onClick={() => {
            clearSession();
            router.replace("/");
          }}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-[0_20px_40px_rgba(148,163,184,0.14)]"
        >
          <LogOut className="h-4 w-4" />
          Выйти
        </button>
      </div>
      <DriverWorkspace driver={data} mode="driver" />
    </>
  );
}
