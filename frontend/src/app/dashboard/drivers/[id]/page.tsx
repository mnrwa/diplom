"use client";

import DriverWorkspace from "@/components/driver/DriverWorkspace";
import { getDriver } from "@/lib/api";
import { getStoredToken, getStoredUser } from "@/lib/session";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function DriverAdminPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getStoredToken();
    const user = getStoredUser();

    if (!token || !user) {
      router.replace("/login");
      return;
    }

    if (user.role === "DRIVER") {
      router.replace("/driver");
      return;
    }

    setReady(true);
  }, [router]);

  const { data, isLoading } = useQuery({
    queryKey: ["driver", params?.id],
    queryFn: () => getDriver(Number(params.id)),
    enabled: ready && Boolean(params?.id),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  if (!ready || isLoading || !data) {
    return (
      <main className="mx-auto flex min-h-screen max-w-7xl items-center px-4 py-8 md:px-6">
        <div className="w-full rounded-[36px] border border-white/70 bg-white/90 p-10 text-slate-600 shadow-[0_30px_90px_rgba(148,163,184,0.18)]">
          Загружаем карточку водителя...
        </div>
      </main>
    );
  }

  return <DriverWorkspace driver={data} mode="admin" />;
}
