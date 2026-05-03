'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
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

export interface ChatMessage {
  id: string;
  senderId: number;
  senderName: string;
  role: 'DISPATCHER' | 'DRIVER';
  targetDriverId?: number | null;
  routeId?: number | null;
  text: string;
  timestamp: string;
}

export function useWebSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [positions, setPositions] = useState<Record<number, VehiclePosition>>({});
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

    socket.on('chat_message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg].slice(-100));
    });

    return () => { socket.disconnect(); };
  }, []);

  const sendChatMessage = useCallback((
    payload: { senderId: number; senderName: string; role: 'DISPATCHER' | 'DRIVER'; targetDriverId?: number | null; routeId?: number | null; text: string }
  ) => {
    socketRef.current?.emit('chat_message', payload);
  }, []);

  return { positions, alerts, messages, connected, sendChatMessage };
}
