"use client";

import { useState } from "react";
import {
  CheckCircle,
  Clock,
  Mail,
  MapPin,
  Package,
  Phone,
  Settings,
  User,
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
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export default function CustomerDashboard() {
  const [customer] = useState({
    name: "Анна Смирнова",
    email: "anna.smirnova@example.com",
    phone: "+7 (999) 123-45-67",
    address: "Москва, ул. Ленина 15, кв. 42",
    registrationDate: "15 января 2024",
  });

  const [orders] = useState([
    {
      id: "LG1234567",
      from: "Санкт-Петербург",
      to: "Москва, ул. Ленина 15",
      status: "Доставлено",
      statusColor: "success" as const,
      date: "12.04.2026",
      deliveredDate: "15.04.2026",
      trackingHistory: [
        {
          date: "12.04.2026 10:00",
          status: "Принято на складе",
          location: "СПб, Склад №1",
        },
        { date: "13.04.2026 14:30", status: "В пути", location: "Москва" },
        {
          date: "15.04.2026 11:20",
          status: "Доставлено",
          location: "Москва, ПВЗ Ленина",
        },
      ],
    },
    {
      id: "LG1234890",
      from: "Москва",
      to: "Москва, ул. Ленина 15",
      status: "В пути",
      statusColor: "default" as const,
      date: "16.04.2026",
      deliveredDate: null,
      trackingHistory: [
        {
          date: "16.04.2026 09:00",
          status: "Принято на складе",
          location: "Москва, Склад №1",
        },
        {
          date: "17.04.2026 10:30",
          status: "В пути к ПВЗ",
          location: "Москва",
        },
      ],
    },
    {
      id: "LG1234891",
      from: "Казань",
      to: "Москва, ул. Ленина 15",
      status: "Ожидает отправки",
      statusColor: "secondary" as const,
      date: "17.04.2026",
      deliveredDate: null,
      trackingHistory: [
        { date: "17.04.2026 08:00", status: "Создан заказ", location: "Казань" },
      ],
    },
  ]);

  const activeOrders = orders.filter((o) => o.status !== "Доставлено");
  const completedOrders = orders.filter((o) => o.status === "Доставлено");

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="bg-purple-600 text-white py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="bg-white rounded-full p-4">
              <User className="h-10 w-10 text-purple-600" />
            </div>
            <div>
              <h1 className="text-3xl font-bold mb-1">{customer.name}</h1>
              <p className="text-purple-100">Личный кабинет клиента</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Всего заказов</p>
                  <p className="text-2xl font-bold">{orders.length}</p>
                </div>
                <Package className="h-8 w-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Активных</p>
                  <p className="text-2xl font-bold">{activeOrders.length}</p>
                </div>
                <Clock className="h-8 w-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Доставлено</p>
                  <p className="text-2xl font-bold">
                    {completedOrders.length}
                  </p>
                </div>
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <Card className="shadow-lg">
              <Tabs defaultValue="active" className="w-full">
                <CardHeader>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="active">
                      Активные заказы ({activeOrders.length})
                    </TabsTrigger>
                    <TabsTrigger value="history">
                      История ({completedOrders.length})
                    </TabsTrigger>
                  </TabsList>
                </CardHeader>

                <CardContent>
                  <TabsContent value="active" className="space-y-4">
                    {activeOrders.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>Нет активных заказов</p>
                      </div>
                    ) : (
                      activeOrders.map((order) => (
                        <Card
                          key={order.id}
                          className="border-l-4 border-l-emerald-500"
                        >
                          <CardHeader>
                            <div className="flex items-start justify-between">
                              <div>
                                <CardTitle className="text-base flex items-center gap-2">
                                  Заказ {order.id}
                                  <Badge variant={order.statusColor}>
                                    {order.status}
                                  </Badge>
                                </CardTitle>
                                <CardDescription className="mt-1">
                                  Создан: {order.date}
                                </CardDescription>
                              </div>
                              <Button variant="outline" size="sm">
                                Подробнее
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-3">
                              <div className="flex items-start gap-2">
                                <MapPin className="h-4 w-4 text-emerald-500 mt-0.5" />
                                <div className="flex-1">
                                  <p className="text-sm font-medium">Маршрут</p>
                                  <p className="text-sm text-gray-600">
                                    {order.from} → {order.to}
                                  </p>
                                </div>
                              </div>
                              <Separator />
                              <div>
                                <p className="text-sm font-medium mb-2">
                                  История отслеживания
                                </p>
                                <div className="space-y-2">
                                  {order.trackingHistory.map((event, index) => (
                                    <div
                                      key={index}
                                      className="flex gap-2 text-sm"
                                    >
                                      <div className="flex flex-col items-center">
                                        <div
                                          className={`rounded-full p-1 ${
                                            index ===
                                            order.trackingHistory.length - 1
                                              ? "bg-emerald-500"
                                              : "bg-gray-300"
                                          }`}
                                        >
                                          <div className="w-2 h-2 bg-white rounded-full" />
                                        </div>
                                        {index <
                                          order.trackingHistory.length - 1 && (
                                          <div className="w-0.5 h-6 bg-gray-300" />
                                        )}
                                      </div>
                                      <div className="flex-1 pb-2">
                                        <p className="font-medium">
                                          {event.status}
                                        </p>
                                        <p className="text-xs text-gray-600">
                                          {event.location}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                          {event.date}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </TabsContent>

                  <TabsContent value="history" className="space-y-4">
                    {completedOrders.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <CheckCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>История заказов пуста</p>
                      </div>
                    ) : (
                      completedOrders.map((order) => (
                        <Card
                          key={order.id}
                          className="border-l-4 border-l-green-500"
                        >
                          <CardHeader>
                            <div className="flex items-start justify-between">
                              <div>
                                <CardTitle className="text-base flex items-center gap-2">
                                  Заказ {order.id}
                                  <Badge
                                    variant="outline"
                                    className="bg-green-50 text-green-700 border-green-200"
                                  >
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    {order.status}
                                  </Badge>
                                </CardTitle>
                                <CardDescription className="mt-1">
                                  Доставлен: {order.deliveredDate}
                                </CardDescription>
                              </div>
                              <Button variant="outline" size="sm">
                                Повторить
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-start gap-2">
                              <MapPin className="h-4 w-4 text-gray-500 mt-0.5" />
                              <div className="flex-1">
                                <p className="text-sm font-medium">Маршрут</p>
                                <p className="text-sm text-gray-600">
                                  {order.from} → {order.to}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </TabsContent>
                </CardContent>
              </Tabs>
            </Card>
          </div>

          <div>
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-purple-500" />
                  Мой профиль
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs text-gray-600">ФИО</Label>
                    <p className="font-medium">{customer.name}</p>
                  </div>
                  <Separator />
                  <div>
                    <Label className="text-xs text-gray-600 flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      Email
                    </Label>
                    <p className="text-sm">{customer.email}</p>
                  </div>
                  <Separator />
                  <div>
                    <Label className="text-xs text-gray-600 flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      Телефон
                    </Label>
                    <p className="text-sm">{customer.phone}</p>
                  </div>
                  <Separator />
                  <div>
                    <Label className="text-xs text-gray-600 flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      Адрес доставки
                    </Label>
                    <p className="text-sm">{customer.address}</p>
                  </div>
                  <Separator />
                  <div>
                    <Label className="text-xs text-gray-600">Клиент с</Label>
                    <p className="text-sm">{customer.registrationDate}</p>
                  </div>
                </div>

                <Button variant="outline" className="w-full" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  Редактировать профиль
                </Button>
              </CardContent>
            </Card>

            <Card className="shadow-lg mt-4">
              <CardHeader>
                <CardTitle className="text-base">Быстрые действия</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  size="sm"
                >
                  <Package className="h-4 w-4 mr-2" />
                  Создать новый заказ
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  size="sm"
                >
                  <MapPin className="h-4 w-4 mr-2" />
                  Найти ближайший ПВЗ
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
