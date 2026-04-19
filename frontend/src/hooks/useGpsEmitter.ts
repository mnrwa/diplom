'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

export type GpsStatus = 'idle' | 'active' | 'error' | 'denied';

export interface EmitterPosition {
  lat: number;
  lon: number;
  accuracy: number;
  speed: number | null;
  timestamp: number;
}

export function useGpsEmitter(vehicleId: number | null | undefined, routeId?: number | null) {
  const socketRef = useRef<Socket | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const [status, setStatus] = useState<GpsStatus>('idle');
  const [position, setPosition] = useState<EmitterPosition | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Connect socket once on mount
  useEffect(() => {
    const socket = io(`${WS_URL}/gps`, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    return () => {
      socket.disconnect();
    };
  }, []);

  const sendPosition = useCallback(
    (pos: EmitterPosition) => {
      if (!socketRef.current || !vehicleId) return;
      socketRef.current.emit('location', {
        vehicleId,
        lat: pos.lat,
        lon: pos.lon,
        speed: pos.speed ?? undefined,
        routeId: routeId ?? undefined,
      });
    },
    [vehicleId, routeId],
  );

  const start = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Геолокация не поддерживается браузером');
      setStatus('error');
      return;
    }

    if (!vehicleId) {
      setError('vehicleId не задан — GPS не может быть отправлен');
      setStatus('error');
      return;
    }

    setStatus('active');
    setError(null);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const emitterPos: EmitterPosition = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          timestamp: pos.timestamp,
        };
        setPosition(emitterPos);
        sendPosition(emitterPos);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied');
          setError('Доступ к геолокации запрещён. Разрешите в настройках браузера.');
        } else {
          setStatus('error');
          setError(`Ошибка GPS: ${err.message}`);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 5_000,
      },
    );
  }, [vehicleId, sendPosition]);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setStatus('idle');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return { status, position, connected, error, start, stop };
}
