"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import DriverWorkspace from "@/components/driver/DriverWorkspace";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDriver } from "@/lib/api";
import { getStoredUser } from "@/lib/session";
import type { SessionUser } from "@/lib/api";

async function exportDriverXls(data: Awaited<ReturnType<typeof getDriver>>) {
  const XLSX = await import("xlsx");

  const wb = XLSX.utils.book_new();

  // Sheet 1: Profile
  const profile = [
    ["ID", data.id],
    ["Имя", data.name],
    ["Email", data.email],
    ["Телефон", data.phone || "—"],
    ["Статус", data.status],
    ["Рейтинг", data.rating],
    ["Опыт (лет)", data.experienceYears],
    ["Категория", data.licenseCategory],
    ["Номер ВУ", data.licenseNumber || "—"],
    ["Транспорт", data.vehicle?.plateNumber || "—"],
    ["Телематический рейтинг", data.telematicsScore ?? "нет данных"],
    ["GPS (посл.)", data.latestPosition ? `${data.latestPosition.lat.toFixed(5)}, ${data.latestPosition.lon.toFixed(5)}` : "—"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(profile), "Профиль");

  // Sheet 2: Routes / Trips
  const routeHeaders = ["ID", "Название", "Статус", "Из", "В", "Дистанция (км)", "ETA (мин)", "Риск %"];
  const routeRows = (data.routes ?? []).map((r) => [
    r.id,
    r.name,
    r.status,
    r.startPoint?.name ?? `${r.startLat.toFixed(4)}, ${r.startLon.toFixed(4)}`,
    r.endPoint?.name ?? `${r.endLat.toFixed(4)}, ${r.endLon.toFixed(4)}`,
    r.distance?.toFixed(1) ?? "—",
    r.estimatedTime ?? "—",
    r.riskScore != null ? Math.round(r.riskScore * 100) : "—",
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([routeHeaders, ...routeRows]), "Маршруты");

  // Sheet 3: GPS track
  const trackHeaders = ["Широта", "Долгота", "Скорость (км/ч)", "Время"];
  const trackRows = (data.track ?? []).map((p) => [
    p.lat,
    p.lon,
    p.speed != null ? Math.round(p.speed) : "—",
    new Date(p.timestamp).toLocaleString("ru-RU"),
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([trackHeaders, ...trackRows]), "GPS-трек");

  XLSX.writeFile(wb, `driver_${data.id}_${data.name.replace(/\s+/g, "_")}.xlsx`);
}

export default function DriverAdminPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [ready, setReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    const user = getStoredUser();
    if (!user) { router.replace("/login"); return; }
    if (user.role === "DRIVER") { router.replace("/lk"); return; }
    setCurrentUser(user);
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

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 pt-4 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => exportDriverXls(data)}
        >
          <Download className="h-4 w-4" />
          Выгрузить XLS
        </Button>
      </div>
      <DriverWorkspace driver={data} mode="admin" currentUser={currentUser} />
    </>
  );
}
