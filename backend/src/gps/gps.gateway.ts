import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { GpsService } from './gps.service';
import { TelegramService } from '../telegram/telegram.service';
import { TelegramBotService } from '../telegram/telegram-bot.service';
import { PrismaService } from '../prisma/prisma.service';

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

@WebSocketGateway({ cors: { origin: '*' }, namespace: 'gps' })
export class GpsGateway {
  @WebSocketServer()
  server: { emit: (event: string, payload: unknown) => void };

  constructor(
    private gps: GpsService,
    private telegram: TelegramService,
    private telegramBot: TelegramBotService,
    private prisma: PrismaService,
  ) {
    // Wire TG bot → Web chat relay without circular dep
    this.telegramBot.onChatMessage = (msg) => this.broadcastChatMessage(msg);
  }

  @SubscribeMessage('location')
  async handleLocation(
    @MessageBody() data: { vehicleId: number; lat: number; lon: number; speed?: number; routeId?: number },
    @ConnectedSocket() _client: unknown,
  ) {
    const log = await this.gps.saveLocation(data.vehicleId, data.lat, data.lon, data.speed, data.routeId);
    this.broadcastLocation({ ...log, vehicleId: data.vehicleId });
    return { status: 'ok', log };
  }

  @SubscribeMessage('chat_message')
  handleChat(
    @MessageBody() data: { senderId: number; senderName: string; role: 'DISPATCHER' | 'DRIVER'; targetDriverId?: number | null; routeId?: number | null; text: string },
    @ConnectedSocket() _client: unknown,
  ) {
    const msg: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      senderId: data.senderId,
      senderName: data.senderName,
      role: data.role,
      targetDriverId: data.targetDriverId ?? null,
      routeId: data.routeId ?? null,
      text: (data.text || '').trim().slice(0, 500),
      timestamp: new Date().toISOString(),
    };
    if (!msg.text) return;
    this.server.emit('chat_message', msg);

    // Send Telegram notification to driver if dispatcher sent message and driver has Telegram linked
    if (msg.role === 'DISPATCHER' && msg.targetDriverId) {
      this.notifyDriverViaTelegram(msg.targetDriverId, msg.senderName, msg.text).catch(() => {});
    }

    return { status: 'ok' };
  }

  private async notifyDriverViaTelegram(driverId: number, senderName: string, text: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id: driverId },
    });
    // Prefer persistent telegramChatId on profile over legacy route chatId
    const chatId = profile?.telegramChatId ?? null;
    if (chatId) {
      await this.telegram.sendMessage(
        chatId,
        `💬 <b>Диспетчер ${senderName}</b>:\n${text}`,
      );
    }
  }

  broadcastLocation(data: any) {
    if (!this.server) return;
    this.server.emit('vehicle_location', data);
  }

  broadcastRiskAlert(routeId: number, riskScore: number, factors: any) {
    if (!this.server) return;
    this.server.emit('risk_alert', { routeId, riskScore, factors, timestamp: new Date() });
  }

  broadcastChatMessage(msg: ChatMessage) {
    if (!this.server) return;
    this.server.emit('chat_message', msg);
  }
}
