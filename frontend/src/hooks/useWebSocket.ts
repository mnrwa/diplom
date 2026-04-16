'use client';
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';

export interface VehiclePosition {
  vehicleId: number;
  lat: number;
  lon: number;
  speed?: number;
  timestamp: string;
}

export interface RiskAlert {
  routeId: number;
  riskScore: number;
  factors: any;
  timestamp: string;
}

export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [positions, setPositions] = useState<Record<number, VehiclePosition>>({});
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(`${WS_URL}/gps`, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('vehicle_location', (data: VehiclePosition) => {
      setPositions(prev => ({ ...prev, [data.vehicleId]: data }));
    });

    socket.on('risk_alert', (alert: RiskAlert) => {
      setAlerts(prev => [alert, ...prev].slice(0, 20));
    });

    return () => { socket.disconnect(); };
  }, []);

  return { positions, alerts, connected };
}
