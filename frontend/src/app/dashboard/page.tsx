"use client";

import MapView, { type MapLine, type MapPoint, type MapSelection } from "@/components/map/MapView";
import {
  createDriverAccount,
  createLocation,
  createRoute,
  getDrivers,
  getLocations,
  getPositions,
  getRiskEvents,
  getRoutes,
  getVehicles,
  type LocationPoint,
  type RouteSummary,
} from "@/lib/api";
import { clearSession, getStoredToken, getStoredUser } from "@/lib/session";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  LogOut,
  Plus,
  Route,
  Truck,
  UserRound,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type Tab = "overview" | "drivers" | "locations" | "routes" | "map";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "drivers", label: "Водители" },
  { id: "locations", label: "Склады и ПВЗ" },
  { id: "routes", label: "Маршруты" },
  { id: "map", label: "Карта" },
];

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [userName, setUserName] = useState("Диспетчер");
  const [tab, setTab] = useState<Tab>("overview");
  const [driverMessage, setDriverMessage] = useState("");
  const [driverForm, setDriverForm] = useState({
    name: "",
    email: "",
    password: "Driver123!",
    phone: "",
    vehicleId: "",
  });
  const [locationForm, setLocationForm] = useState({
    name: "",
    code: "",
    type: "WAREHOUSE" as "WAREHOUSE" | "PICKUP_POINT",
    city: "",
    address: "",
    notes: "",
  });
  const [locationCoordinates, setLocationCoordinates] = useState<[number, number] | null>(null);
  const [locationSelectionLabel, setLocationSelectionLabel] = useState(
    "Точка на карте пока не выбрана",
  );
  const [routeForm, setRouteForm] = useState({
    name: "",
    startPointId: "",
    endPointId: "",
    driverId: "",
    vehicleId: "",
  });

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

    setUserName(user.name || user.email);
    setReady(true);
  }, [router]);

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: getDrivers,
    enabled: ready,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const { data: routes = [] } = useQuery({
    queryKey: ["routes"],
    queryFn: getRoutes,
    enabled: ready,
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles"],
    queryFn: getVehicles,
    enabled: ready,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["locations"],
    queryFn: () => getLocations(),
    enabled: ready,
  });

  const { data: positions = [] } = useQuery({
    queryKey: ["positions"],
    queryFn: getPositions,
    enabled: ready,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const { data: riskEvents = [] } = useQuery({
    queryKey: ["risk-events"],
    queryFn: getRiskEvents,
    enabled: ready,
    refetchInterval: 45_000,
  });

  const createDriverMutation = useMutation({
    mutationFn: () =>
      createDriverAccount({
        ...driverForm,
        vehicleId: driverForm.vehicleId ? Number(driverForm.vehicleId) : undefined,
      }),
    onSuccess: (payload: any) => {
      setDriverMessage(
        `Доступ выдан: ${payload.credentials.email} / ${payload.credentials.password}`,
      );
      setDriverForm({
        name: "",
        email: "",
        password: "Driver123!",
        phone: "",
        vehicleId: "",
      });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    },
  });

  const createLocationMutation = useMutation({
    mutationFn: () =>
      createLocation({
        ...locationForm,
        lat: Number(locationCoordinates?.[1]),
        lon: Number(locationCoordinates?.[0]),
        code: locationForm.code || undefined,
        notes: locationForm.notes || undefined,
      }),
    onSuccess: () => {
      setLocationForm({
        name: "",
        code: "",
        type: "WAREHOUSE",
        city: "",
        address: "",
        notes: "",
      });
      setLocationCoordinates(null);
      setLocationSelectionLabel("Точка на карте пока не выбрана");
      queryClient.invalidateQueries({ queryKey: ["locations"] });
    },
  });

  const createRouteMutation = useMutation({
    mutationFn: () =>
      createRoute({
        name: routeForm.name,
        startPointId: Number(routeForm.startPointId),
        endPointId: Number(routeForm.endPointId),
        driverId: routeForm.driverId ? Number(routeForm.driverId) : undefined,
        vehicleId: routeForm.vehicleId ? Number(routeForm.vehicleId) : undefined,
      }),
    onSuccess: () => {
      setRouteForm({
        name: "",
        startPointId: "",
        endPointId: "",
        driverId: "",
        vehicleId: "",
      });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    },
  });

  const warehouses = locations.filter((item) => item.type === "WAREHOUSE");
  const pickupPoints = locations.filter((item) => item.type === "PICKUP_POINT");
  const selectedStartPoint =
    locations.find((item) => String(item.id) === routeForm.startPointId) || null;
  const selectedEndPoint =
    locations.find((item) => String(item.id) === routeForm.endPointId) || null;

  const routeLines = useMemo<MapLine[]>(
    () =>
      routes
        .map((route) => {
          const coordinates = buildRouteCoordinates(route);
          if (coordinates.length < 2) return null;
          return {
            id: `route-${route.id}`,
            name: route.name,
            color: routeColor(route.riskScore),
            coordinates,
          };
        })
        .filter(Boolean) as MapLine[],
    [routes],
  );

  const locationMapPoints = useMemo<MapPoint[]>(
    () =>
      locations.map((item) => ({
        id: `location-${item.id}`,
        entityId: item.id,
        kind: item.type === "WAREHOUSE" ? ("warehouse" as const) : ("pickup" as const),
        title: item.name,
        subtitle: `${item.city}, ${item.address}`,
        longitude: item.lon,
        latitude: item.lat,
      })),
    [locations],
  );

  const mapPoints = useMemo<MapPoint[]>(() => {
    const vehiclePoints = positions
      .filter((item: any) => item?.position)
      .map((item: any) => ({
        id: `vehicle-${item.vehicleId}`,
        kind: "vehicle" as const,
        title: item.driverName || item.plateNumber,
        subtitle: item.route?.name || item.plateNumber,
        longitude: item.position.lon,
        latitude: item.position.lat,
        speed: item.position.speed,
      }));

    return [...locationMapPoints, ...vehiclePoints];
  }, [locationMapPoints, positions]);

  const routeDraftLines = useMemo<MapLine[]>(
    () =>
      selectedStartPoint && selectedEndPoint
        ? [
            {
              id: "draft-route",
              name: "Черновик маршрута",
              color: "#0f766e",
              coordinates: [
                [selectedStartPoint.lon, selectedStartPoint.lat],
                [selectedEndPoint.lon, selectedEndPoint.lat],
              ],
            },
          ]
        : [],
    [selectedEndPoint, selectedStartPoint],
  );

  const highlightedRoutePointIds = useMemo(
    () =>
      [routeForm.startPointId, routeForm.endPointId]
        .filter(Boolean)
        .map((value) => `location-${value}`),
    [routeForm.endPointId, routeForm.startPointId],
  );

  const handleLocationPick = (selection: MapSelection) => {
    setLocationCoordinates([selection.longitude, selection.latitude]);
    setLocationSelectionLabel(
      selection.source === "object"
        ? selection.label || "Выбран объект карты 2GIS"
        : selection.source === "point"
          ? selection.pointTitle || selection.label || "Выбрана существующая точка"
          : selection.label || "Выбрана новая точка на карте",
    );
  };

  const handleRoutePointClick = (point: MapPoint) => {
    if (!point.entityId) return;

    if (point.kind === "warehouse") {
      setRouteForm((current) => ({
        ...current,
        startPointId: String(point.entityId),
        name:
          current.name ||
          (selectedEndPoint ? `Маршрут ${point.title} → ${selectedEndPoint.name}` : current.name),
      }));
      return;
    }

    if (point.kind === "pickup") {
      setRouteForm((current) => ({
        ...current,
        endPointId: String(point.entityId),
        name:
          current.name ||
          (selectedStartPoint ? `Маршрут ${selectedStartPoint.name} → ${point.title}` : current.name),
      }));
    }
  };

  const logout = () => {
    clearSession();
    router.replace("/");
  };

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-screen max-w-7xl items-center px-4 py-8 md:px-6">
        <div className="w-full rounded-[36px] border border-white/70 bg-white/90 p-10 text-slate-600 shadow-[0_30px_90px_rgba(148,163,184,0.18)]">
          Подготавливаем административный контур...
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 md:px-6">
      <section className="rounded-[36px] border border-white/70 bg-white/92 px-6 py-6 shadow-[0_30px_90px_rgba(148,163,184,0.18)] md:px-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-slate-400">
              Административный контур
            </p>
            <h1 className="mt-3 font-[Georgia] text-3xl text-slate-900 md:text-4xl">
              {userName}, управление логистической сетью
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">
              Здесь можно выдавать логины водителям, добавлять склады и ПВЗ кликом
              по карте, собирать маршруты через дорожную сеть и отслеживать моковые
              GPS-координаты в реальном времени.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setTab("routes")}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              Новый маршрут
            </button>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700"
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </button>
          </div>
        </div>
      </section>

      {riskEvents.length ? (
        <section className="mt-4 rounded-[28px] border border-amber-200 bg-amber-50/90 px-5 py-4 text-sm text-amber-800 shadow-[0_24px_60px_rgba(245,158,11,0.12)]">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              <strong className="block text-slate-900">{riskEvents[0].title}</strong>
              <span>{riskEvents[0].description}</span>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<UserRound className="h-5 w-5" />} label="Водителей" value={drivers.length} />
        <MetricCard icon={<Warehouse className="h-5 w-5" />} label="Точек сети" value={locations.length} />
        <MetricCard icon={<Route className="h-5 w-5" />} label="Маршрутов" value={routes.length} />
        <MetricCard
          icon={<Truck className="h-5 w-5" />}
          label="ТС в пути"
          value={vehicles.filter((item) => item.status === "ON_ROUTE").length}
        />
      </section>

      <section className="mt-4 flex flex-wrap gap-2 rounded-[30px] border border-white/70 bg-white/90 p-2 shadow-[0_30px_90px_rgba(148,163,184,0.16)]">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={
              item.id === tab
                ? "rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                : "rounded-full px-4 py-3 text-sm text-slate-500"
            }
          >
            {item.label}
          </button>
        ))}
      </section>

      {tab === "overview" ? (
        <section className="mt-4 grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
          <Panel title="Живая карта" kicker="2GIS / OSM">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-[Georgia] text-2xl text-slate-900">
                  Координаты транспорта, маршруты и точки сети
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">
                  При наличии `NEXT_PUBLIC_2GIS_KEY` карта работает на русском и
                  позволяет кликать по зданиям, POI и дорожным объектам.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTab("map")}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700"
              >
                На карту
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6">
              <MapView
                lines={routeLines}
                points={mapPoints}
                className="h-[520px] w-full rounded-[28px]"
              />
            </div>
          </Panel>

          <div className="grid gap-4">
            <Panel title="Водители в рейсе" kicker="Кадры">
              <div className="space-y-3">
                {drivers.slice(0, 4).map((driver) => (
                  <Link
                    key={driver.id}
                    href={`/dashboard/drivers/${driver.id}`}
                    className="block rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-4 transition hover:border-slate-300"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <strong className="block text-slate-900">{driver.name}</strong>
                        <span className="text-sm text-slate-500">
                          {driver.vehicle?.plateNumber || "Транспорт не назначен"}
                        </span>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500">
                        {driver.status}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </Panel>

            <Panel title="Активные маршруты" kicker="Маршруты">
              <div className="space-y-3">
                {routes.slice(0, 4).map((route) => {
                  const routeMeta = getRouteRoutingMeta(route);

                  return (
                    <div key={route.id} className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-4">
                      <strong className="block text-slate-900">{route.name}</strong>
                      <span className="mt-1 block text-sm text-slate-500">
                        {route.startPoint?.name || "Старт"} → {route.endPoint?.name || "Финиш"}
                      </span>
                      <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-white px-3 py-1">{route.status}</span>
                        <span className="rounded-full bg-white px-3 py-1">
                          Risk {Math.round((route.riskScore || 0) * 100)}%
                        </span>
                      </div>
                      {routeMeta ? (
                        <div className="mt-3 grid gap-1 text-xs text-slate-500">
                          <span>
                            Дорожная сеть: {routeMeta.sourceLabel} · средняя скорость{" "}
                            {routeMeta.avgSpeedKmh ?? "—"} км/ч
                          </span>
                          <span>
                            События по дороге: {routeMeta.eventCount} · альтернативы{" "}
                            {routeMeta.alternatives}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>
        </section>
      ) : null}

      {tab === "drivers" ? (
        <section className="mt-4 grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
          <Panel title="Выдать логин и пароль" kicker="Доступ">
            <div className="space-y-4">
              <Input label="Имя водителя" value={driverForm.name} onChange={(value) => setDriverForm((current) => ({ ...current, name: value }))} />
              <Input label="Email" value={driverForm.email} onChange={(value) => setDriverForm((current) => ({ ...current, email: value }))} />
              <Input label="Телефон" value={driverForm.phone} onChange={(value) => setDriverForm((current) => ({ ...current, phone: value }))} />
              <Input label="Пароль" value={driverForm.password} onChange={(value) => setDriverForm((current) => ({ ...current, password: value }))} />
              <SelectField
                label="Транспорт"
                value={driverForm.vehicleId}
                onChange={(value) => setDriverForm((current) => ({ ...current, vehicleId: value }))}
                options={[
                  { value: "", label: "Назначить позже" },
                  ...vehicles.map((vehicle) => ({
                    value: String(vehicle.id),
                    label: `${vehicle.plateNumber} · ${vehicle.model}`,
                  })),
                ]}
              />
            </div>

            {driverMessage ? (
              <div className="mt-4 rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {driverMessage}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => createDriverMutation.mutate()}
              disabled={!driverForm.name || !driverForm.email || !driverForm.password || createDriverMutation.isPending}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-4 text-sm font-semibold text-white disabled:opacity-70"
            >
              <Plus className="h-4 w-4" />
              Создать учётку водителя
            </button>
          </Panel>

          <Panel title="Карточки водителей" kicker="Состав">
            <div className="mb-4 rounded-[22px] border border-emerald-200/80 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700">
              Геопозиция водителей обновляется каждые 10 секунд на моковых GPS-данных.
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {drivers.map((driver) => (
                <Link
                  key={driver.id}
                  href={`/dashboard/drivers/${driver.id}`}
                  className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5 transition hover:border-slate-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{driver.name}</h3>
                      <p className="mt-1 text-sm text-slate-500">{driver.email}</p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500">
                      {driver.status}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm text-slate-600">
                    <span>ТС: {driver.vehicle?.plateNumber || "не назначено"}</span>
                    <span>Рейтинг: {driver.rating.toFixed(1)}</span>
                    <span>
                      GPS:{" "}
                      {driver.latestPosition
                        ? `${driver.latestPosition.lat.toFixed(3)}, ${driver.latestPosition.lon.toFixed(3)}`
                        : "данных пока нет"}
                    </span>
                    <span>
                      Скорость:{" "}
                      {typeof driver.latestPosition?.speed === "number"
                        ? `${Math.round(driver.latestPosition.speed)} км/ч`
                        : "—"}
                    </span>
                    <span>
                      Обновлено:{" "}
                      {driver.latestPosition?.timestamp
                        ? new Date(driver.latestPosition.timestamp).toLocaleTimeString("ru-RU")
                        : "—"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
        </section>
      ) : null}

      {tab === "locations" ? (
        <section className="mt-4 grid gap-4 xl:grid-cols-[0.94fr_1.06fr]">
          <Panel title="Добавить склад или ПВЗ" kicker="Новая точка">
            <MapView
              points={locationMapPoints}
              className="h-[380px] w-full rounded-[28px]"
              selectable
              selectedCoordinates={locationCoordinates}
              fitToData
              helperText="Кликните по карте или объекту. Широта и долгота больше не вводятся вручную."
              onSelect={handleLocationPick}
            />

            <div className="mt-4 rounded-[24px] border border-sky-100 bg-sky-50/80 px-4 py-4 text-sm text-slate-600">
              <strong className="block text-slate-900">Выбранная точка</strong>
              <span className="mt-1 block">{locationSelectionLabel}</span>
            </div>

            <div className="mt-6 space-y-4">
              <Input label="Название" value={locationForm.name} onChange={(value) => setLocationForm((current) => ({ ...current, name: value }))} />
              <Input label="Код" value={locationForm.code} onChange={(value) => setLocationForm((current) => ({ ...current, code: value }))} />
              <SelectField
                label="Тип точки"
                value={locationForm.type}
                onChange={(value) => setLocationForm((current) => ({ ...current, type: value as LocationPoint["type"] }))}
                options={[
                  { value: "WAREHOUSE", label: "Склад" },
                  { value: "PICKUP_POINT", label: "ПВЗ" },
                ]}
              />
              <Input label="Город" value={locationForm.city} onChange={(value) => setLocationForm((current) => ({ ...current, city: value }))} />
              <Input label="Адрес" value={locationForm.address} onChange={(value) => setLocationForm((current) => ({ ...current, address: value }))} />
              <Input label="Примечание" value={locationForm.notes} onChange={(value) => setLocationForm((current) => ({ ...current, notes: value }))} />
            </div>

            <button
              type="button"
              onClick={() => createLocationMutation.mutate()}
              disabled={!locationForm.name || !locationForm.city || !locationForm.address || !locationCoordinates || createLocationMutation.isPending}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-4 text-sm font-semibold text-white disabled:opacity-70"
            >
              <Plus className="h-4 w-4" />
              Добавить точку
            </button>
          </Panel>

          <Panel title="Сетка складов и ПВЗ" kicker="Точки сети">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[30px] border border-slate-200/80 bg-slate-50/80 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">WAREHOUSE</p>
                <h3 className="mt-3 text-xl font-semibold text-slate-900">Склады</h3>
                <div className="mt-5 space-y-3">
                  {warehouses.map((item) => (
                    <LocationCard key={item.id} item={item} />
                  ))}
                </div>
              </div>

              <div className="rounded-[30px] border border-slate-200/80 bg-slate-50/80 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">PICKUP POINT</p>
                <h3 className="mt-3 text-xl font-semibold text-slate-900">ПВЗ</h3>
                <div className="mt-5 space-y-3">
                  {pickupPoints.map((item) => (
                    <LocationCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </section>
      ) : null}

      {tab === "routes" ? (
        <section className="mt-4 grid gap-4 xl:grid-cols-[0.94fr_1.06fr]">
          <Panel title="Собрать маршрут по карте" kicker="Новый маршрут">
            <div className="grid gap-4 md:grid-cols-2">
              <RoutePointCard
                title="Старт"
                description="Кликните по янтарной метке склада на карте"
                point={selectedStartPoint}
                tone="amber"
                onReset={() => setRouteForm((current) => ({ ...current, startPointId: "" }))}
              />
              <RoutePointCard
                title="Финиш"
                description="Кликните по синей метке ПВЗ на карте"
                point={selectedEndPoint}
                tone="sky"
                onReset={() => setRouteForm((current) => ({ ...current, endPointId: "" }))}
              />
            </div>

            <div className="mt-6">
              <MapView
                points={locationMapPoints}
                lines={routeDraftLines}
                className="h-[420px] w-full rounded-[28px]"
                fitToData
                highlightedPointIds={highlightedRoutePointIds}
                helperText="Выберите склад и ПВЗ прямо на карте. Маршрут строится по дорожной сети после создания."
                onPointClick={handleRoutePointClick}
              />
            </div>

            <div className="mt-6 space-y-4">
              <Input label="Название маршрута" value={routeForm.name} onChange={(value) => setRouteForm((current) => ({ ...current, name: value }))} />
              <SelectField
                label="Водитель"
                value={routeForm.driverId}
                onChange={(value) => setRouteForm((current) => ({ ...current, driverId: value }))}
                options={[
                  { value: "", label: "Назначить позже" },
                  ...drivers.map((driver) => ({
                    value: String(driver.id),
                    label: driver.name,
                  })),
                ]}
              />
              <SelectField
                label="Транспорт"
                value={routeForm.vehicleId}
                onChange={(value) => setRouteForm((current) => ({ ...current, vehicleId: value }))}
                options={[
                  { value: "", label: "Назначить позже" },
                  ...vehicles.map((vehicle) => ({
                    value: String(vehicle.id),
                    label: `${vehicle.plateNumber} · ${vehicle.model}`,
                  })),
                ]}
              />
            </div>

            <button
              type="button"
              onClick={() => createRouteMutation.mutate()}
              disabled={!routeForm.name || !routeForm.startPointId || !routeForm.endPointId || createRouteMutation.isPending}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-4 text-sm font-semibold text-white disabled:opacity-70"
            >
              <Route className="h-4 w-4" />
              Создать маршрут
            </button>
          </Panel>

          <Panel title="Текущие рейсы" kicker="Журнал">
            <div className="space-y-4">
              {routes.map((route) => {
                const routeMeta = getRouteRoutingMeta(route);

                return (
                  <div key={route.id} className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{route.name}</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {route.startPoint?.name || "Старт"} → {route.endPoint?.name || "Финиш"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-white px-3 py-1 text-slate-500">
                          {route.status}
                        </span>
                        <span className="rounded-full bg-white px-3 py-1 text-slate-500">
                          Risk {Math.round((route.riskScore || 0) * 100)}%
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                      <span>Водитель: {route.driver?.user?.name || "не назначен"}</span>
                      <span>ТС: {route.vehicle?.plateNumber || "не назначено"}</span>
                      <span>ETA: {route.estimatedTime ? `${route.estimatedTime} мин` : "—"}</span>
                    </div>

                    {routeMeta ? (
                      <div className="mt-4 rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          <span>Источник: {routeMeta.sourceLabel}</span>
                          <span>Средняя скорость: {routeMeta.avgSpeedKmh ?? "—"} км/ч</span>
                          <span>Дорожный риск: {routeMeta.roadSituationPercent ?? 0}%</span>
                          <span>События по пути: {routeMeta.eventCount}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Panel>
        </section>
      ) : null}

      {tab === "map" ? (
        <Panel title="Общая карта сети" kicker="Live map">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-[Georgia] text-2xl text-slate-900">
                Склады, ПВЗ, транспорт и дорожные маршруты
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                Карта работает на русском. В режиме 2GIS доступны клики по объектам,
                зданиям и организациям, в fallback-режиме остаются кликабельными ваши
                точки и выбранные позиции.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <MapView
              lines={routeLines}
              points={mapPoints}
              className="h-[720px] w-full rounded-[28px]"
            />
          </div>
        </Panel>
      ) : null}
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <article className="rounded-[30px] border border-white/70 bg-white/92 p-5 shadow-[0_30px_90px_rgba(148,163,184,0.16)]">
      <div className="mb-4 inline-flex rounded-2xl bg-slate-900 p-3 text-white">{icon}</div>
      <span className="block text-sm text-slate-500">{label}</span>
      <strong className="mt-3 block text-3xl text-slate-900">{value}</strong>
    </article>
  );
}

function Panel({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-[34px] border border-white/70 bg-white/95 p-6 shadow-[0_30px_90px_rgba(148,163,184,0.18)]">
      <p className="text-xs uppercase tracking-[0.32em] text-slate-400">{kicker}</p>
      <h2 className="mt-3 font-[Georgia] text-2xl text-slate-900">{title}</h2>
      <div className="mt-6">{children}</div>
    </article>
  );
}

function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-300 focus:bg-white"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-300 focus:bg-white"
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LocationCard({ item }: { item: LocationPoint }) {
  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white p-4">
      <strong className="block text-slate-900">{item.name}</strong>
      <span className="mt-1 block text-sm text-slate-500">
        {item.city}, {item.address}
      </span>
      <span className="mt-3 block text-xs uppercase tracking-[0.24em] text-slate-400">
        {item.code}
      </span>
    </div>
  );
}

function RoutePointCard({
  title,
  description,
  point,
  tone,
  onReset,
}: {
  title: string;
  description: string;
  point: LocationPoint | null;
  tone: "amber" | "sky";
  onReset: () => void;
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-100 bg-amber-50/70"
      : "border-sky-100 bg-sky-50/70";

  return (
    <div className={`rounded-[24px] border px-4 py-4 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{title}</p>
          <strong className="mt-2 block text-slate-900">
            {point ? point.name : "Точка пока не выбрана"}
          </strong>
          <span className="mt-1 block text-sm text-slate-600">
            {point ? `${point.city}, ${point.address}` : description}
          </span>
        </div>
        {point ? (
          <button
            type="button"
            onClick={onReset}
            className="rounded-full border border-white/80 bg-white px-3 py-1 text-xs text-slate-500"
          >
            Сбросить
          </button>
        ) : null}
      </div>
    </div>
  );
}

function buildRouteCoordinates(route: RouteSummary): [number, number][] {
  const points: [number, number][] = [];

  if (route.startLat != null && route.startLon != null) {
    points.push([route.startLon, route.startLat]);
  }

  if (Array.isArray(route.waypoints)) {
    route.waypoints.forEach((waypoint) => {
      if (waypoint?.lon != null && waypoint?.lat != null) {
        points.push([waypoint.lon, waypoint.lat]);
      }
    });
  }

  if (route.endLat != null && route.endLon != null) {
    points.push([route.endLon, route.endLat]);
  }

  return points;
}

function routeColor(riskScore?: number | null) {
  if (!riskScore) return "#0f766e";
  if (riskScore >= 0.65) return "#dc2626";
  if (riskScore >= 0.4) return "#d97706";
  return "#0f766e";
}

function getRouteRoutingMeta(route: RouteSummary) {
  const routing = route.riskFactors?.routing;
  if (!routing) return null;

  return {
    sourceLabel: routing.source === "osrm" ? "OSRM / дорожная сеть" : "Fallback / demo",
    avgSpeedKmh:
      typeof routing.avg_speed_kmh === "number" ? Math.round(routing.avg_speed_kmh) : null,
    alternatives:
      typeof routing.alternatives_considered === "number" ? routing.alternatives_considered : 1,
    eventCount: Array.isArray(routing.road_events) ? routing.road_events.length : 0,
    roadSituationPercent:
      typeof route.riskFactors?.road_situation === "number"
        ? Math.round(route.riskFactors.road_situation * 100)
        : null,
  };
}
