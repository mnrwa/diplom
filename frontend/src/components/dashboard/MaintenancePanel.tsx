"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Loader2, Settings, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getVehicleMaintenance, getVehicles, logMaintenance } from "@/lib/api";
import { toast } from "sonner";

export function MaintenancePanel() {
  const qc = useQueryClient();
  const { data: vehicles = [], isLoading } = useQuery({ queryKey: ["vehicles"], queryFn: getVehicles });
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);

  const { data: prediction, isLoading: predLoading } = useQuery({
    queryKey: ["maintenance", selectedVehicle],
    queryFn: () => getVehicleMaintenance(selectedVehicle!),
    enabled: selectedVehicle != null,
  });

  const logMut = useMutation({
    mutationFn: (vehicleId: number) => logMaintenance(vehicleId, { type: "OIL_CHANGE", notes: "Плановое ТО" }),
    onSuccess: () => {
      toast.success("ТО записано");
      qc.invalidateQueries({ queryKey: ["maintenance", selectedVehicle] });
    },
  });

  const urgencyColor = (u?: string) => {
    if (u === "CRITICAL") return "destructive";
    if (u === "WARNING") return "secondary";
    return "success";
  };

  return (
    <div className="space-y-4">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-orange-500" />
            Предиктивное ТО
          </CardTitle>
          <CardDescription>Прогноз следующего обслуживания по данным GPS</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {vehicles.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVehicle(v.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${selectedVehicle === v.id ? "border-orange-400 bg-orange-50" : "border-gray-200 hover:border-orange-200"}`}
                >
                  <p className="font-semibold text-sm">{v.plateNumber}</p>
                  <p className="text-xs text-gray-500">{v.model}</p>
                  <p className="text-xs text-gray-400 mt-1">{(v.mileageKm ?? 0).toFixed(0)} км</p>
                </button>
              ))}
            </div>
          )}

          {selectedVehicle && predLoading && (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Расчёт...
            </div>
          )}

          {prediction && (
            <Card className="border-orange-100 bg-orange-50">
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{prediction.plateNumber} · {prediction.model}</p>
                  <Badge variant={urgencyColor(prediction.urgency) as any}>
                    {prediction.urgency === "CRITICAL" ? "Срочно!" : prediction.urgency === "WARNING" ? "Скоро" : "Норма"}
                  </Badge>
                </div>

                <div>
                  <div className="flex justify-between text-sm text-gray-600 mb-1">
                    <span>Пробег с последнего ТО</span>
                    <span className="font-semibold">{prediction.kmSinceService.toFixed(0)} / {prediction.serviceInterval.toLocaleString()} км</span>
                  </div>
                  <Progress value={(prediction.kmSinceService / prediction.serviceInterval) * 100} className="h-2" />
                </div>

                {prediction.urgency !== "OK" && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-100 p-3">
                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                    <p className="text-sm text-amber-800">
                      До ТО осталось <strong>{prediction.kmToNextService.toFixed(0)} км</strong> (~{prediction.daysToNextService} дней)
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  <div className="rounded-lg bg-white border border-gray-100 p-2">
                    <p className="text-gray-400">Текущий пробег</p>
                    <p className="font-semibold">{prediction.currentMileageKm.toFixed(0)} км</p>
                  </div>
                  <div className="rounded-lg bg-white border border-gray-100 p-2">
                    <p className="text-gray-400">До ТО</p>
                    <p className="font-semibold">{prediction.daysToNextService} дней</p>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => logMut.mutate(selectedVehicle)}
                  disabled={logMut.isPending}
                  className="w-full gap-2"
                >
                  {logMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Записать факт ТО
                </Button>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
