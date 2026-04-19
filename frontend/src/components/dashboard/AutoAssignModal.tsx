"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, CheckCircle, Loader2, Star, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { autoAssignRoute, type AutoAssignResult } from "@/lib/api";

interface Props {
  routeId: number;
  routeName: string;
  onSuccess?: () => void;
}

export function AutoAssignButton({ routeId, routeName, onSuccess }: Props) {
  const [result, setResult] = useState<AutoAssignResult | null>(null);

  const mutation = useMutation({
    mutationFn: () => autoAssignRoute(routeId),
    onSuccess: (data) => {
      setResult(data);
      if (data.ok) onSuccess?.();
    },
  });

  if (result?.ok && result.assigned) {
    return (
      <Card className="border-emerald-200 bg-emerald-50">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-800">Назначен: {result.assigned.name}</p>
              <p className="text-sm text-emerald-700">
                ТС: {result.assigned.vehiclePlate ?? "—"} · Рейтинг: {result.assigned.rating?.toFixed(1)} · Скор: {Math.round(result.assigned.score * 100)}%
              </p>
              {result.assigned.distanceToStart != null && (
                <p className="text-xs text-emerald-600">До точки отправления: {result.assigned.distanceToStart} км</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (result && !result.ok) {
    return (
      <p className="text-sm text-amber-600">
        Нет свободных водителей на смене.{" "}
        <button className="underline" onClick={() => setResult(null)}>Повторить</button>
      </p>
    );
  }

  return (
    <Button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      variant="outline"
      size="sm"
      className="gap-2"
    >
      {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
      Авто-назначить
    </Button>
  );
}
