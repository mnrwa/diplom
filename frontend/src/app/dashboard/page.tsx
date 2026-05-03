"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CheckCircle,
  Copy,
  Loader2,
  LogOut,
  MapPin,
  Package,
  Plus,
  Route as RouteIcon,
  ShoppingBag,
  TrendingUp,
  Users,
  Warehouse,
  Wifi,
  WifiOff,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DriverSelector } from "@/components/maps/DriverSelector";
import MapView from "@/components/map/MapView";
import { AutoAssignButton } from "@/components/dashboard/AutoAssignModal";
import { MaintenancePanel } from "@/components/dashboard/MaintenancePanel";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ChatPanel } from "@/components/ChatPanel";
import {
  autoAssignRoute,
  createDriverAccount,
  createLocation,
  createRoute,
  geocodeAddress,
  getDrivers,
  getLocations,
  getRiskEvents,
  getRoutes,
  getVehicles,
  getAiEta,
  getAiWeather,
  getAiForecast,
  type AiEtaResult,
  type ForecastResult,
  type GeocodeResult,
  type LocationPoint,
} from "@/lib/api";
import { clearSession, getStoredUser } from "@/lib/session";

function generateLocationCode(type: "WAREHOUSE" | "PICKUP_POINT") {
  const prefix = type === "WAREHOUSE" ? "WH" : "PP";
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const suffix = Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  return `${prefix}-${suffix}`;
}

function statusLabel(status?: string) {
  switch (status) {
    case "PLANNED":
      return "Запланирован";
    case "ACTIVE":
      return "В пути";
    case "COMPLETED":
      return "Доставлено";
    case "CANCELLED":
      return "Отменён";
    case "RECALCULATING":
      return "Пересчёт";
    case "ON_SHIFT":
      return "На смене";
    case "RESTING":
      return "Отдыхает";
    case "OFFLINE":
      return "Офлайн";
    case "IDLE":
      return "Свободно";
    case "ON_ROUTE":
      return "В рейсе";
    case "MAINTENANCE":
      return "ТО";
    default:
      return status ?? "—";
  }
}

