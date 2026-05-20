"use client";

import type GeoJSON from "geojson";
import { CloudRain, LocateFixed, Maximize2, Minus, Plus, Wind } from "lucide-react";
import maplibregl, {
  type Map as MapLibreMap,
  type Marker as MapLibreMarker,
} from "maplibre-gl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

export type MapLine = {
  id: string;
  name: string;
  color?: string;
  coordinates: [number, number][];
};

export type MapPoint = {
  id: string;
  entityId?: number;
  kind: "warehouse" | "pickup" | "vehicle" | "driver" | "event";
  title: string;
  subtitle?: string;
  longitude: number;
  latitude: number;
  speed?: number | null;
  /** ISO timestamp — event markers older than this are hidden */
  expiresAt?: string | null;
  riskLevel?: "low" | "medium" | "high" | null;
};

export type ZoneRing = {
  id: string;
  lat: number;
  lon: number;
  radiusKm: number;
  color: string;
  label?: string;
};

export type MapSelection = {
  source: "map" | "object" | "point";
  longitude: number;
  latitude: number;
  pointId?: string;
  pointTitle?: string;
  objectId?: string;
  layerId?: string;
  label?: string;
};

import type { HeatmapCell, WeatherHeatmapCell } from "@/lib/api";

type MapViewProps = {
  lines?: MapLine[];
  points?: MapPoint[];
  heatmapCells?: HeatmapCell[] | null;
  weatherHeatmapCells?: WeatherHeatmapCell[] | null;
  zoneRings?: ZoneRing[];
  precipitationOverlay?: boolean;
  center?: [number, number];
  className?: string;
  containerClassName?: string;
  selectable?: boolean;
  selectedCoordinates?: [number, number] | null;
  highlightedPointIds?: string[];
  helperText?: string;
  fitToData?: boolean;
  onSelect?: (selection: MapSelection) => void;
  onPointClick?: (point: MapPoint) => void;
};

type DgisModule = any;

type DgisMarkerRecord = {
  marker: any;
  element: HTMLElement;
};

type FallbackMarkerRecord = {
  marker: MapLibreMarker;
  element: HTMLElement;
  popup: maplibregl.Popup;
  kind: MapPoint["kind"];
};

type DgisRuntime = {
  kind: "2gis";
  module: DgisModule;
  map: any;
  markers: Map<string, DgisMarkerRecord>;
  lines: Map<string, any>;
  selectionMarker: any | null;
};

type FallbackRuntime = {
  kind: "fallback";
  map: MapLibreMap;
  markers: Map<string, FallbackMarkerRecord>;
  lineIds: Set<string>;
  selectionMarker: MapLibreMarker | null;
  hasCluster: boolean;
  hasRainViewer: boolean;
  hasZones: boolean;
};

type Runtime = DgisRuntime | FallbackRuntime;

const DGIS_KEY = process.env.NEXT_PUBLIC_2GIS_KEY?.trim();

