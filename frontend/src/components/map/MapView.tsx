"use client";

import { LocateFixed, Maximize2, Minus, Plus } from "lucide-react";
import maplibregl, {
  type Map as MapLibreMap,
  type Marker as MapLibreMarker,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
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
  kind: "warehouse" | "pickup" | "vehicle" | "driver";
  title: string;
  subtitle?: string;
  longitude: number;
  latitude: number;
  speed?: number | null;
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

type MapViewProps = {
  lines?: MapLine[];
  points?: MapPoint[];
  center?: [number, number];
  className?: string;
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
  element: HTMLButtonElement;
};

type FallbackMarkerRecord = {
  marker: MapLibreMarker;
  element: HTMLButtonElement;
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
};

type Runtime = DgisRuntime | FallbackRuntime;

const DGIS_KEY = process.env.NEXT_PUBLIC_2GIS_KEY?.trim();

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};

export default function MapView({
  lines = [],
  points = [],
  center,
  className = "h-[420px] w-full rounded-[28px]",
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

    if (runtime.kind === "2gis") {
      runtime.map.setCenter(fallbackCenter, { duration: 300 });
    } else {
      runtime.map.easeTo({ center: fallbackCenter, duration: 300 });
    }
  }, [fallbackCenter, ready]);

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

    if (runtime.kind === "2gis") {
      syncDgisMarkers(
        runtime,
        points,
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
        points,
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
    if (!runtime || !ready || !fitToData || !boundsPayload.length) return;

    if (runtime.kind === "2gis") {
      fitToBounds(runtime, boundsPayload);
      return;
    }

    return scheduleFallbackSync(runtime, () => fitToBounds(runtime, boundsPayload));
  }, [boundsPayload, fitToData, ready]);

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
    <div className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(148,163,184,0.18)]">
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
    </div>
  );
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
    if (selectableRef.current) {
      onSelectRef.current?.({
        source: "map",
        longitude: event.lngLat.lng,
        latitude: event.lngLat.lat,
        label: "Точка на карте",
      });
    }
  });

  runtimeRef.current = {
    kind: "fallback",
    map,
    markers: new Map(),
    lineIds: new Set(),
    selectionMarker: null,
  };
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
  if (!runtime.map.isStyleLoaded()) {
    return;
  }

  const nextIds = new Set<string>();

  lines.forEach((line) => {
    if (line.coordinates.length < 2) return;

    const sourceId = `route-source-${line.id}`;
    const layerId = `route-layer-${line.id}`;
    const lineFeature = {
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: line.coordinates,
      },
      properties: {},
    };

    nextIds.add(sourceId);
    nextIds.add(layerId);

    const existingSource = runtime.map.getSource(sourceId) as
      | maplibregl.GeoJSONSource
      | undefined;

    if (existingSource) {
      existingSource.setData(lineFeature);
    } else {
      runtime.map.addSource(sourceId, {
        type: "geojson",
        data: lineFeature,
      });
    }

    if (!runtime.map.getLayer(layerId)) {
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
    } else {
      runtime.map.setPaintProperty(layerId, "line-color", line.color || "#0f766e");
      runtime.map.setPaintProperty(layerId, "line-width", 5);
      runtime.map.setPaintProperty(layerId, "line-opacity", 0.9);
    }
  });

  // IMPORTANT: in MapLibre we must remove layers before sources.
  // `runtime.lineIds` is insertion-ordered and we add source ids before layer ids,
  // so a single-pass cleanup can try to remove a source while its layer still exists.
  runtime.lineIds.forEach((id) => {
    if (nextIds.has(id)) return;
    if (id.startsWith("route-layer-") && runtime.map.getLayer(id)) {
      runtime.map.removeLayer(id);
    }
  });

  runtime.lineIds.forEach((id) => {
    if (nextIds.has(id)) return;
    if (id.startsWith("route-source-") && runtime.map.getSource(id)) {
      runtime.map.removeSource(id);
    }
  });

  runtime.lineIds = nextIds;
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
      record.marker.remove();
      runtime.markers.delete(id);
    }
  });

  points.forEach((point) => {
    const highlighted = highlightedPointIds.includes(point.id);
    const existing = runtime.markers.get(point.id);

    if (existing) {
      existing.marker.setLngLat([point.longitude, point.latitude]);
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

    runtime.markers.set(point.id, {
      marker: new maplibregl.Marker({
        element,
        anchor: "center",
      })
        .setLngLat([point.longitude, point.latitude])
        .addTo(runtime.map),
      element,
    });
  });
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
  element: HTMLButtonElement,
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

  runtime.markers.forEach((record) => record.marker.remove());
  runtime.selectionMarker?.remove();

  if (!runtime.map.isStyleLoaded()) {
    runtime.markers.clear();
    runtime.lineIds.clear();
    runtime.selectionMarker = null;
    return;
  }

  runtime.lineIds.forEach((id) => {
    if (id.startsWith("route-layer-") && runtime.map.getLayer(id)) {
      runtime.map.removeLayer(id);
    }
  });

  runtime.lineIds.forEach((id) => {
    if (id.startsWith("route-source-") && runtime.map.getSource(id)) {
      runtime.map.removeSource(id);
    }
  });

  runtime.markers.clear();
  runtime.lineIds.clear();
  runtime.selectionMarker = null;
}

function isStyleNotReadyError(error: unknown) {
  return error instanceof Error && error.message.includes("Style is not done loading");
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

function buildMarkerElement(point: MapPoint, highlighted: boolean) {
  const marker = document.createElement("button");
  marker.type = "button";
  hydrateMarkerElement(marker, point, highlighted);
  return marker;
}

function hydrateMarkerElement(
  marker: HTMLButtonElement,
  point: MapPoint,
  highlighted: boolean,
) {
  marker.className = [
    "group",
    "grid h-11 w-11 place-items-center rounded-[18px] border border-white/80",
    markerTone(point.kind),
    highlighted ? "ring-4 ring-sky-200" : "",
    "shadow-[0_18px_36px_rgba(15,23,42,0.18)] transition hover:scale-[1.03]",
  ]
    .filter(Boolean)
    .join(" ");
  marker.setAttribute("aria-label", point.title);
  marker.title = point.subtitle ? `${point.title} - ${point.subtitle}` : point.title;
  marker.textContent =
    point.kind === "vehicle" || point.kind === "driver" ? ">" : "o";
  marker.style.fontSize =
    point.kind === "vehicle" || point.kind === "driver" ? "18px" : "24px";
  marker.style.fontWeight = "700";
  marker.style.lineHeight = "1";
}

function buildSelectionElement() {
  const marker = document.createElement("div");
  marker.className =
    "grid h-9 w-9 place-items-center rounded-full border-4 border-sky-500 bg-white/90 shadow-[0_0_0_8px_rgba(14,165,233,0.18)]";
  marker.innerHTML = '<div class="h-2.5 w-2.5 rounded-full bg-sky-500"></div>';
  return marker;
}

function markerTone(kind: MapPoint["kind"]) {
  if (kind === "warehouse") return "bg-amber-500 text-white";
  if (kind === "pickup") return "bg-sky-500 text-white";
  return "bg-emerald-500 text-white";
}

function buildObjectLabel(layerId?: string, objectId?: string) {
  if (!layerId && !objectId) return "Точка карты";
  if (layerId?.toLowerCase().includes("building")) return "Здание 2GIS";
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