function statusTone(
  status?: string
): "default" | "secondary" | "success" | "destructive" | "outline" {
  switch (status) {
    case "ACTIVE":
    case "ON_ROUTE":
    case "ON_SHIFT":
      return "default";
    case "COMPLETED":
      return "success";
    case "CANCELLED":
      return "destructive";
    case "PLANNED":
    case "RESTING":
      return "secondary";
    case "IDLE":
      return "success";
    default:
      return "outline";
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [ready, setReady] = useState(false);
  const [userName, setUserName] = useState("Диспетчер");
  const [userId, setUserId] = useState(0);
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);

  // Driver form
  const [driverMessage, setDriverMessage] = useState("");
  const [driverForm, setDriverForm] = useState({
    name: "",
    email: "",
    password: "Driver123!",
    phone: "",
    vehicleId: "",
  });

  // Location form
  const [locationForm, setLocationForm] = useState({
    name: "",
    code: generateLocationCode("WAREHOUSE"),
    type: "WAREHOUSE" as "WAREHOUSE" | "PICKUP_POINT",
    city: "",
    address: "",
    notes: "",
    lat: "",
    lon: "",
  });

  const [locationPick, setLocationPick] = useState<[number, number] | null>(null);

  // Address autocomplete
  const [addrQuery, setAddrQuery] = useState("");
  const [addrSuggestions, setAddrSuggestions] = useState<GeocodeResult[]>([]);
  const [addrLoading, setAddrLoading] = useState(false);
  const [showAddrDropdown, setShowAddrDropdown] = useState(false);
  const addrDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAddrSearch = (value: string) => {
    setAddrQuery(value);
    if (addrDebounce.current) clearTimeout(addrDebounce.current);
    if (value.length < 2) { setAddrSuggestions([]); setShowAddrDropdown(false); return; }
    addrDebounce.current = setTimeout(async () => {
      setAddrLoading(true);
      try {
        const res = await geocodeAddress(value);
        setAddrSuggestions(res.slice(0, 6));
        setShowAddrDropdown(true);
      } catch { setAddrSuggestions([]); }
      finally { setAddrLoading(false); }
    }, 350);
  };

  const handleAddrSelect = (r: GeocodeResult) => {
    setAddrQuery(r.city || r.displayName);
    setLocationForm((f) => ({
      ...f,
      city: r.city || f.city,
      address: r.address || f.address,
      lat: r.lat.toFixed(6),
      lon: r.lon.toFixed(6),
    }));
    setLocationPick([r.lon, r.lat]);
    setShowAddrDropdown(false);
  };

  // Route form (warehouse -> PVZ)
  const [routeForm, setRouteForm] = useState({
    name: "",
    startPointId: "",
    endPointId: "",
    driverId: "",
    vehicleId: "",
  });
  const [routeSuccess, setRouteSuccess] = useState("");
  const [routeEta, setRouteEta] = useState<{ loading: boolean; result: AiEtaResult | null; distanceKm: number }>({ loading: false, result: null, distanceKm: 0 });

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
    setUserName(user.name || user.email);
    setUserId(user.id ?? 0);
    setReady(true);
  }, [router]);

  const { positions: wsPositions, connected: wsConnected } = useWebSocket();

  const { data: drivers = [] } = useQuery({
    queryKey: ["drivers"],
    queryFn: getDrivers,
    enabled: ready,
    refetchInterval: 15_000,
  });
  const { data: routes = [] } = useQuery({
    queryKey: ["routes"],
    queryFn: getRoutes,
    enabled: ready,
    refetchInterval: 15_000,
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
  const { data: riskEvents = [] } = useQuery({
    queryKey: ["risk-events"],
    queryFn: getRiskEvents,
    enabled: ready,
    refetchInterval: 45_000,
  });

  const { data: forecastData } = useQuery<ForecastResult | null>({
    queryKey: ["forecast", routes.length],
    queryFn: async () => {
      const today = new Date();
      const history = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (29 - i));
        const dateStr = d.toISOString().slice(0, 10);
        return { date: dateStr, count: routes.filter((r) => r.createdAt?.startsWith(dateStr)).length };
      });
      return getAiForecast(history);
    },
    enabled: ready && routes.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    const { startPointId, endPointId } = routeForm;
    if (!startPointId || !endPointId) {
      setRouteEta((prev) => prev.loading || prev.result ? { loading: false, result: null, distanceKm: 0 } : prev);
      return;
    }
    // Read locations via ref to avoid adding it as dependency
    const start = locations.find((l) => l.id === Number(startPointId));
    const end   = locations.find((l) => l.id === Number(endPointId));
    if (!start || !end) return;

    let cancelled = false;
    setRouteEta({ loading: true, result: null, distanceKm: 0 });
    const OSRM = "https://router.project-osrm.org";
    Promise.all([
      fetch(`${OSRM}/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=false`)
        .then((r) => r.json()).then((d) => (d.routes?.[0]?.distance ?? 0) / 1000),
      getAiWeather(start.lat, start.lon),
    ]).then(([distKm, weather]) =>
      getAiEta({ distance_km: distKm, weather_score: weather.risk_score ?? 0.1 })
        .then((eta) => { if (!cancelled) setRouteEta({ loading: false, result: eta, distanceKm: Math.round(distKm) }); })
    ).catch(() => { if (!cancelled) setRouteEta({ loading: false, result: null, distanceKm: 0 }); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeForm.startPointId, routeForm.endPointId]);

  const createDriverMutation = useMutation({
    mutationFn: () =>
      createDriverAccount({
        ...driverForm,
        vehicleId: driverForm.vehicleId ? Number(driverForm.vehicleId) : undefined,
      }),
    onSuccess: (payload: { credentials: { email: string; password: string } }) => {
      setDriverMessage(
        `Доступ выдан: ${payload.credentials.email} / ${payload.credentials.password}`
      );
      setDriverForm({ name: "", email: "", password: "Driver123!", phone: "", vehicleId: "" });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message;
      setDriverMessage(
        Array.isArray(message)
          ? message.join(", ")
          : message || "Не удалось создать учётную запись водителя"
      );
    },
  });

  const createLocationMutation = useMutation({
    mutationFn: () =>
      createLocation({
        ...locationForm,
        code: locationForm.code || undefined,
        notes: locationForm.notes || undefined,
        lat: Number(locationForm.lat),
        lon: Number(locationForm.lon),
      }),
    onSuccess: () => {
      setLocationForm({
        name: "",
        code: generateLocationCode("WAREHOUSE"),
        type: "WAREHOUSE",
        city: "",
        address: "",
        notes: "",
        lat: "",
        lon: "",
      });
      setLocationPick(null);
      setAddrQuery("");
      setAddrSuggestions([]);
      queryClient.invalidateQueries({ queryKey: ["locations"] });
    },
  });

  const createRouteMutation = useMutation({
    mutationFn: () => {
      if (!routeForm.startPointId || !routeForm.endPointId) {
        throw new Error("Выберите склад и ПВЗ");
      }

      const start = locations.find(
        (item) => item.id === Number(routeForm.startPointId),
      );
      const end = locations.find(
        (item) => item.id === Number(routeForm.endPointId),
      );

      const name =
        routeForm.name ||
        `${start?.city || "Точка"} → ${end?.city || "Точка"}`;

      return createRoute({
        name,
        startPointId: Number(routeForm.startPointId),
        endPointId: Number(routeForm.endPointId),
        driverId: routeForm.driverId ? Number(routeForm.driverId) : undefined,
        vehicleId: routeForm.vehicleId ? Number(routeForm.vehicleId) : undefined,
      });
    },
    onSuccess: (route) => {
      setRouteSuccess(`Маршрут «${route.name}» создан (ID ${route.id})`);
      setRouteForm({
        name: "",
        startPointId: "",
        endPointId: "",
        driverId: "",
        vehicleId: "",
      });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    },
  });

  const activeRoutes = useMemo(
    () => routes.filter((r) => r.status === "ACTIVE" || r.status === "PLANNED"),
    [routes]
  );
  const deliveredToday = useMemo(
    () => routes.filter((r) => r.status === "COMPLETED").length,
    [routes]
  );
  const availableDrivers = useMemo(
    () => drivers.filter((d) => d.status === "ON_SHIFT" && !d.activeRoute).length,
    [drivers]
  );
  const availableDriverVehicles = useMemo(
    () => vehicles.filter((vehicle) => !vehicle.driverProfile),
    [vehicles]
  );
  const warehouses = locations.filter((item) => item.type === "WAREHOUSE");
  const pickupPoints = locations.filter((item) => item.type === "PICKUP_POINT");

  const driverSelectorData = drivers.map((d) => ({
    id: String(d.id),
    name: d.name,
    vehicle: d.vehicle?.plateNumber || "Без ТС",
    status: statusLabel(d.status),
  }));
  const selectedDriverRoute = useMemo(() => {
    if (!selectedDriver) return null;
    const driver = drivers.find((d) => String(d.id) === selectedDriver);
    if (!driver) return null;
    const route = routes.find((r) => r.driver?.id === driver.id);
    return route || null;
  }, [selectedDriver, drivers, routes]);

  const logout = () => {
    clearSession();
    router.replace("/");
  };

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 py-8">
        <Card className="p-10 text-gray-600">Загрузка кабинета диспетчера...</Card>
      </main>
    );
  }

  return (
    <div className="min-h-screen pb-8">
      <div className="border-b border-sand/80 bg-white/65 py-6 text-plum backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-sand p-3 text-pinterest shadow-[0_20px_40px_rgba(16,60,37,0.10)]">
              <Users className="h-8 w-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Диспетчерская</h1>
              <p className="text-warmsilver text-sm">{userName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="gap-1 border border-sand/80 bg-white/70 text-olive hover:bg-white">
              {wsConnected ? (
                <>
                  <Wifi className="h-3 w-3" />
                  GPS live
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3" />
                  GPS offline
                </>
              )}
            </Badge>
            <Button variant="secondary" size="sm" onClick={logout} className="gap-2">
              <LogOut className="h-4 w-4" />
              Выйти
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-3">

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-600">Водителей</p>
                  <p className="text-2xl font-bold">{drivers.length}</p>
                  <p className="text-xs text-emerald-600">
                    {availableDrivers} свободно
                  </p>
                </div>
                <Users className="h-7 w-7 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-600">Активных рейсов</p>
                  <p className="text-2xl font-bold">{activeRoutes.length}</p>
                </div>
                <RouteIcon className="h-7 w-7 text-emerald-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-600">Доставлено</p>
                  <p className="text-2xl font-bold">{deliveredToday}</p>
                </div>
                <CheckCircle className="h-7 w-7 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-600">Точек сети</p>
                  <p className="text-2xl font-bold">{locations.length}</p>
                </div>
                <Warehouse className="h-7 w-7 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <Card className="shadow-sm">
            <CardContent className="p-2">
              <TabsList className="grid grid-cols-6 w-full">
                <TabsTrigger value="overview">Обзор</TabsTrigger>
                <TabsTrigger value="drivers">Водители</TabsTrigger>
                <TabsTrigger value="routes">Маршруты</TabsTrigger>
                <TabsTrigger value="maintenance">ТО</TabsTrigger>
                <TabsTrigger value="locations">Сеть</TabsTrigger>
              </TabsList>
            </CardContent>
          </Card>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-6">
                <Card className="shadow-lg">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="h-5 w-5 text-blue-500" />
                      Живая карта
                    </CardTitle>
                    <CardDescription>
                      Отслеживайте рейсы в реальном времени
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <DriverSelector
                        drivers={driverSelectorData}
                        selectedDriver={selectedDriver}
                        onSelectDriver={setSelectedDriver}
                      />
                    </div>
                    {(() => {
                      const points: Array<{
                        id: string;
                        entityId?: number;
                        kind: "warehouse" | "pickup" | "driver";
                        title: string;
                        subtitle?: string;
                        longitude: number;
                        latitude: number;
                        speed?: number | null;
                      }> = [];

                      const lines: Array<{
                        id: string;
                        name: string;
                        color?: string;
                        coordinates: [number, number][];
                      }> = [];

                      if (selectedDriverRoute?.startPoint) {
                        points.push({
                          id: `route-start-${selectedDriverRoute.id}`,
                          entityId: selectedDriverRoute.startPoint.id,
                          kind: "warehouse",
                          title: selectedDriverRoute.startPoint.name,
                          subtitle: `${selectedDriverRoute.startPoint.city}, ${selectedDriverRoute.startPoint.address}`,
                          longitude: selectedDriverRoute.startPoint.lon,
                          latitude: selectedDriverRoute.startPoint.lat,
                        });
                      }

                      if (selectedDriverRoute?.endPoint) {
                        points.push({
                          id: `route-end-${selectedDriverRoute.id}`,
                          entityId: selectedDriverRoute.endPoint.id,
                          kind: "pickup",
                          title: selectedDriverRoute.endPoint.name,
                          subtitle: `${selectedDriverRoute.endPoint.city}, ${selectedDriverRoute.endPoint.address}`,
                          longitude: selectedDriverRoute.endPoint.lon,
                          latitude: selectedDriverRoute.endPoint.lat,
                        });
                      }

                      if (selectedDriverRoute) {
                        // Use OSRM geometry if available, else waypoints, else straight line
                        const osrmGeom = Array.isArray((selectedDriverRoute as any).riskFactors?.routing?.geometry)
                          ? (selectedDriverRoute as any).riskFactors.routing.geometry
                          : null;

                        const coordinates: [number, number][] = osrmGeom
                          ? osrmGeom.filter((p: any) => p?.lon != null).map((p: any) => [p.lon, p.lat] as [number, number])
                          : (() => {
                              const coords: [number, number][] = [];
                              if (selectedDriverRoute.startLon != null && selectedDriverRoute.startLat != null)
                                coords.push([selectedDriverRoute.startLon, selectedDriverRoute.startLat]);
                              if (Array.isArray((selectedDriverRoute as any).waypoints))
                                (selectedDriverRoute as any).waypoints.forEach((item: any) => {
                                  if (item?.lon != null && item?.lat != null) coords.push([item.lon, item.lat]);
                                });
                              if (selectedDriverRoute.endLon != null && selectedDriverRoute.endLat != null)
                                coords.push([selectedDriverRoute.endLon, selectedDriverRoute.endLat]);
                              return coords;
                            })();

                        if (coordinates.length > 1) {
                          lines.push({
                            id: `route-${selectedDriverRoute.id}`,
                            name: selectedDriverRoute.name,
                            color: "#10b981",
                            coordinates,
                          });
                        }
                      }

                      drivers.forEach((driver) => {
                        const wsPos = driver.vehicle ? wsPositions[driver.vehicle.id] : null;
                        const pos = wsPos || driver.latestPosition;
                        // Fallback: show driver at route start point if no GPS yet
                        const fallbackPos = !pos && driver.activeRoute?.startPoint
                          ? { lat: driver.activeRoute.startPoint.lat, lon: driver.activeRoute.startPoint.lon, speed: null }
                          : null;
                        const resolvedPos = pos || fallbackPos;
                        if (!resolvedPos) return;

                        points.push({
                          id: `driver-${driver.id}`,
                          entityId: driver.id,
                          kind: "driver",
                          title: driver.name,
                          subtitle: driver.vehicle?.plateNumber || driver.email,
                          longitude: resolvedPos.lon,
                          latitude: resolvedPos.lat,
                          speed: resolvedPos.speed ?? null,
                        });
                      });

                      return (
                        <MapView
                          fitToData
                          className="h-[420px] w-full rounded-xl"
                          points={points}
                          lines={lines}
                          highlightedPointIds={
                            selectedDriver ? [`driver-${selectedDriver}`] : []
                          }
                          onPointClick={(point) => {
                            if (point.kind === "driver" && point.entityId) {
                              setSelectedDriver(String(point.entityId));
                            }
                          }}
                        />
                      );
                    })()}
                  </CardContent>
                </Card>

                <Card className="shadow-lg">
                  <CardHeader>
                    <CardTitle>Активные маршруты</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {activeRoutes.length === 0 ? (
                      <p className="text-sm text-gray-500">
                        Активных маршрутов пока нет
                      </p>
                    ) : (
                      activeRoutes.slice(0, 5).map((route) => (
                        <Card
                          key={route.id}
                          className="border-l-4 border-l-blue-500"
                        >
                          <CardContent className="pt-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <span className="font-semibold">
                                    {route.name}
                                  </span>
                                  <Badge variant={statusTone(route.status)}>
                                    {statusLabel(route.status)}
                                  </Badge>
                                </div>
                                <p className="text-sm text-gray-600">
                                  {route.startPoint?.name || "Старт"} →{" "}
                                  {route.endPoint?.name || "Финиш"}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                  Водитель:{" "}
                                  {route.driver?.user?.name || "не назначен"} ·
                                  ТС:{" "}
                                  {route.vehicle?.plateNumber || "не назначен"}
                                </p>
                              </div>
                              {typeof route.riskScore === "number" && (
                                <div className="text-right">
                                  <p className="text-xs text-gray-500">Риск</p>
                                  <p className="text-sm font-semibold">
                                    {Math.round(route.riskScore * 100)}%
                                  </p>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card className="shadow-lg">
                  <CardHeader>
                    <CardTitle className="text-base">Водители в рейсе</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {drivers.slice(0, 5).map((driver) => {
                      const wsPos = driver.vehicle
                        ? wsPositions[driver.vehicle.id]
                        : null;
                      return (
                        <Link
                          key={driver.id}
                          href={`/dashboard/drivers/${driver.id}`}
                          className="block rounded-lg border border-gray-200 p-3 hover:border-blue-300 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">
                                {driver.name}
                              </p>
                              <p className="text-xs text-gray-500 truncate">
                                {driver.vehicle?.plateNumber || "Без ТС"}
                              </p>
                              {wsPos && (
                                <p className="text-[10px] text-emerald-600 mt-0.5">
                                  Live · {wsPos.lat.toFixed(3)},{" "}
                                  {wsPos.lon.toFixed(3)}
                                </p>
                              )}
                            </div>
                            <Badge variant={statusTone(driver.status)}>
                              {statusLabel(driver.status)}
                            </Badge>
                          </div>
                        </Link>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card className="shadow-lg">
                  <CardHeader>
                    <CardTitle className="text-base">Загруженность</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">Водителей занято</span>
                        <span className="font-semibold">
                          {drivers.length - availableDrivers}/{drivers.length}
                        </span>
                      </div>
                      <Progress
                        value={
                          drivers.length > 0
                            ? ((drivers.length - availableDrivers) /
                                drivers.length) *
                              100
                            : 0
                        }
                        className="h-2"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">Маршрутов активно</span>
                        <span className="font-semibold">
                          {activeRoutes.length}/{routes.length}
                        </span>
                      </div>
                      <Progress
                        value={
                          routes.length > 0
                            ? (activeRoutes.length / routes.length) * 100
                            : 0
                        }
                        className="h-2"
                      />
                    </div>
                  </CardContent>
                </Card>

                {forecastData && forecastData.forecast?.length > 0 && (() => {
                  const maxRoutes = Math.max(...forecastData.forecast.map((d) => d.predicted_routes), 1);
                  return (
                    <Card className="shadow-lg">
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <TrendingUp className="h-5 w-5 text-violet-500" />
                          Прогноз нагрузки
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-xs text-gray-500 leading-snug">{forecastData.recommendation}</p>
                        <div className="space-y-2">
                          {forecastData.forecast.slice(0, 7).map((day) => (
                            <div key={day.date} className="flex items-center gap-2">
                              <span className="w-6 text-xs font-medium text-gray-600 shrink-0">{day.day_name}</span>
                              <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    day.load_level === "high" ? "bg-red-400" :
                                    day.load_level === "medium" ? "bg-amber-400" : "bg-emerald-400"
                                  }`}
                                  style={{ width: `${Math.round((day.predicted_routes / maxRoutes) * 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500 w-5 text-right shrink-0">{day.predicted_routes}</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-warmsilver">Пик: {forecastData.peak_day} · avg {forecastData.avg_daily_routes}/день</p>
                      </CardContent>
                    </Card>
                  );
                })()}
              </div>
            </div>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-blue-500" />
                  Чат с водителем
                </CardTitle>
                <CardDescription>
                  {selectedDriver
                    ? `Переписка с ${drivers.find((d) => String(d.id) === selectedDriver)?.name ?? "водителем"}`
                    : "Выберите водителя на карте или в списке"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedDriver ? (
                  <ChatPanel
                    senderId={userId}
                    senderName={userName}
                    role="DISPATCHER"
                    targetDriverId={Number(selectedDriver)}
                    routeId={selectedDriverRoute?.id ?? null}
                  />
                ) : (
                  <p className="text-sm text-gray-400 py-4 text-center">
                    Нажмите на водителя на карте, чтобы открыть чат
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="drivers" className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="shadow-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus className="h-5 w-5 text-emerald-500" />
                    Добавить водителя
                  </CardTitle>
                  <CardDescription>
                    Выдача учётной записи и доступа
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {driverMessage && (
                    <Card className={createDriverMutation.isError ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50"}>
                      <CardContent className="pt-4">
                        <p className={createDriverMutation.isError ? "text-sm text-rose-800" : "text-sm text-emerald-800"}>
                          {driverMessage}
                        </p>
                      </CardContent>
                    </Card>
                  )}
                  <div className="space-y-2">
                    <Label>Имя водителя</Label>
                    <Input
                      value={driverForm.name}
                      onChange={(e) =>
                        setDriverForm({ ...driverForm, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={driverForm.email}
                      onChange={(e) =>
                        setDriverForm({ ...driverForm, email: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Телефон</Label>
                    <Input
                      value={driverForm.phone}
                      onChange={(e) =>
                        setDriverForm({ ...driverForm, phone: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Пароль</Label>
                    <Input
                      value={driverForm.password}
                      onChange={(e) =>
                        setDriverForm({
                          ...driverForm,
                          password: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Транспорт</Label>
                    <Select
                      value={driverForm.vehicleId}
                      onValueChange={(v) =>
                        setDriverForm({ ...driverForm, vehicleId: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Назначить позже" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableDriverVehicles.map((v) => (
                          <SelectItem key={v.id} value={String(v.id)}>
                            {v.plateNumber} · {v.model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => createDriverMutation.mutate()}
                    disabled={
                      !driverForm.name ||
                      !driverForm.email ||
                      !driverForm.password ||
                      createDriverMutation.isPending
                    }
                    className="w-full bg-emerald-500 hover:bg-emerald-600"
                  >
                    {createDriverMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Создать учётку
                  </Button>
                </CardContent>
              </Card>

              <Card className="shadow-lg">
                <CardHeader>
                  <CardTitle>Состав водителей</CardTitle>
                  <CardDescription>{drivers.length} всего</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {drivers.map((driver) => {
                    const wsPos = driver.vehicle
                      ? wsPositions[driver.vehicle.id]
                      : null;
                    return (
                      <Link
                        key={driver.id}
                        href={`/dashboard/drivers/${driver.id}`}
                        className="block rounded-lg border border-gray-200 p-4 hover:border-emerald-300 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <p className="font-semibold">{driver.name}</p>
                            <p className="text-sm text-gray-600">
                              {driver.email}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                              <span>
                                ТС:{" "}
                                {driver.vehicle?.plateNumber || "не назначено"}
                              </span>
                              <span>
                                Рейтинг: {driver.rating?.toFixed(1) ?? "—"}
                              </span>
                            </div>
                            {wsPos && (
                              <p className="text-[11px] text-emerald-600 mt-1">
                                Live GPS · {wsPos.lat.toFixed(3)},{" "}
                                {wsPos.lon.toFixed(3)}
                              </p>
                            )}
                          </div>
                          <Badge variant={statusTone(driver.status)}>
                            {statusLabel(driver.status)}
                          </Badge>
                        </div>
                      </Link>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="routes" className="space-y-6">
            <div className="rounded-[28px] border border-sand bg-white p-6 space-y-5">
              <div>
                <p className="text-xs uppercase tracking-[0.32em] text-warmsilver">AI · OSRM · Погода</p>
                <h2 className="mt-1 text-2xl font-semibold text-plum">Создать маршрут</h2>
                <p className="mt-1 text-sm text-olive">AI рассчитает время доставки с учётом погоды и дорожной обстановки</p>
              </div>

              {routeSuccess && (
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  {routeSuccess}
                </div>
              )}

              {/* Points */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-widest text-warmsilver">Склад (точка А)</Label>
                  <Select value={routeForm.startPointId} onValueChange={(v) => setRouteForm((c) => ({ ...c, startPointId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>{item.city} · {item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-widest text-warmsilver">ПВЗ (точка Б)</Label>
                  <Select value={routeForm.endPointId} onValueChange={(v) => setRouteForm((c) => ({ ...c, endPointId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Выберите ПВЗ" /></SelectTrigger>
                    <SelectContent>
                      {pickupPoints.map((item) => (
                        <SelectItem key={item.id} value={String(item.id)}>{item.city} · {item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* AI ETA result — auto-calculated */}
              {routeEta.loading && (
                <div className="flex items-center gap-2 rounded-2xl border border-sand bg-fog px-4 py-3 text-sm text-olive">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  AI рассчитывает маршрут...
                </div>
              )}

              {routeEta.result && !routeEta.loading && (() => {
                const eta = routeEta.result!;
                const mins = eta.predicted_minutes;
                const h = Math.floor(mins / 60);
                const m = mins % 60;
                const timeStr = h > 0 ? `${h} ч ${m > 0 ? `${m} мин` : ""}` : `${m} мин`;
                return (
                  <div className="rounded-2xl border border-purple-100 bg-gradient-to-r from-plum/5 to-purple-50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="rounded-xl bg-plum p-2">
                          <RouteIcon className="h-4 w-4 text-white" />
                        </div>
                        <div>
                          <p className="text-xs text-warmsilver uppercase tracking-widest">Расстояние</p>
                          <p className="font-bold text-plum">{routeEta.distanceKm} км</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-warmsilver uppercase tracking-widest">AI · Время доставки</p>
                        <p className="font-bold text-xl text-plum">{timeStr}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-warmsilver uppercase tracking-widest">Скорость</p>
                        <p className="font-bold text-plum">{eta.factors.adjusted_speed_kmh} км/ч</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {[
                        { label: "Время суток", val: eta.factors.tod_factor },
                        { label: "Погода", val: eta.factors.weather_factor },
                        { label: "Уверенность", val: eta.confidence },
                      ].map(({ label, val }) => (
                        <div key={label} className="rounded-xl bg-white border border-sand px-3 py-2 text-center">
                          <p className="text-warmsilver">{label}</p>
                          <p className={`font-semibold mt-0.5 ${val >= 0.85 ? "text-emerald-600" : val >= 0.65 ? "text-amber-500" : "text-rose-500"}`}>
                            {Math.round(val * 100)}%
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-warmsilver">
                      Источник: {eta.source === "xgboost" ? `XGBoost (MAE ±${eta.model_mae_min} мин)` : "Аналитическая модель"}
                    </p>
                  </div>
                );
              })()}

              {/* Driver / vehicle / name */}
              <div className="grid md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-widest text-warmsilver">Название</Label>
                  <Input placeholder="(необязательно)" value={routeForm.name}
                    onChange={(e) => setRouteForm((c) => ({ ...c, name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-widest text-warmsilver">Водитель</Label>
                  <Select value={routeForm.driverId} onValueChange={(v) => setRouteForm((c) => ({ ...c, driverId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Назначить позже" /></SelectTrigger>
                    <SelectContent>
                      {drivers.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-widest text-warmsilver">Транспорт</Label>
                  <Select value={routeForm.vehicleId} onValueChange={(v) => setRouteForm((c) => ({ ...c, vehicleId: v }))}>
                    <SelectTrigger><SelectValue placeholder="Назначить позже" /></SelectTrigger>
                    <SelectContent>
                      {vehicles.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.plateNumber}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={() => createRouteMutation.mutate()}
                disabled={!routeForm.startPointId || !routeForm.endPointId || createRouteMutation.isPending}
                className="w-full bg-plum hover:bg-plum/90 text-white"
              >
                {createRouteMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Создаём...</>
                  : <><RouteIcon className="h-4 w-4 mr-2" />Создать маршрут</>}
              </Button>
            </div>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Текущие рейсы</CardTitle>
                <CardDescription>
                  {routes.length} маршрутов в журнале
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {routes.map((route) => (
                  <Card key={route.id} className="border-l-4 border-l-blue-500">
                    <CardContent className="pt-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-semibold">{route.name}</span>
                            <Badge variant={statusTone(route.status)}>
                              {statusLabel(route.status)}
                            </Badge>
                            {typeof route.riskScore === "number" && (
                              <Badge variant="outline">
                                Risk {Math.round(route.riskScore * 100)}%
                              </Badge>
                            )}
                            {typeof route.fuelCostRub === "number" && (
                              <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50">
                                ⛽ {Math.round(route.fuelCostRub).toLocaleString("ru-RU")} ₽
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mb-1">
                            {route.startPoint?.name || "Старт"} →{" "}
                            {route.endPoint?.name || "Финиш"}
                          </p>
                          <div className="flex flex-wrap gap-x-4 text-xs text-gray-500">
                            <span>
                              Водитель:{" "}
                              {route.driver?.user?.name || "не назначен"}
                            </span>
                            <span>
                              ТС: {route.vehicle?.plateNumber || "—"}
                            </span>
                            <span>
                              ETA:{" "}
                              {route.estimatedTime
                                ? `${route.estimatedTime} мин`
                                : "—"}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {!route.driver && (
                              <AutoAssignButton
                                routeId={route.id}
                                routeName={route.name}
                                onSuccess={() => queryClient.invalidateQueries({ queryKey: ["routes"] })}
                              />
                            )}
                            {route.trackingToken && (
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(`${window.location.origin}/track/${route.trackingToken}`);
                                }}
                                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 transition"
                                title="Скопировать ссылку для клиента"
                              >
                                <Copy className="h-3 w-3" />
                                Ссылка клиенту
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="locations" className="space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="shadow-lg">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus className="h-5 w-5 text-emerald-500" />
                    Новая точка сети
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Name + Type row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Название</Label>
                      <Input
                        placeholder="Склад Центральный"
                        value={locationForm.name}
                        onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Тип</Label>
                      <Select
                        value={locationForm.type}
                        onValueChange={(v) => {
                          const t = v as LocationPoint["type"];
                          setLocationForm({ ...locationForm, type: t, code: generateLocationCode(t) });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="WAREHOUSE">Склад</SelectItem>
                          <SelectItem value="PICKUP_POINT">ПВЗ</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Auto-generated code */}
                  <div className="flex items-center justify-between rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-2.5">
                    <div>
                      <p className="text-xs text-gray-500">Код точки (авто)</p>
                      <p className="font-mono text-sm font-semibold text-gray-800">{locationForm.code}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLocationForm((f) => ({ ...f, code: generateLocationCode(f.type) }))}
                      className="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-200 transition"
                    >
                      Обновить
                    </button>
                  </div>

                  {/* Address search with autocomplete */}
                  <div className="space-y-2">
                    <Label>Поиск города / адреса</Label>
                    <div className="relative">
                      <Input
                        value={addrQuery}
                        onChange={(e) => handleAddrSearch(e.target.value)}
                        onBlur={() => setTimeout(() => setShowAddrDropdown(false), 150)}
                        placeholder="Начните вводить город или адрес..."
                      />
                      {addrLoading && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" />
                      )}
                      {showAddrDropdown && addrSuggestions.length > 0 && (
                        <div className="absolute z-50 top-full mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                          {addrSuggestions.map((s, i) => (
                            <button
                              key={i}
                              type="button"
                              onMouseDown={() => handleAddrSelect(s)}
                              className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0 transition"
                            >
                              <p className="text-sm font-medium text-gray-900 truncate">{s.city || s.displayName}</p>
                              <p className="text-xs text-gray-500 truncate">{s.displayName}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* City + Address editable after selection */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Город</Label>
                      <Input
                        value={locationForm.city}
                        placeholder="Москва"
                        onChange={(e) => setLocationForm({ ...locationForm, city: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Адрес</Label>
                      <Input
                        value={locationForm.address}
                        placeholder="ул. Тверская, 1"
                        onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Точка на карте</Label>
                    <div className="rounded-2xl border border-gray-200 overflow-hidden">
                      <MapView
                        selectable
                        fitToData
                        className="h-[320px] w-full rounded-none"
                        selectedCoordinates={locationPick}
                        points={locations.map((item) => ({
                          id: `location-${item.id}`,
                          entityId: item.id,
                          kind:
                            item.type === "WAREHOUSE"
                              ? ("warehouse" as const)
                              : ("pickup" as const),
                          title: item.name,
                          subtitle: `${item.city}, ${item.address}`,
                          longitude: item.lon,
                          latitude: item.lat,
                        }))}
                        onSelect={(selection) => {
                          const coords: [number, number] = [
                            selection.longitude,
                            selection.latitude,
                          ];
                          setLocationPick(coords);
                          setLocationForm((current) => ({
                            ...current,
                            lat: selection.latitude.toFixed(6),
                            lon: selection.longitude.toFixed(6),
                          }));
                        }}
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      {locationPick
                        ? `Выбрано: ${locationPick[1].toFixed(6)}, ${locationPick[0].toFixed(6)}`
                        : "Кликните по карте, чтобы выбрать координату"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Примечание</Label>
                    <Textarea
                      value={locationForm.notes}
                      rows={2}
                      onChange={(e) =>
                        setLocationForm({
                          ...locationForm,
                          notes: e.target.value,
                        })
                      }
                    />
                  </div>
                  <Button
                    onClick={() => createLocationMutation.mutate()}
                    disabled={
                      !locationForm.name ||
                      !locationForm.city ||
                      !locationForm.address ||
                      !locationPick ||
                      createLocationMutation.isPending
                    }
                    className="w-full bg-emerald-500 hover:bg-emerald-600"
                  >
                    {createLocationMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Добавить
                  </Button>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card className="shadow-lg">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Warehouse className="h-5 w-5 text-orange-500" />
                      Склады ({warehouses.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {warehouses.length === 0 && (
                      <p className="text-sm text-gray-400 py-2 text-center">Нет складов</p>
                    )}
                    {warehouses.map((item) => (
                      <div key={item.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm leading-tight">{item.name}</p>
                          {item.code && (
                            <span className="shrink-0 font-mono text-xs bg-orange-100 text-orange-700 rounded px-1.5 py-0.5">{item.code}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600">{item.city}</p>
                        <p className="text-xs text-gray-500 truncate">{item.address}</p>
                        <p className="text-xs text-gray-400 font-mono">{item.lat.toFixed(4)}, {item.lon.toFixed(4)}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="shadow-lg">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Package className="h-5 w-5 text-blue-500" />
                      ПВЗ ({pickupPoints.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {pickupPoints.length === 0 && (
                      <p className="text-sm text-gray-400 py-2 text-center">Нет ПВЗ</p>
                    )}
                    {pickupPoints.map((item) => (
                      <div key={item.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm leading-tight">{item.name}</p>
                          {item.code && (
                            <span className="shrink-0 font-mono text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">{item.code}</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600">{item.city}</p>
                        <p className="text-xs text-gray-500 truncate">{item.address}</p>
                        <p className="text-xs text-gray-400 font-mono">{item.lat.toFixed(4)}, {item.lon.toFixed(4)}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="maintenance" className="space-y-6">
            <MaintenancePanel />
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}
