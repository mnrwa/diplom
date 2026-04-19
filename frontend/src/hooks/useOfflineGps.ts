"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface OfflineGpsState {
  swReady: boolean;
  bufferSize: number;
  lastSync: Date | null;
  syncCount: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export function useOfflineGps(vehicleId: number | null) {
  const swRef = useRef<ServiceWorker | null>(null);
  const [state, setState] = useState<OfflineGpsState>({
    swReady: false,
    bufferSize: 0,
    lastSync: null,
    syncCount: 0,
  });

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        swRef.current = reg.active || reg.installing;
        setState((prev) => ({ ...prev, swReady: true }));
      })
      .catch(() => {});

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "GPS_BUFFER_SIZE") {
        setState((prev) => ({ ...prev, bufferSize: event.data.size }));
      }
      if (event.data?.type === "GPS_SYNC_SUCCESS") {
        setState((prev) => ({
          ...prev,
          bufferSize: 0,
          lastSync: new Date(),
          syncCount: prev.syncCount + event.data.count,
        }));
      }
    };

    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  const bufferPoint = useCallback((point: { lat: number; lon: number; speed?: number; timestamp?: number }) => {
    const sw = swRef.current;
    if (!sw) return;
    sw.postMessage({ type: "GPS_POINT", payload: point });
  }, []);

  const syncNow = useCallback(() => {
    if (!vehicleId) return;
    const sw = swRef.current;
    if (!sw) return;
    sw.postMessage({ type: "SYNC_GPS", apiUrl: API_URL, vehicleId });
  }, [vehicleId]);

  useEffect(() => {
    if (!vehicleId || !state.swReady) return;
    const interval = setInterval(syncNow, 30_000);
    return () => clearInterval(interval);
  }, [vehicleId, state.swReady, syncNow]);

  return { ...state, bufferPoint, syncNow };
}
