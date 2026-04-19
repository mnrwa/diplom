"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Loader2, Plus, Route, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createMultistop, type LocationPoint } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  locations: LocationPoint[];
  onSuccess?: () => void;
}

export function MultistopForm({ locations, onSuccess }: Props) {
  const qc = useQueryClient();
  const warehouses = locations.filter((l) => l.type === "WAREHOUSE");
  const pickupPoints = locations.filter((l) => l.type === "PICKUP_POINT");

  const [name, setName] = useState("");
  const [startId, setStartId] = useState("");
  const [stops, setStops] = useState<string[]>([""]);

  const mutation = useMutation({
    mutationFn: () => {
      const stopIds = stops.map(Number).filter(Boolean);
      if (!startId || !stopIds.length) throw new Error("Укажите старт и хотя бы 1 точку");
      return createMultistop({ name: name || "Мультистоп", startPointId: Number(startId), stopIds });
    },
    onSuccess: (route) => {
      toast.success(`Мультистоп «${route.name}» создан (${route.stops.length} точек)`);
      setName(""); setStartId(""); setStops([""]);
      qc.invalidateQueries({ queryKey: ["multistop"] });
      onSuccess?.();
    },
    onError: (e: any) => toast.error(e.message ?? "Ошибка"),
  });

  const addStop = () => setStops((prev) => [...prev, ""]);
  const removeStop = (idx: number) => setStops((prev) => prev.filter((_, i) => i !== idx));
  const updateStop = (idx: number, val: string) => setStops((prev) => prev.map((s, i) => (i === idx ? val : s)));

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Route className="h-5 w-5 text-purple-500" />
          Мультистоп маршрут
        </CardTitle>
        <CardDescription>TSP-оптимизация порядка объезда точек</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Название</Label>
          <Input placeholder="Объезд ПВЗ Москва" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Стартовая точка (склад)</Label>
          <Select value={startId} onValueChange={setStartId}>
            <SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>{w.city} · {w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Точки объезда</Label>
          {stops.map((stop, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <GripVertical className="h-4 w-4 text-gray-400 shrink-0" />
              <Select value={stop} onValueChange={(v) => updateStop(idx, v)}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={`Точка ${idx + 1}`} />
                </SelectTrigger>
                <SelectContent>
                  {pickupPoints.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.city} · {p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" onClick={() => removeStop(idx)} disabled={stops.length === 1}>
                <Trash2 className="h-4 w-4 text-red-400" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addStop} className="gap-2">
            <Plus className="h-4 w-4" />
            Добавить точку
          </Button>
        </div>

        <Button
          onClick={() => mutation.mutate()}
          disabled={!startId || stops.every((s) => !s) || mutation.isPending}
          className="w-full bg-purple-500 hover:bg-purple-600"
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Route className="h-4 w-4 mr-2" />}
          Создать маршрут (TSP)
        </Button>
      </CardContent>
    </Card>
  );
}
