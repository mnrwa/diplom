"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import maplibregl, { type LngLatLike, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LocateFixed, Maximize2, Minus, Plus } from "lucide-react";

type MapContextValue = {
  map: MapLibreMap | null;
  ready: boolean;
};

const MapContext = createContext<MapContextValue>({ map: null, ready: false });

const LIGHT_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

function useMapContext() {
  const context = useContext(MapContext);
  if (!context.map) {
    throw new Error("Map components must be rendered inside <Map />");
  }
  return context;
}

export function Map({
  children,
  center,
  zoom = 5.2,
  className,
}: {
  children?: ReactNode;
  center: [number, number];
  zoom?: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: hostRef.current,
      style: LIGHT_STYLE,
      center: center as LngLatLike,
      zoom,
      attributionControl: { compact: true },
    });

    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    map.on("load", () => {
      setReady(true);
      map.resize();
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !ready) return;
    mapRef.current.easeTo({ center, duration: 600 });
  }, [center, ready]);

  return (
    <MapContext.Provider value={{ map: mapRef.current, ready }}>
      <div className="relative">
        <div className={className} ref={hostRef} />
        {ready ? children : null}
      </div>
    </MapContext.Provider>
  );
}

export function MapControls() {
  const { map } = useMapContext();

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-20 flex flex-col gap-2">
      <ControlButton
        label="Увеличить"
        onClick={() => map.zoomIn({ duration: 350 })}
      >
        <Plus className="h-4 w-4" />
      </ControlButton>
      <ControlButton
        label="Уменьшить"
        onClick={() => map.zoomOut({ duration: 350 })}
      >
        <Minus className="h-4 w-4" />
      </ControlButton>
      <ControlButton
        label="Показать всё"
        onClick={() => map.fitBounds(map.getBounds(), { padding: 20, duration: 500 })}
      >
        <Maximize2 className="h-4 w-4" />
      </ControlButton>
      <ControlButton
        label="Моё местоположение"
        onClick={() => {
          if (!navigator.geolocation) return;
          navigator.geolocation.getCurrentPosition((position) => {
            map.flyTo({
              center: [position.coords.longitude, position.coords.latitude],
              zoom: 10,
              duration: 1200,
            });
          });
        }}
      >
        <LocateFixed className="h-4 w-4" />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
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

type MarkerContextValue = {
  marker: maplibregl.Marker;
};

const MarkerContext = createContext<MarkerContextValue | null>(null);

function useMarkerContext() {
  const context = useContext(MarkerContext);
  if (!context) {
    throw new Error("Marker children must be used inside MapMarker");
  }
  return context;
}

export function MapMarker({
  longitude,
  latitude,
  children,
}: {
  longitude: number;
  latitude: number;
  children: ReactNode;
}) {
  const { map, ready } = useMapContext();
  const markerRef = useRef<maplibregl.Marker | null>(null);

  if (!markerRef.current) {
    markerRef.current = new maplibregl.Marker({
      element: document.createElement("div"),
      anchor: "center",
    }).setLngLat([longitude, latitude]);
  }

  useEffect(() => {
    if (!ready) return;
    markerRef.current?.setLngLat([longitude, latitude]).addTo(map);
    return () => {
      markerRef.current?.remove();
    };
  }, [ready, map, longitude, latitude]);

  useEffect(() => {
    markerRef.current?.setLngLat([longitude, latitude]);
  }, [longitude, latitude]);

  return (
    <MarkerContext.Provider value={{ marker: markerRef.current }}>
      {children}
    </MarkerContext.Provider>
  );
}

export function MarkerContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { marker } = useMarkerContext();
  return createPortal(
    <div className={className}>{children}</div>,
    marker.getElement(),
  );
}

export function MarkerPopup({
  children,
  offset = 18,
}: {
  children: ReactNode;
  offset?: number;
}) {
  const { marker } = useMarkerContext();
  const popupContainer = useMemo(() => document.createElement("div"), []);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  if (!popupRef.current) {
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset,
      maxWidth: "320px",
    });
  }

  useEffect(() => {
    popupRef.current?.setDOMContent(popupContainer);
    marker.setPopup(popupRef.current!);
    return () => {
      marker.setPopup(null);
      popupRef.current?.remove();
    };
  }, [marker, popupContainer]);

  return createPortal(
    <div className="rounded-3xl border border-slate-200 bg-white/98 p-4 text-sm text-slate-700 shadow-[0_24px_60px_rgba(148,163,184,0.22)]">
      {children}
    </div>,
    popupContainer,
  );
}

export function MapRoute({
  id,
  coordinates,
  color = "#0f766e",
  width = 4,
  opacity = 0.92,
  dashArray,
}: {
  id: string;
  coordinates: [number, number][];
  color?: string;
  width?: number;
  opacity?: number;
  dashArray?: number[];
}) {
  const { map, ready } = useMapContext();
  const sourceId = `${id}-source`;
  const layerId = `${id}-layer`;

  useEffect(() => {
    if (!ready || coordinates.length < 2) return;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: {},
        },
      });

      map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": color,
          "line-width": width,
          "line-opacity": opacity,
          ...(dashArray ? { "line-dasharray": dashArray } : {}),
        },
      });
    }

    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
    source.setData({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: {},
    });

    map.setPaintProperty(layerId, "line-color", color);
    map.setPaintProperty(layerId, "line-width", width);
    map.setPaintProperty(layerId, "line-opacity", opacity);

    return () => {
      if (!map || !map.isStyleLoaded()) return;
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    };
  }, [ready, map, sourceId, layerId, color, width, opacity, coordinates, dashArray]);

  return null;
}