const FALLBACK_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export default function MapView({
  lines = [],
  points = [],
  heatmapCells = null,
  weatherHeatmapCells = null,
  zoneRings = [],
  precipitationOverlay = false,
  center,
  className = "h-[420px] w-full rounded-[28px]",
  containerClassName,
  selectable = false,
  selectedCoordinates = null,
  highlightedPointIds = [],
  helperText: _helperText,
  fitToData = false,
  onSelect,
  onPointClick,
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const onSelectRef = useRef(onSelect);
  const onPointClickRef = useRef(onPointClick);
  const selectableRef = useRef(selectable);
  const fitSignatureRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onPointClickRef.current = onPointClick;
  }, [onPointClick]);

  useEffect(() => {
    selectableRef.current = selectable;
  }, [selectable]);

  useEffect(() => {
    if (!fitToData) {
      fitSignatureRef.current = null;
    }
  }, [fitToData]);

  const firstPoint = points[0] || null;
  const fallbackCenter = useMemo<[number, number]>(() => {
    if (center) return center;
    if (selectedCoordinates) return selectedCoordinates;
    if (firstPoint) {
      return [firstPoint.longitude, firstPoint.latitude];
    }
    return [82.9204, 55.0302];
  }, [
    center?.[0],
    center?.[1],
    firstPoint?.latitude,
    firstPoint?.longitude,
    selectedCoordinates?.[0],
    selectedCoordinates?.[1],
  ]);
  const initialCenterRef = useRef(fallbackCenter);

  const boundsPayload = useMemo(() => {
    const coordinates: [number, number][] = [];

    points.forEach((point) => {
      coordinates.push([point.longitude, point.latitude]);
    });

    lines.forEach((line) => {
      line.coordinates.forEach((coordinate) => coordinates.push(coordinate));
    });

    if (selectedCoordinates) {
      coordinates.push(selectedCoordinates);
    }

    return coordinates;
  }, [lines, points, selectedCoordinates]);

  const scheduleFallbackSync = (
    runtime: FallbackRuntime,
    action: () => void,
  ) => {
    let cancelled = false;

    const sync = () => {
      if (cancelled || runtimeRef.current !== runtime) return;

      if (!runtime.map.isStyleLoaded()) {
        runtime.map.once("style.load", sync);
        return;
      }

      try {
        action();
      } catch (error) {
        if (isStyleNotReadyError(error)) {
          runtime.map.once("style.load", sync);
          return;
        }

        throw error;
      }
    };

    sync();

    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    let disposed = false;

    async function init() {
      if (!hostRef.current || runtimeRef.current) return;

      const initialCenter = initialCenterRef.current;

      if (DGIS_KEY) {
        try {
          const loader = await import("@2gis/mapgl");
          const module = await loader.load();
          if (disposed || !hostRef.current) return;

          const map = new module.Map(hostRef.current, {
            key: DGIS_KEY,
            center: initialCenter,
            zoom: 5.1,
            lang: "ru",
            zoomControl: false,
            trafficControl: "topRight",
            trafficOn: true,
            enableTrackResize: true,
            graphicsPreset: "light",
            styleState: {
              immersiveRoadsOn: true,
            },
          });

          map.on("styleload", () => {
            if (disposed) return;
            map.setLanguage("ru");
            setReady(true);
          });

          map.on("click", (event) => {
            const [longitude, latitude] = event.lngLat as [number, number];
            const layerId =
              event.targetData?.type === "default"
                ? event.targetData.layerId
                : event.targetData?.layerId;
            const label = buildObjectLabel(layerId, event.target?.id);

            if (event.target?.id) {
              map.setSelectedObjects([event.target.id]);
            } else {
              map.setSelectedObjects([]);
            }

            if (selectableRef.current) {
              onSelectRef.current?.({
                source: event.target?.id ? "object" : "map",
                longitude,
                latitude,
                objectId: event.target?.id,
                layerId,
                label,
              });
            }
          });

          runtimeRef.current = {
            kind: "2gis",
            module,
            map,
            markers: new Map(),
            lines: new Map(),
            selectionMarker: null,
          };

          return;
        } catch {
          if (!disposed) {
            initFallbackMap(
              hostRef.current,
              initialCenter,
              runtimeRef,
              setReady,
              selectableRef,
              onSelectRef,
            );
          }
          return;
        }
      }

      if (!disposed && hostRef.current) {
        initFallbackMap(
          hostRef.current,
          initialCenter,
          runtimeRef,
          setReady,
          selectableRef,
          onSelectRef,
        );
      }
    }

    init();

    return () => {
      disposed = true;
      destroyRuntime(runtimeRef.current);
      runtimeRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ready) return;

    if (!center) return;

    if (runtime.kind === "2gis") {
      runtime.map.setCenter(center, { duration: 300 });
    } else {
      runtime.map.easeTo({ center, duration: 300 });
    }
  }, [center?.[0], center?.[1], ready]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ready) return;

    if (runtime.kind === "2gis") {
      syncDgisLines(runtime, lines);
      return;
    }

    return scheduleFallbackSync(runtime, () => syncFallbackLines(runtime, lines));
  }, [lines, ready]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ready) return;

    // Filter out expired event markers
    const now = Date.now();
    const activePoints = points.filter((p) => {
      if (p.kind === "event" && p.expiresAt) {
        return now < new Date(p.expiresAt).getTime();
      }
      return true;
    });

    if (runtime.kind === "2gis") {
      syncDgisMarkers(
        runtime,
        activePoints,
        highlightedPointIds,
        selectableRef.current,
        onSelectRef,
        onPointClickRef,
      );
      return;
    }

    return scheduleFallbackSync(runtime, () =>
      syncFallbackMarkers(
        runtime,
        activePoints,
        highlightedPointIds,
        selectableRef.current,
        onSelectRef,
        onPointClickRef,
      ),
    );
  }, [highlightedPointIds, points, ready, selectable]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ready) return;

    if (runtime.kind === "2gis") {
      syncDgisSelectionMarker(runtime, selectedCoordinates);
      return;
    }

    return scheduleFallbackSync(runtime, () =>
      syncFallbackSelectionMarker(runtime, selectedCoordinates),
    );
  }, [ready, selectedCoordinates]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ready || runtime.kind !== "fallback") return;
    syncFallbackHeatmap(runtime, heatmapCells);
  }, [heatmapCells, ready]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ready || runtime.kind !== "fallback") return;
    syncFallbackWeatherHeatmap(runtime, weatherHeatmapCells);
  }, [weatherHeatmapCells, ready]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ready || runtime.kind !== "fallback") return;
    void syncRainViewer(runtime, precipitationOverlay);
  }, [precipitationOverlay, ready]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ready || runtime.kind !== "fallback") return;
    return scheduleFallbackSync(runtime, () => syncZoneRings(runtime, zoneRings));
  }, [zoneRings, ready]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !ready || !fitToData || !boundsPayload.length) return;

    // Avoid refitting on every GPS tick: refit only when the set of objects changes.
    // (Coordinates may change frequently for driver markers.)
    const signature = `${points.map((p) => p.id).sort().join("|")}::${lines
      .map((l) => l.id)
      .sort()
      .join("|")}::${selectedCoordinates ? "sel" : "nosel"}`;
    if (fitSignatureRef.current === signature) return;
    fitSignatureRef.current = signature;

    if (runtime.kind === "2gis") {
      fitToBounds(runtime, boundsPayload);
      return;
    }

    return scheduleFallbackSync(runtime, () => fitToBounds(runtime, boundsPayload));
  }, [boundsPayload, fitToData, lines, points, ready, selectedCoordinates]);

  const handleZoomIn = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    if (runtime.kind === "2gis") {
      runtime.map.setZoom(runtime.map.getZoom() + 1, { duration: 220 });
    } else {
      runtime.map.zoomIn({ duration: 220 });
    }
  };

  const handleZoomOut = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    if (runtime.kind === "2gis") {
      runtime.map.setZoom(runtime.map.getZoom() - 1, { duration: 220 });
    } else {
      runtime.map.zoomOut({ duration: 220 });
    }
  };

  const handleFit = () => {
    const runtime = runtimeRef.current;
    if (!runtime || !boundsPayload.length) return;
    fitToBounds(runtime, boundsPayload);
  };

  const handleLocate = () => {
    const runtime = runtimeRef.current;
    if (!runtime || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition((position) => {
      const target: [number, number] = [
        position.coords.longitude,
        position.coords.latitude,
      ];

      if (runtime.kind === "2gis") {
        runtime.map.setCenter(target, { duration: 700 });
        runtime.map.setZoom(12, { duration: 700 });
      } else {
        runtime.map.flyTo({ center: target, zoom: 12, duration: 700 });
      }
    });
  };

  return (
    <div className={`relative overflow-hidden rounded-[28px] border border-sand/80 shadow-card${containerClassName ? ` ${containerClassName}` : ""}`} style={{ contain: "layout style paint" }}>
      <div ref={hostRef} className={className} />

      <div className="pointer-events-none absolute bottom-4 right-4 z-20 flex flex-col gap-2">
        <ControlButton label="Увеличить" onClick={handleZoomIn}>
          <Plus className="h-4 w-4" />
        </ControlButton>
        <ControlButton label="Уменьшить" onClick={handleZoomOut}>
          <Minus className="h-4 w-4" />
        </ControlButton>
        <ControlButton label="Показать всё" onClick={handleFit}>
          <Maximize2 className="h-4 w-4" />
        </ControlButton>
        <ControlButton label="Моё местоположение" onClick={handleLocate}>
          <LocateFixed className="h-4 w-4" />
        </ControlButton>
	      </div>
	      {weatherHeatmapCells && weatherHeatmapCells.length > 0 ? (
	        <div className="pointer-events-none absolute left-4 top-4 z-20 max-w-[220px] rounded-2xl border border-sky-100 bg-white/92 px-3 py-2 text-xs text-slate-700 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur">
	          <div className="flex items-center gap-2 font-semibold text-slate-900">
	            <CloudRain className="h-3.5 w-3.5 text-sky-600" />
	            Погодная карта
	          </div>
	          <div className="mt-2 flex items-center gap-2">
	            <span className="h-2.5 w-8 rounded-full bg-sky-300" />
	            <span>осадки</span>
	            <span className="h-2.5 w-8 rounded-full bg-orange-400" />
	            <span>риск</span>
	          </div>
	          <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
	            <Wind className="h-3 w-3" />
	            ветер усиливает интенсивность слоя
	          </div>
	        </div>
	      ) : null}
	    </div>
  );
}

function ensureMapStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("velto-map-styles")) return;
  const style = document.createElement("style");
  style.id = "velto-map-styles";
  style.textContent = `
    @keyframes velto-ping {
      0%   { transform: scale(1);   opacity: 0.55; }
      100% { transform: scale(2.6); opacity: 0; }
    }
    .velto-pulse-a {
      position: absolute; inset: -9px; border-radius: 50%;
      animation: velto-ping 2.2s ease-out infinite;
      pointer-events: none;
    }
    .velto-pulse-b {
      position: absolute; inset: -9px; border-radius: 50%;
      animation: velto-ping 2.2s ease-out 0.75s infinite;
      pointer-events: none;
    }
    .maplibregl-popup-content {
      padding: 8px 12px !important;
      border-radius: 14px !important;
      border: 1px solid #E8E2D8 !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.10) !important;
      font-family: inherit !important;
      min-width: 140px;
    }
    .maplibregl-popup-tip { display: none !important; }
    .maplibregl-popup { pointer-events: none; }
  `;
  document.head.appendChild(style);
}

function buildPopupHtml(point: MapPoint): string {
  const speedLine = point.speed != null
    ? `<p style="color:#059669;font-size:11px;margin:2px 0 0">${Math.round(point.speed)} км/ч</p>`
    : "";
  const subLine = point.subtitle
    ? `<p style="color:#948C84;font-size:11px;margin:2px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${point.subtitle}</p>`
    : "";
  return `<div style="padding:2px 0"><p style="font-weight:600;color:#1A1916;font-size:13px;margin:0;white-space:nowrap">${point.title}</p>${subLine}${speedLine}</div>`;
}

function initFallbackMap(
  host: HTMLDivElement,
  center: [number, number],
  runtimeRef: MutableRefObject<Runtime | null>,
  setReady: (value: boolean) => void,
  selectableRef: MutableRefObject<boolean>,
  onSelectRef: MutableRefObject<MapViewProps["onSelect"]>,
) {
  const map = new maplibregl.Map({
    container: host,
    style: FALLBACK_STYLE,
    center,
    zoom: 5.1,
    attributionControl: { compact: true },
  });

  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  const markReady = () => {
    if (!map.isStyleLoaded()) {
      map.once("style.load", markReady);
      return;
    }

    setReady(true);
  };

  map.on("load", markReady);

  map.on("click", (event) => {
    const features = map.queryRenderedFeatures(event.point) ?? [];
    const feature =
      features.find((candidate) => candidate?.layer?.id && candidate?.properties) ??
      features[0] ??
      null;

    const layerId = feature?.layer?.id;
    const objectId =
      feature?.id != null ? String(feature.id) : undefined;
    const name =
      feature?.properties && typeof feature.properties.name === "string"
        ? feature.properties.name
        : feature?.properties && typeof feature.properties["name:ru"] === "string"
          ? feature.properties["name:ru"]
          : undefined;
    const label = name || buildObjectLabel(layerId, objectId);

    if (selectableRef.current) {
      onSelectRef.current?.({
        source: feature ? "object" : "map",
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        objectId,
        layerId,
        label,
      });
    }
  });

  ensureMapStyles();

  const runtime: FallbackRuntime = {
    kind: "fallback",
    map,
    markers: new Map(),
    lineIds: new Set(),
    selectionMarker: null,
    hasCluster: false,
    hasRainViewer: false,
    hasZones: false,
  };
  runtimeRef.current = runtime;

  map.on("zoom", () => {
    const rt = runtimeRef.current;
    if (!rt || rt.kind !== "fallback") return;
    updateDriverVisibility(rt);
  });
}

function syncDgisLines(runtime: DgisRuntime, lines: MapLine[]) {
  const nextIds = new Set(
    lines.filter((line) => line.coordinates.length >= 2).map((line) => line.id),
  );

  runtime.lines.forEach((polyline, id) => {
    if (!nextIds.has(id)) {
      polyline.destroy();
      runtime.lines.delete(id);
    }
  });

  lines.forEach((line) => {
    if (line.coordinates.length < 2) return;

    runtime.lines.get(line.id)?.destroy();

    runtime.lines.set(
      line.id,
      new runtime.module.Polyline(runtime.map, {
        coordinates: line.coordinates,
        color: line.color || "#0f766e",
        width: 6,
        zIndex: 20,
      }),
    );
  });
}

