"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle,
  Loader2,
  MapPin,
  Package,
  Plus,
  ShoppingBag,
  Star,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  acceptBid,
  completeMarketplaceOrder,
  createMarketplaceOrder,
  deleteMarketplaceOrder,
  getMarketplaceOrders,
  submitBid,
  type MarketplaceOrder,
} from "@/lib/api";
import { getStoredUser } from "@/lib/session";

function statusLabel(status: string) {
  const map: Record<string, string> = {
    OPEN: "Открыта",
    IN_PROGRESS: "В работе",
    COMPLETED: "Завершена",
    CANCELLED: "Отменена",
  };
  return map[status] ?? status;
}

function statusTone(status: string): "default" | "secondary" | "success" | "destructive" | "outline" {
  if (status === "OPEN") return "default";
  if (status === "IN_PROGRESS") return "secondary";
  if (status === "COMPLETED") return "success";
  if (status === "CANCELLED") return "destructive";
  return "outline";
}

function bidStatusLabel(s: string) {
  return { PENDING: "Ожидает", ACCEPTED: "Принята", REJECTED: "Отклонена" }[s] ?? s;
}

export default function MarketplacePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [user, setUser] = useState<{ id: number; role: string; driverProfileId?: number | null } | null>(null);

  useEffect(() => {
    const u = getStoredUser();
    if (!u) { router.replace("/login"); return; }
    setUser(u as any);
  }, [router]);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["marketplace"],
    queryFn: () => getMarketplaceOrders(),
    enabled: !!user,
    refetchInterval: 15_000,
  });

  const [form, setForm] = useState({
    title: "",
    description: "",
    startCity: "",
    startAddress: "",
    endCity: "",
    endAddress: "",
    budget: "",
  });
  const [bidForms, setBidForms] = useState<Record<number, { price: string; time: string; message: string }>>({});

  const createMut = useMutation({
    mutationFn: () => createMarketplaceOrder({
      title: form.title,
      description: form.description || undefined,
      startAddress: form.startAddress,
      endAddress: form.endAddress,
      startCity: form.startCity,
      endCity: form.endCity,
      startLat: 55.75,
      startLon: 37.62,
      endLat: 59.93,
      endLon: 30.32,
      budget: form.budget ? Number(form.budget) : undefined,
    }),
    onSuccess: () => {
      toast.success("Заявка создана!");
      setForm({ title: "", description: "", startCity: "", startAddress: "", endCity: "", endAddress: "", budget: "" });
      qc.invalidateQueries({ queryKey: ["marketplace"] });
    },
    onError: () => toast.error("Ошибка создания"),
  });

  const bidMut = useMutation({
    mutationFn: ({ orderId, data }: { orderId: number; data: { proposedPrice?: number; estimatedTime?: number; message?: string } }) =>
      submitBid(orderId, data),
    onSuccess: (_, { orderId }) => {
      toast.success("Ставка подана!");
      setBidForms((prev) => ({ ...prev, [orderId]: { price: "", time: "", message: "" } }));
      qc.invalidateQueries({ queryKey: ["marketplace"] });
    },
    onError: () => toast.error("Ошибка ставки"),
  });

  const acceptMut = useMutation({
    mutationFn: ({ orderId, bidId }: { orderId: number; bidId: number }) => acceptBid(orderId, bidId),
    onSuccess: () => { toast.success("Ставка принята!"); qc.invalidateQueries({ queryKey: ["marketplace"] }); },
  });

  const completeMut = useMutation({
    mutationFn: (id: number) => completeMarketplaceOrder(id),
    onSuccess: () => { toast.success("Заявка завершена"); qc.invalidateQueries({ queryKey: ["marketplace"] }); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteMarketplaceOrder(id),
    onSuccess: () => { toast.success("Заявка удалена"); qc.invalidateQueries({ queryKey: ["marketplace"] }); },
  });

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );

  const isDriver = user.role === "DRIVER";
  const openOrders = orders.filter((o) => o.status === "OPEN");
  const myOrders = orders.filter((o) => o.createdBy.id === user.id);

  return (
    <div className="min-h-screen pb-8">
      <div className="border-b border-sand/80 bg-white/65 py-6 text-plum backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="rounded-lg p-2 hover:bg-gray-100 transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="rounded-2xl bg-sand p-3 text-pinterest shadow-[0_20px_40px_rgba(16,60,37,0.10)]">
              <ShoppingBag className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Биржа водителей</h1>
              <p className="text-warmsilver text-sm">Свободный рынок грузоперевозок</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <p className="text-2xl font-bold">{openOrders.length}</p>
              <p className="text-xs text-gray-500">открытых</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{orders.length}</p>
              <p className="text-xs text-gray-500">всего</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <Tabs defaultValue={isDriver ? "browse" : "my"} className="space-y-6">
          <Card className="shadow-sm">
            <CardContent className="p-2">
              <TabsList className={`grid w-full ${isDriver ? "grid-cols-2" : "grid-cols-3"}`}>
                {!isDriver && <TabsTrigger value="my">Мои заявки</TabsTrigger>}
                <TabsTrigger value="browse">Все заявки</TabsTrigger>
                {!isDriver && <TabsTrigger value="create">Создать</TabsTrigger>}
                {isDriver && <TabsTrigger value="bids">Мои ставки</TabsTrigger>}
              </TabsList>
            </CardContent>
          </Card>

          {!isDriver && (
            <TabsContent value="my" className="space-y-4">
              {myOrders.length === 0 ? (
                <Card><CardContent className="pt-6 text-center text-gray-500">У вас нет заявок</CardContent></Card>
              ) : (
                myOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    canManage
                    onAccept={(bidId) => acceptMut.mutate({ orderId: order.id, bidId })}
                    onComplete={() => completeMut.mutate(order.id)}
                    onDelete={() => deleteMut.mutate(order.id)}
                  />
                ))
              )}
            </TabsContent>
          )}

          <TabsContent value="browse" className="space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              </div>
            ) : orders.length === 0 ? (
              <Card><CardContent className="pt-6 text-center text-gray-500">Нет заявок</CardContent></Card>
            ) : (
              orders.map((order) => (
                <Card key={order.id} className={`shadow-lg border-l-4 ${order.status === "OPEN" ? "border-l-blue-500" : order.status === "IN_PROGRESS" ? "border-l-amber-500" : order.status === "COMPLETED" ? "border-l-green-500" : "border-l-red-400"}`}>
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-semibold">{order.title}</span>
                          <Badge variant={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
                          {order.budget && (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                              {order.budget.toLocaleString()} ₽
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-600">
                          <MapPin className="inline h-3 w-3 mr-1" />
                          {order.startCity} → {order.endCity}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{order.startAddress} → {order.endAddress}</p>
                        <p className="text-xs text-gray-400 mt-1">Создал: {order.createdBy.name} · {new Date(order.createdAt).toLocaleDateString("ru")}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{order.bids.length} ставок</p>
                      </div>
                    </div>

                    {isDriver && order.status === "OPEN" && (
                      <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 space-y-2">
                        <p className="text-sm font-semibold text-blue-800">Подать ставку</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Цена (₽)</Label>
                            <Input
                              type="number"
                              placeholder="5000"
                              value={bidForms[order.id]?.price ?? ""}
                              onChange={(e) => setBidForms((prev) => ({ ...prev, [order.id]: { ...prev[order.id], price: e.target.value } }))}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">ETA (мин)</Label>
                            <Input
                              type="number"
                              placeholder="180"
                              value={bidForms[order.id]?.time ?? ""}
                              onChange={(e) => setBidForms((prev) => ({ ...prev, [order.id]: { ...prev[order.id], time: e.target.value } }))}
                            />
                          </div>
                        </div>
                        <Input
                          placeholder="Сообщение (опционально)"
                          value={bidForms[order.id]?.message ?? ""}
                          onChange={(e) => setBidForms((prev) => ({ ...prev, [order.id]: { ...prev[order.id], message: e.target.value } }))}
                        />
                        <Button
                          size="sm"
                          className="w-full bg-blue-500 hover:bg-blue-600"
                          disabled={bidMut.isPending}
                          onClick={() => bidMut.mutate({
                            orderId: order.id,
                            data: {
                              proposedPrice: bidForms[order.id]?.price ? Number(bidForms[order.id].price) : undefined,
                              estimatedTime: bidForms[order.id]?.time ? Number(bidForms[order.id].time) : undefined,
                              message: bidForms[order.id]?.message || undefined,
                            },
                          })}
                        >
                          {bidMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Truck className="h-4 w-4 mr-2" />}
                          Предложить
                        </Button>
                      </div>
                    )}

                    {order.bids.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ставки</p>
                        {order.bids.map((bid) => (
                          <div key={bid.id} className={`flex items-center justify-between rounded-lg p-2 text-sm ${bid.status === "ACCEPTED" ? "bg-emerald-50 border border-emerald-200" : "bg-gray-50"}`}>
                            <div>
                              <span className="font-medium">{bid.driver?.user?.name ?? "Водитель"}</span>
                              {bid.proposedPrice && <span className="ml-2 text-emerald-600 font-semibold">{bid.proposedPrice.toLocaleString()} ₽</span>}
                              {bid.estimatedTime && <span className="ml-2 text-gray-500">{bid.estimatedTime} мин</span>}
                              {bid.message && <p className="text-xs text-gray-500 mt-0.5">{bid.message}</p>}
                            </div>
                            <Badge variant={bid.status === "ACCEPTED" ? "success" : bid.status === "REJECTED" ? "destructive" : "outline"}>
                              {bidStatusLabel(bid.status)}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {!isDriver && (
            <TabsContent value="create">
              <Card className="shadow-lg max-w-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Plus className="h-5 w-5 text-blue-500" />
                    Новая заявка
                  </CardTitle>
                  <CardDescription>Разместите заявку — водители предложат свои условия</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Название заявки</Label>
                    <Input placeholder="Перевозка груза Москва → СПб" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Описание / требования</Label>
                    <Textarea rows={2} placeholder="Описание груза, требования к ТС..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Город отправления</Label>
                      <Input placeholder="Москва" value={form.startCity} onChange={(e) => setForm({ ...form, startCity: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Город назначения</Label>
                      <Input placeholder="Санкт-Петербург" value={form.endCity} onChange={(e) => setForm({ ...form, endCity: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Адрес отправления</Label>
                      <Input placeholder="ул. Тверская, 1" value={form.startAddress} onChange={(e) => setForm({ ...form, startAddress: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Адрес назначения</Label>
                      <Input placeholder="Невский пр., 1" value={form.endAddress} onChange={(e) => setForm({ ...form, endAddress: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Бюджет (₽, опционально)</Label>
                    <Input type="number" placeholder="10000" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} />
                  </div>
                  <Button
                    className="w-full bg-blue-500 hover:bg-blue-600"
                    disabled={!form.title || !form.startCity || !form.endCity || createMut.isPending}
                    onClick={() => createMut.mutate()}
                  >
                    {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                    Разместить заявку
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

function OrderCard({ order, canManage, onAccept, onComplete, onDelete }: {
  order: MarketplaceOrder;
  canManage?: boolean;
  onAccept?: (bidId: number) => void;
  onComplete?: () => void;
  onDelete?: () => void;
}) {
  return (
    <Card className={`shadow-lg border-l-4 ${order.status === "OPEN" ? "border-l-blue-500" : order.status === "IN_PROGRESS" ? "border-l-amber-500" : "border-l-green-500"}`}>
      <CardContent className="pt-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold">{order.title}</span>
              <Badge variant={order.status === "OPEN" ? "default" : order.status === "IN_PROGRESS" ? "secondary" : "success"}>
                {order.status === "OPEN" ? "Открыта" : order.status === "IN_PROGRESS" ? "В работе" : "Завершена"}
              </Badge>
              {order.budget && <Badge variant="outline" className="text-emerald-600">{order.budget.toLocaleString()} ₽</Badge>}
            </div>
            <p className="text-sm text-gray-600">{order.startCity} → {order.endCity}</p>
            <p className="text-xs text-gray-500">{order.bids.length} ставок</p>
          </div>
          {canManage && order.status === "IN_PROGRESS" && (
            <Button size="sm" variant="outline" className="gap-2" onClick={onComplete}>
              <CheckCircle className="h-4 w-4 text-emerald-500" />Завершить
            </Button>
          )}
        </div>

        {order.bids.length > 0 && (
          <div className="space-y-2">
            {order.bids.map((bid) => (
              <div key={bid.id} className={`flex items-center justify-between rounded-lg p-2 text-sm ${bid.status === "ACCEPTED" ? "bg-emerald-50 border border-emerald-200" : "bg-gray-50"}`}>
                <div>
                  <span className="font-medium">{bid.driver?.user?.name}</span>
                  {bid.proposedPrice && <span className="ml-2 text-emerald-600 font-semibold">{bid.proposedPrice.toLocaleString()} ₽</span>}
                  {bid.estimatedTime && <span className="ml-2 text-gray-500">{bid.estimatedTime} мин</span>}
                  {bid.message && <p className="text-xs text-gray-500 mt-0.5">{bid.message}</p>}
                </div>
                {canManage && order.status === "OPEN" && bid.status === "PENDING" && (
                  <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 gap-1" onClick={() => onAccept?.(bid.id)}>
                    <CheckCircle className="h-3 w-3" />Принять
                  </Button>
                )}
                {bid.status !== "PENDING" && (
                  <Badge variant={bid.status === "ACCEPTED" ? "success" : "destructive"}>
                    {bid.status === "ACCEPTED" ? "Принята" : "Отклонена"}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
