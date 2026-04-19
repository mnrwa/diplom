"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import DriverWorkspace from "@/components/driver/DriverWorkspace";
import { Card } from "@/components/ui/card";
import { getDriver } from "@/lib/api";
import { getStoredUser } from "@/lib/session";

export default function DriverAdminPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role === "DRIVER") {
      router.replace("/lk");
      return;
    }
    setReady(true);
  }, [router]);

  const driverId = Number(params?.id);
  const { data, isLoading, error } = useQuery({
    queryKey: ["driver", driverId],
    queryFn: () => getDriver(driverId),
    enabled: ready && Number.isFinite(driverId) && driverId > 0,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  if (!ready || isLoading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 py-8">
        <Card className="p-10 text-gray-600">Загружаем карточку водителя...</Card>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 py-8">
        <Card className="p-10 text-gray-600">Водитель не найден.</Card>
      </main>
    );
  }

  return <DriverWorkspace driver={data} mode="admin" />;
}