function syncFallbackLines(runtime: FallbackRuntime, lines: MapLine[]) {
  const nextLineIds = new Set<string>();

  lines.forEach((line) => {
    if (line.coordinates.length < 2) return;

    const lineId = String(line.id);
    const sourceId = `route-source-${lineId}`;
    const layerId = `route-layer-${lineId}`;
    const lineFeature = {
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: line.coordinates,
      },
      properties: {},
    };

    nextLineIds.add(lineId);

    const existingSource = runtime.map.getSource(sourceId) as
      | maplibregl.GeoJSONSource
      | undefined;

    if (existingSource?.setData) {
      existingSource.setData(lineFeature);
    } else {
      try {
        runtime.map.addSource(sourceId, {
          type: "geojson",
          data: lineFeature,
        });
      } catch (error) {
        // MapLibre can throw even if the source was created in a concurrent sync.
        // If it already exists, update its data and continue.
        if (isAlreadyExistsError(error)) {
          const sourceAfter = runtime.map.getSource(sourceId) as
            | maplibregl.GeoJSONSource
            | undefined;
          sourceAfter?.setData?.(lineFeature);
        } else {
          throw error;
        }
      }
    }

    if (!runtime.map.getLayer(layerId)) {
      try {
        runtime.map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": line.color || "#0f766e",
            "line-width": 5,
            "line-opacity": 0.9,
          },
        });
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
      }
    } else {
      runtime.map.setPaintProperty(layerId, "line-color", line.color || "#0f766e");
      runtime.map.setPaintProperty(layerId, "line-width", 5);
      runtime.map.setPaintProperty(layerId, "line-opacity", 0.9);
    }
  });

  // Remove lines that are no longer present.
  runtime.lineIds.forEach((lineId) => {
    if (nextLineIds.has(lineId)) return;
    removeRouteLine(runtime, lineId);
  });

  // If we ever got out of sync (e.g. due to a crash), clean up any orphaned route layers/sources.
  cleanupOrphanRouteArtifacts(runtime, nextLineIds);

  runtime.lineIds = nextLineIds;
}

function syncDgisMarkers(
  runtime: DgisRuntime,
  points: MapPoint[],
  highlightedPointIds: string[],
  selectable: boolean,
  onSelectRef: MutableRefObject<MapViewProps["onSelect"]>,
  onPointClickRef: MutableRefObject<MapViewProps["onPointClick"]>,
) {
  const nextIds = new Set(points.map((point) => point.id));

  runtime.markers.forEach((record, id) => {
    if (!nextIds.has(id)) {
      record.marker.destroy();
      runtime.markers.delete(id);
    }
  });

  points.forEach((point) => {
    const highlighted = highlightedPointIds.includes(point.id);
    const existing = runtime.markers.get(point.id);

    if (existing) {
      existing.marker.setCoordinates([point.longitude, point.latitude]);
      hydrateMarkerElement(existing.element, point, highlighted);
      bindMarkerInteraction(
        existing.element,
        point,
        selectable,
        onSelectRef,
        onPointClickRef,
        () => runtime.map.setSelectedObjects([]),
      );
      return;
    }

    const element = buildMarkerElement(point, highlighted);
    bindMarkerInteraction(
      element,
      point,
      selectable,
      onSelectRef,
      onPointClickRef,
      () => runtime.map.setSelectedObjects([]),
    );

    runtime.markers.set(point.id, {
      marker: new runtime.module.HtmlMarker(runtime.map, {
        coordinates: [point.longitude, point.latitude],
        html: element,
        anchor: [22, 22],
        interactive: true,
        preventMapInteractions: false,
      }),
      element,
    });
  });
}

function syncFallbackMarkers(
  runtime: FallbackRuntime,
  points: MapPoint[],
  highlightedPointIds: string[],
  selectable: boolean,
  onSelectRef: MutableRefObject<MapViewProps["onSelect"]>,
  onPointClickRef: MutableRefObject<MapViewProps["onPointClick"]>,
) {
  const nextIds = new Set(points.map((point) => point.id));

  runtime.markers.forEach((record, id) => {
    if (!nextIds.has(id)) {
      record.popup.remove();
      record.marker.remove();
      runtime.markers.delete(id);
    }
  });

  points.forEach((point) => {
    const highlighted = highlightedPointIds.includes(point.id);
    const existing = runtime.markers.get(point.id);

    if (existing) {
      existing.marker.setLngLat([point.longitude, point.latitude]);
      existing.popup.setLngLat([point.longitude, point.latitude]);
      if (existing.popup.isOpen()) {
        existing.popup.setHTML(buildPopupHtml(point));
      }
      hydrateMarkerElement(existing.element, point, highlighted);
      bindMarkerInteraction(
        existing.element,
        point,
        selectable,
        onSelectRef,
        onPointClickRef,
      );
      return;
    }

    const element = buildMarkerElement(point, highlighted);
    bindMarkerInteraction(
      element,
      point,
      selectable,
      onSelectRef,
      onPointClickRef,
    );

    // Native MapLibre Popup — moves with the canvas, no lag on zoom/pan
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      anchor: "bottom",
      offset: [0, -30],
      maxWidth: "220px",
    }).setHTML(buildPopupHtml(point));

    element.addEventListener("mouseenter", () => {
      popup.setLngLat([point.longitude, point.latitude]).addTo(runtime.map);
    });
    element.addEventListener("mouseleave", () => popup.remove());

    const mlMarker = new maplibregl.Marker({
      element,
      anchor: "center",
    })
      .setLngLat([point.longitude, point.latitude])
      .addTo(runtime.map);

    runtime.markers.set(point.id, {
      marker: mlMarker,
      element,
      popup,
      kind: point.kind,
    });
  });

  syncFallbackCluster(runtime, points);
  updateDriverVisibility(runtime);
}

