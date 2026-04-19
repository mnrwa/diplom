"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertCircle, Gauge, Loader2, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getDriverTelematics } from "@/lib/api";

interface Props {
  driverId: number;
}

export function TelematicsCard({ driverId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["telematics", driverId],
    queryFn: () => getDriverTelematics(driverId),
    staleTime: 60_000,
  });

  const scoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-600";
    if (score >= 60) return "text-amber-600";
    return "text-red-600";
  };

  const scoreVariant = (score: number): "success" | "secondary" | "destructive" => {
    if (score >= 80) return "success";
    if (score >= 60) return "secondary";
    return "destructive";
  };

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-indigo-500" />
          Телематический рейтинг
        </CardTitle>
        <CardDescription>Анализ стиля вождения по GPS-данным</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Анализируем...
          </div>
        ) : !data ? (
          <p className="text-sm text-gray-400">Нет данных</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-4xl font-bold ${scoreColor(data.score)}`}>{data.score}</p>
                <p className="text-xs text-gray-500">из 100 баллов</p>
              </div>
              <Badge variant={scoreVariant(data.score)} className="text-base px-3 py-1">
                {data.score >= 80 ? "Отлично" : data.score >= 60 ? "Хорошо" : "Требует улучшения"}
              </Badge>
            </div>

            <Progress value={data.score} className="h-3" />

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-center">
                <p className="text-red-600 font-bold text-xl">{data.speedViolations}</p>
                <p className="text-red-500">превышений</p>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center">
                <p className="text-amber-600 font-bold text-xl">{data.harshBraking}</p>
                <p className="text-amber-500">резких торм.</p>
              </div>
              <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-center">
                <p className="text-blue-600 font-bold text-xl">{data.harshAcceleration}</p>
                <p className="text-blue-500">резких разг.</p>
              </div>
            </div>

            <p className="text-xs text-gray-400">
              Проанализировано {data.totalPoints.toLocaleString()} GPS-точек
            </p>

            {data.events.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Последние события</p>
                {data.events.slice(0, 5).map((ev, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                    <AlertCircle className={`h-3 w-3 shrink-0 ${ev.type === "SPEEDING" ? "text-red-400" : "text-amber-400"}`} />
                    <span>{ev.type === "SPEEDING" ? "Превышение" : ev.type === "HARSH_BRAKING" ? "Резкое торможение" : "Резкое ускорение"}</span>
                    <span className="ml-auto font-mono">{ev.value.toFixed(0)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
