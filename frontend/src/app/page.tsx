"use client";

import { useState } from "react";
import {
  CheckCircle,
  Clock,
  MapPin,
  Package,
  Search,
  Truck,
} from "lucide-react";
import { toast } from "@/lib/sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { publicCreateOrder, publicGeocodeAddress, publicTrackRoute } from "@/lib/api";

type TrackingHistoryItem = {
  date: string;
  status: string;
  location: string;
};

type TrackingResult = {
  number: string;
  status: string;
  currentLocation: string;
  estimatedDelivery: string;
  history: TrackingHistoryItem[];
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function routeStatusLabel(status?: string) {
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
      return "Пересчёт маршрута";
    default:
      return "—";
  }
}

export default function HomePage() {
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingResult, setTrackingResult] = useState<TrackingResult | null>(
    null
  );
  const [isTracking, setIsTracking] = useState(false);

  const [orderForm, setOrderForm] = useState({
    from: "",
    to: "",
    weight: "",
    description: "",
  });
  const [isCreating, setIsCreating] = useState(false);

  const handleTrack = async () => {
    if (!trackingNumber.trim()) {
      toast.error("Введите номер отслеживания");
      return;
    }

    const numericId = Number(trackingNumber.replace(/[^0-9]/g, ""));
    setIsTracking(true);

    try {
      if (!Number.isFinite(numericId) || numericId <= 0) {
        throw new Error("Некорректный номер");
      }

      const route = await publicTrackRoute(numericId);
      const history: TrackingHistoryItem[] = (route.gpsLogs ?? [])
        .slice(0, 5)
        .map((log) => ({
          date: formatDate(log.timestamp),
          status: "GPS",
          location: `${log.lat.toFixed(3)}, ${log.lon.toFixed(3)}`,
        }));

      setTrackingResult({
        number: String(route.id ?? trackingNumber),
        status: routeStatusLabel(route.status),
        currentLocation:
          route.endPoint?.address ?? route.startPoint?.address ?? "—",
        estimatedDelivery: route.estimatedTime
          ? `${Math.round(route.estimatedTime / 60)} мин в пути`
          : "—",
        history,
      });
      toast.success("Заказ найден");
    } catch {
      setTrackingResult(null);
      toast.error("Заказ не найден или сервис недоступен");
    } finally {
      setIsTracking(false);
    }
  };

  const handleCreateOrder = async () => {
    if (!orderForm.from || !orderForm.to) {
      toast.error("Заполните адреса отправителя и получателя");
      return;
    }
    setIsCreating(true);
    try {
      const [fromGeo] = await publicGeocodeAddress(orderForm.from);
      const [toGeo] = await publicGeocodeAddress(orderForm.to);
      if (!fromGeo || !toGeo) {
        throw new Error("Не удалось определить координаты");
      }
      const route = await publicCreateOrder({
        startLat: fromGeo.lat,
        startLon: fromGeo.lon,
        startName: fromGeo.displayName,
        startCity: fromGeo.city,
        startAddress: fromGeo.address,
        endLat: toGeo.lat,
        endLon: toGeo.lon,
        endName: toGeo.displayName,
        endCity: toGeo.city,
        endAddress: toGeo.address,
      });
      toast.success(`Заказ создан! Номер: ${route.id}`);
      setOrderForm({ from: "", to: "", weight: "", description: "" });
    } catch {
      toast.error("Не удалось создать заказ. Проверьте, что backend запущен.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-screen">
      <section className="py-12 md:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
              Быстрая доставка по всей России
            </h1>
            <p className="text-xl text-gray-600">
              Отслеживайте посылки в режиме реального времени
            </p>
          </div>

          <Card className="max-w-2xl mx-auto mb-8 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-emerald-500" />
                Отследить заказ
              </CardTitle>
              <CardDescription>
                Введите номер отслеживания для проверки статуса доставки
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2">
                <Input
                  placeholder="Например: LG1234567"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTrack()}
                  className="flex-1"
                />
                <Button
                  onClick={handleTrack}
                  disabled={isTracking}
                  className="bg-emerald-500 hover:bg-emerald-600"
                >
                  {isTracking ? "Ищем..." : "Отследить"}
                </Button>
              </div>

              {trackingResult && (
                <div className="mt-6 p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-sm text-gray-600">Номер заказа</p>
                      <p className="font-semibold text-lg">
                        {trackingResult.number}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-600">Статус</p>
                      <p className="font-semibold text-emerald-600">
                        {trackingResult.status}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {trackingResult.history.map((item, index) => (
                      <div key={index} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div
                            className={`rounded-full p-1 ${
                              index === trackingResult.history.length - 1
                                ? "bg-emerald-500"
                                : "bg-gray-300"
                            }`}
                          >
                            {index === trackingResult.history.length - 1 ? (
                              <Truck className="h-4 w-4 text-white" />
                            ) : (
                              <CheckCircle className="h-4 w-4 text-white" />
                            )}
                          </div>
                          {index < trackingResult.history.length - 1 && (
                            <div className="w-0.5 h-8 bg-gray-300" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">{item.status}</p>
                          <p className="text-sm text-gray-600">
                            {item.location}
                          </p>
                          <p className="text-xs text-gray-500">{item.date}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 pt-4 border-t border-emerald-200">
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-gray-600" />
                      <span className="text-gray-600">Ожидаемая доставка:</span>
                      <span className="font-semibold">
                        {trackingResult.estimatedDelivery}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="max-w-2xl mx-auto shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-emerald-500" />
                Создать заказ
              </CardTitle>
              <CardDescription>
                Оформите доставку быстро и удобно
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="from" className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-emerald-500" />
                    Откуда
                  </Label>
                  <Input
                    id="from"
                    placeholder="Город, адрес отправителя"
                    value={orderForm.from}
                    onChange={(e) =>
                      setOrderForm({ ...orderForm, from: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="to" className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-emerald-500" />
                    Куда
                  </Label>
                  <Input
                    id="to"
                    placeholder="Город, адрес получателя"
                    value={orderForm.to}
                    onChange={(e) =>
                      setOrderForm({ ...orderForm, to: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="weight">Вес (кг)</Label>
                <Input
                  id="weight"
                  type="number"
                  placeholder="Вес посылки"
                  value={orderForm.weight}
                  onChange={(e) =>
                    setOrderForm({ ...orderForm, weight: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Описание груза</Label>
                <Textarea
                  id="description"
                  placeholder="Опишите содержимое посылки"
                  value={orderForm.description}
                  onChange={(e) =>
                    setOrderForm({ ...orderForm, description: e.target.value })
                  }
                  rows={3}
                />
              </div>

              <Button
                onClick={handleCreateOrder}
                disabled={isCreating}
                className="w-full bg-emerald-500 hover:bg-emerald-600"
              >
                {isCreating ? "Создаём..." : "Оформить заказ"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-center mb-12">
            Наши преимущества
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-emerald-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Truck className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Быстрая доставка</h3>
              <p className="text-gray-600">
                Доставляем грузы по всей России в кратчайшие сроки
              </p>
            </div>
            <div className="text-center">
              <div className="bg-emerald-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <MapPin className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Отслеживание 24/7</h3>
              <p className="text-gray-600">
                Следите за посылкой в режиме реального времени
              </p>
            </div>
            <div className="text-center">
              <div className="bg-emerald-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Гарантия качества</h3>
              <p className="text-gray-600">
                Бережная обработка и доставка ваших грузов
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