function syncFallbackCluster(runtime: FallbackRuntime, points: MapPoint[]) {
  const map = runtime.map;

  // Only cluster driver/vehicle points
  const movingPoints = points.filter(
    (p) => p.kind === "driver" || p.kind === "vehicle",
  );

  const features = movingPoints.map((p) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [p.longitude, p.latitude] },
    properties: { id: p.id, kind: p.kind },
  }));
  const geojson = { type: "FeatureCollection" as const, features };

  const src = map.getSource(CLUSTER_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (src?.setData) {
    src.setData(geojson as any);
    return;
  }

  try {
    map.addSource(CLUSTER_SOURCE, {
      type: "geojson",
      data: geojson as any,
      cluster: true,
      clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterRadius: 55,
    });

    // Cluster circle — emerald colour matching driver markers
    map.addLayer({
      id: CLUSTER_LAYER,
      type: "circle",
      source: CLUSTER_SOURCE,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#10b981",
        "circle-radius": ["step", ["get", "point_count"], 22, 5, 28, 15, 34],
        "circle-stroke-width": 3,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 0.95,
      },
    });

    map.addLayer({
      id: CLUSTER_COUNT_LAYER,
      type: "symbol",
      source: CLUSTER_SOURCE,
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-size": 14,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      },
      paint: { "text-color": "#ffffff" },
    });

    // Zoom into cluster on click
    map.on("click", CLUSTER_LAYER, (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [CLUSTER_LAYER],
      });
      if (!features.length) return;
      const clusterId = features[0].properties?.cluster_id as number | undefined;
      const coords = (features[0].geometry as GeoJSON.Point).coordinates as [
        number,
        number,
      ];
      if (clusterId == null) return;
      void (
        map.getSource(CLUSTER_SOURCE) as maplibregl.GeoJSONSource
      ).getClusterExpansionZoom(clusterId).then((zoom) => {
        if (zoom == null) return;
        map.easeTo({ center: coords, zoom: zoom + 0.5, duration: 400 });
      }).catch(() => { /* ok */ });
    });

    map.on("mouseenter", CLUSTER_LAYER, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", CLUSTER_LAYER, () => {
      map.getCanvas().style.cursor = "";
    });

    runtime.hasCluster = true;
  } catch (e) {
    if (!isAlreadyExistsError(e)) throw e;
  }
}

function syncDgisSelectionMarker(
  runtime: DgisRuntime,
  selectedCoordinates: [number, number] | null,
) {
  if (!selectedCoordinates) {
    runtime.selectionMarker?.destroy();
    runtime.selectionMarker = null;
    return;
  }

  if (runtime.selectionMarker) {
    runtime.selectionMarker.setCoordinates(selectedCoordinates);
    return;
  }

  runtime.selectionMarker = new runtime.module.HtmlMarker(runtime.map, {
    coordinates: selectedCoordinates,
    html: buildSelectionElement(),
    anchor: [18, 18],
    interactive: false,
  });
}

function syncFallbackSelectionMarker(
  runtime: FallbackRuntime,
  selectedCoordinates: [number, number] | null,
) {
  if (!selectedCoordinates) {
    runtime.selectionMarker?.remove();
    runtime.selectionMarker = null;
    return;
  }

  if (runtime.selectionMarker) {
    runtime.selectionMarker.setLngLat(selectedCoordinates);
    return;
  }

  runtime.selectionMarker = new maplibregl.Marker({
    element: buildSelectionElement(),
    anchor: "center",
  })
    .setLngLat(selectedCoordinates)
    .addTo(runtime.map);
}

function bindMarkerInteraction(
  element: HTMLElement,
  point: MapPoint,
  selectable: boolean,
  onSelectRef: MutableRefObject<MapViewProps["onSelect"]>,
  onPointClickRef: MutableRefObject<MapViewProps["onPointClick"]>,
  onBeforeSelect?: () => void,
) {
  element.onclick = (event) => {
    event.stopPropagation();
    onBeforeSelect?.();
    onPointClickRef.current?.(point);

    if (selectable) {
      onSelectRef.current?.({
        source: "point",
        longitude: point.longitude,
        latitude: point.latitude,
        pointId: point.id,
        pointTitle: point.title,
        label: point.subtitle || point.title,
      });
    }
  };
}

function clearRuntimeObjects(runtime: Runtime) {
  if (runtime.kind === "2gis") {
    runtime.markers.forEach((record) => record.marker.destroy());
    runtime.lines.forEach((line) => line.destroy());
    runtime.selectionMarker?.destroy();
    runtime.markers.clear();
    runtime.lines.clear();
    runtime.selectionMarker = null;
    runtime.map.setSelectedObjects([]);
    return;
  }

  runtime.markers.forEach((record) => {
    (record as FallbackMarkerRecord).popup?.remove();
    record.marker.remove();
  });
  runtime.selectionMarker?.remove();

  if (!runtime.map.isStyleLoaded()) {
    runtime.markers.clear();
    runtime.lineIds.clear();
    runtime.selectionMarker = null;
    return;
  }

  runtime.lineIds.forEach((lineId) => removeRouteLine(runtime, lineId));
  cleanupOrphanRouteArtifacts(runtime, new Set());

	  if (runtime.hasCluster) {
	    [CLUSTER_COUNT_LAYER, CLUSTER_LAYER].forEach((id) => {
	      try { if (runtime.map.getLayer(id)) runtime.map.removeLayer(id); } catch { /* ok */ }
	    });
	    try { if (runtime.map.getSource(CLUSTER_SOURCE)) runtime.map.removeSource(CLUSTER_SOURCE); } catch { /* ok */ }
	    runtime.hasCluster = false;
	  }

  [WEATHER_CIRCLE_LAYER, WEATHER_HEATMAP_LAYER, ROUTE_LOAD_LAYER, ROUTE_LOAD_LAYER2,
   RAINVIEWER_LAYER, ZONE_LINE_LAYER, ZONE_FILL_LAYER].forEach((id) => {
    try { if (runtime.map.getLayer(id)) runtime.map.removeLayer(id); } catch { /* ok */ }
  });
  [WEATHER_HEATMAP_SOURCE, ROUTE_LOAD_SOURCE, RAINVIEWER_SOURCE, ZONE_SOURCE].forEach((id) => {
    try { if (runtime.map.getSource(id)) runtime.map.removeSource(id); } catch { /* ok */ }
  });
	
	  runtime.markers.clear();
  runtime.lineIds.clear();
  runtime.selectionMarker = null;
}

function isStyleNotReadyError(error: unknown) {
  return error instanceof Error && error.message.includes("Style is not done loading");
}

