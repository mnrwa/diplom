import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { GpsService } from './gps.service';

@WebSocketGateway({ cors: { origin: '*' }, namespace: 'gps' })
export class GpsGateway {
  @WebSocketServer()
  server: { emit: (event: string, payload: unknown) => void };

  constructor(private gps: GpsService) {}

  // Driver sends GPS update via WebSocket
  @SubscribeMessage('location')
  async handleLocation(
    @MessageBody() data: { vehicleId: number; lat: number; lon: number; speed?: number; routeId?: number },
    @ConnectedSocket() _client: unknown,
  ) {
    const log = await this.gps.saveLocation(data.vehicleId, data.lat, data.lon, data.speed, data.routeId);
    // Broadcast to all dispatcher clients
    this.broadcastLocation({ ...log, vehicleId: data.vehicleId });
    return { status: 'ok', log };
  }

  // Broadcast location update to all connected dispatcher clients
  broadcastLocation(data: any) {
    if (!this.server) {
      return;
    }

    this.server.emit('vehicle_location', data);
  }

  // Alert dispatcher about high risk
  broadcastRiskAlert(routeId: number, riskScore: number, factors: any) {
    if (!this.server) {
      return;
    }

    this.server.emit('risk_alert', { routeId, riskScore, factors, timestamp: new Date() });
  }
}
