"use client";

import MapView from "@/components/map/MapView";
import type { MapLine, MapPoint } from "@/components/map/MapView";

interface RoutePoint {
  lat: number;
  lng: number;
  name?: string;
}

interface RouteMapProps {
  route: {
    start: RoutePoint;
    end: RoutePoint;
    current?: RoutePoint;
    /** Путь по дорожной сети — массив промежуточных точек из OSRM waypoints */
    path?: RoutePoint[];
  };
  height?: string;
}

/**
 * Карта маршрута на основе MapView (MapLibre / 2GIS).
 * Рисует реальный путь по дорогам из `route.path` (waypoints из OSRM),
 * а не прямую линию А→Б.
 */
export function RouteMap({ route, height = "400px" }: RouteMapProps) {
  // Строим линию маршрута: start → waypoints → end
  const pathCoords: [number, number][] = [];

  pathCoords.push([route.start.lng, route.start.lat]);

  if (route.path && route.path.length > 0) {
    for (const pt of route.path) {
      pathCoords.push([pt.lng, pt.lat]);
    }
  }

  pathCoords.push([route.end.lng, route.end.lat]);

  const lines: MapLine[] =
    pathCoords.length >= 2
      ? [
          {
            id: "route-line",
            name: route.start.name
              ? `${route.start.name} → ${route.end.name ?? "Финиш"}`
              : "Маршрут",
            color: "#10b981",
            coordinates: pathCoords,
          },
        ]
      : [];

  const points: MapPoint[] = [
    {
      id: "route-start",
      kind: "warehouse",
      title: route.start.name ?? "Отправление",
      longitude: route.start.lng,
      latitude: route.start.lat,
    },
    {
      id: "route-end",
      kind: "pickup",
      title: route.end.name ?? "Назначение",
      longitude: route.end.lng,
      latitude: route.end.lat,
    },
  ];

  if (route.current) {
    points.push({
      id: "route-current",
      kind: "vehicle",
      title: "Текущая позиция",
      longitude: route.current.lng,
      latitude: route.current.lat,
    });
  }

  return (
    <div style={{ height, width: "100%" }}>
      <MapView
        lines={lines}
        points={points}
        fitToData
        className="h-full w-full rounded-lg"
      />
    </div>
  );
}