function isAlreadyExistsError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("already exists");
}

function cleanupOrphanRouteArtifacts(runtime: FallbackRuntime, nextLineIds: Set<string>) {
  let style: maplibregl.StyleSpecification | null = null;
  try {
    style = runtime.map.getStyle();
  } catch {
    return;
  }

  const layers = Array.isArray(style?.layers) ? style.layers : [];
  const sources = style?.sources ? Object.keys(style.sources) : [];

  const orphanLayerIds = layers
    .map((layer) => layer.id)
    .filter((id) => id.startsWith("route-layer-"))
    .filter((id) => !nextLineIds.has(id.slice("route-layer-".length)));

  orphanLayerIds.forEach((id) => {
    try {
      if (runtime.map.getLayer(id)) runtime.map.removeLayer(id);
    } catch {
      // ignore
    }
  });

  const orphanSourceIds = sources
    .filter((id) => id.startsWith("route-source-"))
    .filter((id) => !nextLineIds.has(id.slice("route-source-".length)));

  orphanSourceIds.forEach((id) => {
    try {
      if (runtime.map.getSource(id)) runtime.map.removeSource(id);
    } catch {
      // ignore
    }
  });
}

function removeRouteLine(runtime: FallbackRuntime, lineId: string) {
  const sourceId = `route-source-${lineId}`;
  const layerId = `route-layer-${lineId}`;

  // Remove known layer first.
  try {
    if (runtime.map.getLayer(layerId)) runtime.map.removeLayer(layerId);
  } catch {
    // ignore
  }

  // Defensive: remove any additional layers still referencing this source.
  try {
    const style = runtime.map.getStyle();
    const layers = Array.isArray(style?.layers) ? style.layers : [];
    layers.forEach((layer) => {
      if ((layer as any)?.source === sourceId && runtime.map.getLayer(layer.id)) {
        try {
          runtime.map.removeLayer(layer.id);
        } catch {
          // ignore
        }
      }
    });
  } catch {
    // ignore
  }

  try {
    if (runtime.map.getSource(sourceId)) runtime.map.removeSource(sourceId);
  } catch {
    // ignore
  }
}

const CLUSTER_MAX_ZOOM     = 10;
const CLUSTER_SOURCE       = "velto-cluster-source";
const CLUSTER_LAYER        = "velto-cluster-circles";
const CLUSTER_COUNT_LAYER  = "velto-cluster-counts";

const ROUTE_LOAD_SOURCE = "velto-route-load-source";
const ROUTE_LOAD_LAYER  = "velto-route-load-layer";
const ROUTE_LOAD_LAYER2 = "velto-route-load-layer-outline";
const WEATHER_HEATMAP_SOURCE = "velto-weather-heatmap-source";
const WEATHER_HEATMAP_LAYER = "velto-weather-heatmap-layer";
const WEATHER_CIRCLE_LAYER = "velto-weather-circle-layer";
const RAINVIEWER_SOURCE = "velto-rainviewer-source";
const RAINVIEWER_LAYER  = "velto-rainviewer-layer";
const ZONE_SOURCE       = "velto-zone-source";
const ZONE_FILL_LAYER   = "velto-zone-fill";
const ZONE_LINE_LAYER   = "velto-zone-line";

/** Hide/show individual driver HTML markers depending on zoom (cluster takes over at low zoom). */
function updateDriverVisibility(runtime: FallbackRuntime) {
  const show = runtime.map.getZoom() >= CLUSTER_MAX_ZOOM;
  runtime.markers.forEach((record) => {
    if (record.kind === "driver" || record.kind === "vehicle") {
      record.element.style.visibility = show ? "visible" : "hidden";
      record.element.style.pointerEvents = show ? "" : "none";
    }
  });
}

