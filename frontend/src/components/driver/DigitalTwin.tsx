"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import MapView from "@/components/map/MapView";
import type { DigitalTwin } from "@/lib/api";

interface Props {
  twin: DigitalTwin;
}

export function DigitalTwinPlayer({ twin }: Props) {
  const track = twin.track ?? [];
  const waypoints = twin.waypoints ?? [];

  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentPoint = track[currentIdx] ?? null;
  const progress = track.length > 1 ? Math.round((currentIdx / (track.length - 1)) * 100) : 0;

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCurrentIdx((prev) => {
          if (prev >= track.length - 1) {
            setPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1000 / speed);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, speed, track.length]);

  const reset = () => { setCurrentIdx(0); setPlaying(false); };

  const routeCoords: [number, number][] = [
    ...(twin.startPoint ? [[twin.startPoint.lon, twin.startPoint.lat] as [number, number]] : []),
    ...waypoints.map((w) => [w.lon, w.lat] as [number, number]),
    ...(twin.endPoint ? [[twin.endPoint.lon, twin.endPoint.lat] as [number, number]] : []),
  ];

  const points = [
    ...(twin.startPoint ? [{
      id: "twin-start",
      kind: "warehouse" as const,
      title: twin.startPoint.name,
      latitude: twin.startPoint.lat,
      longitude: twin.startPoint.lon,
    }] : []),
    ...(twin.endPoint ? [{
      id: "twin-end",
      kind: "pickup" as const,
      title: twin.endPoint.name,
      latitude: twin.endPoint.lat,
      longitude: twin.endPoint.lon,
    }] : []),
    ...(currentPoint ? [{
      id: "twin-vehicle",
      kind: "driver" as const,
      title: `Позиция ${progress}%`,
      subtitle: currentPoint.speed != null ? `${currentPoint.speed.toFixed(0)} км/ч` : undefined,
      latitude: currentPoint.lat,
      longitude: currentPoint.lon,
      speed: currentPoint.speed ?? null,
    }] : []),
  ];

  if (track.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-gray-500 text-sm">
          Нет данных GPS для воспроизведения
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-purple-500" />
          Digital Twin — воспроизведение маршрута
        </CardTitle>
        <CardDescription>
          {twin.name} · {track.length} точек · {(twin.distance ?? 0).toFixed(0)} км
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <MapView
          fitToData
          className="h-[320px] w-full rounded-xl"
          points={points}
          lines={routeCoords.length > 1 ? [{
            id: "twin-route",
            name: twin.name,
            color: "#8b5cf6",
            coordinates: routeCoords,
          }] : []}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">
              Точка {currentIdx + 1} / {track.length}
            </span>
            <span className="font-semibold">{progress}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          {currentPoint && (
            <div className="flex gap-4 text-xs text-gray-500">
              <span>{new Date(currentPoint.timestamp).toLocaleTimeString("ru")}</span>
              {currentPoint.speed != null && <span>{currentPoint.speed.toFixed(0)} км/ч</span>}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={reset}
            disabled={currentIdx === 0}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            onClick={() => setPlaying(!playing)}
            disabled={currentIdx >= track.length - 1}
            className="gap-2"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? "Пауза" : "Воспроизвести"}
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-gray-500">Скорость</span>
            {[1, 5, 10, 30].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${speed === s ? "bg-purple-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