/** Add/remove RainViewer precipitation radar tile overlay. */
async function syncRainViewer(runtime: FallbackRuntime, show: boolean) {
  const map = runtime.map;

  const cleanup = () => {
    try { if (map.getLayer(RAINVIEWER_LAYER)) map.removeLayer(RAINVIEWER_LAYER); } catch { /* ok */ }
    try { if (map.getSource(RAINVIEWER_SOURCE)) map.removeSource(RAINVIEWER_SOURCE); } catch { /* ok */ }
    runtime.hasRainViewer = false;
  };

  if (!show) { cleanup(); return; }
  if (runtime.hasRainViewer) return;

  if (!map.isStyleLoaded()) {
    map.once("style.load", () => { void syncRainViewer(runtime, show); });
    return;
  }

  try {
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
    const data = await res.json() as { radar?: { past?: { path: string }[] } };
    const frames = data?.radar?.past ?? [];
    if (!frames.length) return;

    const latest = frames[frames.length - 1];
    const tileUrl = `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;

    cleanup();

    map.addSource(RAINVIEWER_SOURCE, {
      type: "raster",
      tiles: [tileUrl],
      tileSize: 256,
      attribution: "© RainViewer",
    });

    map.addLayer({
      id: RAINVIEWER_LAYER,
      type: "raster",
      source: RAINVIEWER_SOURCE,
      paint: { "raster-opacity": 0.72 },
    });

    runtime.hasRainViewer = true;
  } catch {
    // RainViewer unavailable, skip silently
  }
}

/** Build approximate circle polygon coordinates. */
function circleCoords(lat: number, lon: number, radiusKm: number, steps = 64): [number, number][] {
  const coords: [number, number][] = [];
  const latRad = lat * (Math.PI / 180);
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusKm / 110.574) * Math.sin(angle);
    const dLon = (radiusKm / (111.32 * Math.cos(latRad))) * Math.cos(angle);
    coords.push([lon + dLon, lat + dLat]);
  }
  return coords;
}

/** Draw zone ring polygons on the map. */
function syncZoneRings(runtime: FallbackRuntime, zones: ZoneRing[]) {
  const map = runtime.map;

  const cleanup = () => {
    try { if (map.getLayer(ZONE_LINE_LAYER)) map.removeLayer(ZONE_LINE_LAYER); } catch { /* ok */ }
    try { if (map.getLayer(ZONE_FILL_LAYER)) map.removeLayer(ZONE_FILL_LAYER); } catch { /* ok */ }
    try { if (map.getSource(ZONE_SOURCE)) map.removeSource(ZONE_SOURCE); } catch { /* ok */ }
    runtime.hasZones = false;
  };

  if (!zones.length) { cleanup(); return; }

  const features = zones.map((z) => ({
    type: "Feature" as const,
    properties: { color: z.color, id: z.id },
    geometry: {
      type: "Polygon" as const,
      coordinates: [circleCoords(z.lat, z.lon, z.radiusKm)],
    },
  }));

  const geojson = { type: "FeatureCollection" as const, features };

  const existing = map.getSource(ZONE_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (existing?.setData) {
    existing.setData(geojson as any);
    return;
  }

  cleanup();

  try {
    map.addSource(ZONE_SOURCE, { type: "geojson", data: geojson as any });

    map.addLayer({
      id: ZONE_FILL_LAYER,
      type: "fill",
      source: ZONE_SOURCE,
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": 0.07,
      },
    });

    map.addLayer({
      id: ZONE_LINE_LAYER,
      type: "line",
      source: ZONE_SOURCE,
      paint: {
        "line-color": ["get", "color"],
        "line-width": 2,
        "line-opacity": 0.5,
        "line-dasharray": [4, 3],
      },
    });

    runtime.hasZones = true;
  } catch { /* already added */ }
}

function intensityToColor(intensity: number): string {
  if (intensity < 0.25) return "#22c55e";  // green — free
  if (intensity < 0.50) return "#eab308";  // yellow — moderate
  if (intensity < 0.75) return "#f97316";  // orange — heavy
  return "#ef4444";                         // red — jams
}

function syncFallbackHeatmap(runtime: FallbackRuntime, cells: HeatmapCell[] | null | undefined) {
  const map = runtime.map;
  if (!map.isStyleLoaded()) {
    map.once("style.load", () => syncFallbackHeatmap(runtime, cells));
    return;
  }

  // Cleanup
  const cleanup = () => {
    [ROUTE_LOAD_LAYER, ROUTE_LOAD_LAYER2].forEach((id) => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ok */ }
    });
    try { if (map.getSource(ROUTE_LOAD_SOURCE)) map.removeSource(ROUTE_LOAD_SOURCE); } catch { /* ok */ }
  };

  if (!cells || cells.length === 0) { cleanup(); return; }

  // Group points by highway, build LineString segments coloured by intensity
  const byHighway = new Map<string, HeatmapCell[]>();
  for (const c of cells) {
    const key = c.highway ?? "unknown";
    if (!byHighway.has(key)) byHighway.set(key, []);
    byHighway.get(key)!.push(c);
  }

  const features: any[] = [];
  for (const [highway, pts] of byHighway) {
    // Draw segment-by-segment so each piece gets its own color
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const avgIntensity = (a.intensity + b.intensity) / 2;
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[a.lon, a.lat], [b.lon, b.lat]],
        },
        properties: {
          intensity: avgIntensity,
          color: intensityToColor(avgIntensity),
          highway,
          load_label: a.load_label ?? "",
          avg_speed: a.avg_speed_kmh ?? 70,
        },
      });
    }
  }

  const geojson = { type: "FeatureCollection", features };

  cleanup();

  try {
    map.addSource(ROUTE_LOAD_SOURCE, { type: "geojson", data: geojson as any });

    // Outline (wider, darker)
    map.addLayer({
      id: ROUTE_LOAD_LAYER2,
      type: "line",
      source: ROUTE_LOAD_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 6,
        "line-opacity": 0.25,
      },
    });

    // Main line
    map.addLayer({
      id: ROUTE_LOAD_LAYER,
      type: "line",
      source: ROUTE_LOAD_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 3,
        "line-opacity": 0.85,
      },
    });
  } catch { /* already added */ }
}

function syncFallbackWeatherHeatmap(
  runtime: FallbackRuntime,
  cells: WeatherHeatmapCell[] | null | undefined,
) {
  const map = runtime.map;
  if (!map.isStyleLoaded()) {
    map.once("style.load", () => syncFallbackWeatherHeatmap(runtime, cells));
    return;
  }

  const cleanup = () => {
    [WEATHER_CIRCLE_LAYER, WEATHER_HEATMAP_LAYER].forEach((id) => {
      try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ok */ }
    });
    try { if (map.getSource(WEATHER_HEATMAP_SOURCE)) map.removeSource(WEATHER_HEATMAP_SOURCE); } catch { /* ok */ }
  };

  if (!cells || cells.length === 0) {
    cleanup();
    return;
  }

  const geojson = {
    type: "FeatureCollection",
    features: cells.map((cell) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [cell.lon, cell.lat] },
      properties: {
        intensity: Math.max(0.05, Math.min(1, cell.intensity || cell.risk_score || 0)),
        precipitation: cell.precipitation_strength ?? 0,
        wind: cell.wind_speed ?? 0,
        temperature: cell.temperature ?? null,
        condition: cell.condition ?? "",
      },
    })),
  };

  cleanup();

  try {
    map.addSource(WEATHER_HEATMAP_SOURCE, { type: "geojson", data: geojson as any });
    map.addLayer({
      id: WEATHER_HEATMAP_LAYER,
      type: "heatmap",
      source: WEATHER_HEATMAP_SOURCE,
      maxzoom: 11,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "intensity"], 0, 0, 1, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 9, 1.8],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 3, 34, 9, 68],
        "heatmap-opacity": 0.62,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0, "rgba(56,189,248,0)",
          0.18, "rgba(125,211,252,0.58)",
          0.42, "rgba(14,165,233,0.68)",
          0.68, "rgba(251,146,60,0.74)",
          1, "rgba(239,68,68,0.82)",
        ],
      },
    });
    map.addLayer({
      id: WEATHER_CIRCLE_LAYER,
      type: "circle",
      source: WEATHER_HEATMAP_SOURCE,
      minzoom: 6,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "intensity"], 0, 7, 1, 18],
        "circle-color": [
          "interpolate",
          ["linear"],
          ["get", "intensity"],
          0, "#7dd3fc",
          0.35, "#38bdf8",
          0.65, "#fb923c",
          1, "#ef4444",
        ],
        "circle-opacity": 0.52,
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(255,255,255,0.85)",
      },
    });
  } catch { /* already added */ }
}

function destroyRuntime(runtime: Runtime | null) {
  if (!runtime) return;

  clearRuntimeObjects(runtime);

  if (runtime.kind === "2gis") {
    runtime.map.destroy();
  } else {
    runtime.map.remove();
  }
}

function fitToBounds(runtime: Runtime, coordinates: [number, number][]) {
  if (!coordinates.length) return;

  const [minLon, minLat, maxLon, maxLat] = coordinates.reduce(
    (accumulator, [longitude, latitude]) => [
      Math.min(accumulator[0], longitude),
      Math.min(accumulator[1], latitude),
      Math.max(accumulator[2], longitude),
      Math.max(accumulator[3], latitude),
    ],
    [coordinates[0][0], coordinates[0][1], coordinates[0][0], coordinates[0][1]],
  );

  if (runtime.kind === "2gis") {
    runtime.map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      {
        padding: { top: 70, right: 70, bottom: 70, left: 70 },
        animation: { duration: 500 },
        maxZoom: coordinates.length === 1 ? 13 : 11.5,
      },
    );
    return;
  }

  const bounds = new maplibregl.LngLatBounds([minLon, minLat], [maxLon, maxLat]);
  runtime.map.fitBounds(bounds, {
    padding: 70,
    duration: 500,
    maxZoom: coordinates.length === 1 ? 13 : 11.5,
  });
}

function buildMarkerElement(point: MapPoint, highlighted: boolean): HTMLElement {
  if (point.kind === "driver" || point.kind === "vehicle") {
    const el = document.createElement("div");
    hydrateMarkerElement(el, point, highlighted);
    return el;
  }
  const marker = document.createElement("button");
  marker.type = "button";
  hydrateMarkerElement(marker, point, highlighted);
  return marker;
}

function hydrateMarkerElement(
  marker: HTMLElement,
  point: MapPoint,
  highlighted: boolean,
) {
  if (point.kind === "driver" || point.kind === "vehicle") {
    const isVehicle = point.kind === "vehicle";
    const bg = isVehicle ? "bg-emerald-600" : "bg-emerald-500";
    const pulse = isVehicle ? "rgba(5,150,105,0.35)" : "rgba(16,185,129,0.35)";
    marker.className = [
      "relative grid place-items-center rounded-full",
      "h-12 w-12 border-2 border-white",
      bg,
      "text-white",
      "shadow-[0_4px_20px_rgba(16,185,129,0.45)]",
      "transition-shadow hover:shadow-[0_4px_28px_rgba(16,185,129,0.7)]",
      highlighted ? "ring-4 ring-white/80 ring-offset-2 ring-offset-emerald-500" : "",
    ].filter(Boolean).join(" ");
    marker.style.overflow = "visible";
    marker.setAttribute("aria-label", [
      point.title,
      point.subtitle,
      point.speed != null ? `${Math.round(point.speed)} км/ч` : null,
    ].filter(Boolean).join(" · "));

    const truckIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;
    const personIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>`;

    marker.innerHTML = `
      <span class="velto-pulse-a" style="background:${pulse};"></span>
      <span class="velto-pulse-b" style="background:${pulse};"></span>
      <span style="position:relative;z-index:1;pointer-events:none;display:flex;align-items:center;justify-content:center;">${isVehicle ? truckIcon : personIcon}</span>
    `;
    return;
  }

  // Static markers for warehouse / pickup
  (marker as HTMLButtonElement).className = [
    "group",
    "grid h-11 w-11 place-items-center rounded-[18px] border border-white/80",
    markerTone(point.kind),
    highlighted ? "ring-4 ring-sky-200" : "",
    "shadow-[0_18px_36px_rgba(15,23,42,0.18)] transition hover:scale-[1.03]",
  ].filter(Boolean).join(" ");
  marker.setAttribute("aria-label", point.title);
  marker.style.fontSize = "16px";
  marker.style.lineHeight = "1";
  if (point.kind === "warehouse") {
    marker.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  } else if (point.kind === "event") {
    const riskBg = point.riskLevel === "high" ? "#ef4444" : point.riskLevel === "medium" ? "#f59e0b" : "#6366f1";
    marker.style.background = riskBg;
    marker.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  } else {
    marker.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  }
}

function buildSelectionElement() {
  const marker = document.createElement("div");
  marker.className =
    "grid h-9 w-9 place-items-center rounded-full border-4 border-sky-500 bg-white/90 shadow-[0_0_0_8px_rgba(14,165,233,0.18)]";
  marker.innerHTML = '<div class="h-2.5 w-2.5 rounded-full bg-sky-500"></div>';
  return marker;
}

function markerTone(kind: MapPoint["kind"]) {
  if (kind === "warehouse") return "bg-slate-400 text-white";
  if (kind === "pickup") return "bg-blue-500 text-white";
  if (kind === "driver") return "bg-emerald-500 text-white";
  if (kind === "event") return "bg-rose-500 text-white";
  return "bg-emerald-600 text-white"; // vehicle
}

function buildObjectLabel(layerId?: string, objectId?: string) {
  if (!layerId && !objectId) return "Точка карты";
  if (layerId?.toLowerCase().includes("building")) return "Здание";
  if (layerId?.toLowerCase().includes("road")) return "Дорожный объект";
  if (layerId?.toLowerCase().includes("poi")) return "POI / организация";
  if (layerId?.toLowerCase().includes("label")) return "Подпись карты";
  return layerId ? `Слой: ${layerId}` : `Объект ${objectId}`;
}

function ControlButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="pointer-events-auto grid h-11 w-11 place-items-center rounded-2xl border border-slate-200/80 bg-white/95 text-slate-700 shadow-[0_20px_40px_rgba(148,163,184,0.18)] backdrop-blur"
    >
      {children}
    </button>
  );
}
