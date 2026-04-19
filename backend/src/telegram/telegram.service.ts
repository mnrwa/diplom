import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token = process.env.TELEGRAM_BOT_TOKEN || '';
  private readonly apiBase: string;
  private enabled = false;

  constructor(private http: HttpService) {
    this.apiBase = `https://api.telegram.org/bot${this.token}`;
  }

  onModuleInit() {
    if (!this.token || this.token === 'YOUR_BOT_TOKEN') {
      this.logger.warn('TELEGRAM_BOT_TOKEN не задан — уведомления отключены');
      return;
    }
    this.enabled = true;
    this.logger.log('Telegram bot активирован');
  }

  async sendMessage(chatId: string, text: string): Promise<boolean> {
    if (!this.enabled || !chatId) return false;
    try {
      await firstValueFrom(
        this.http.post(`${this.apiBase}/sendMessage`, { chat_id: chatId, text, parse_mode: 'HTML' }, { timeout: 5000 }),
      );
      return true;
    } catch (error) {
      this.logger.error(`Ошибка отправки Telegram [${chatId}]: ${error}`);
      return false;
    }
  }

  async notifyRouteCreated(chatId: string, routeName: string, routeId: number, estimatedTime?: number | null) {
    const eta = estimatedTime ? `\nОжидаемое время: ${estimatedTime} мин` : '';
    return this.sendMessage(
      chatId,
      `📦 <b>Заказ создан</b>\nМаршрут: ${routeName} (#${routeId})${eta}\n\nОтслеживайте статус доставки в личном кабинете.`,
    );
  }

  async notifyRouteStatus(chatId: string, routeName: string, routeId: number, status: string) {
    const statusMap: Record<string, string> = {
      ACTIVE: '🚛 Доставка начата',
      COMPLETED: '✅ Доставлено!',
      CANCELLED: '❌ Отменено',
      RECALCULATING: '🔄 Маршрут пересчитывается',
    };
    const label = statusMap[status] ?? `Статус: ${status}`;
    return this.sendMessage(chatId, `${label}\nЗаказ: ${routeName} (#${routeId})`);
  }

  async notifyGeofenceArrival(chatId: string, locationName: string, city: string) {
    return this.sendMessage(chatId, `📍 Водитель прибыл в точку доставки!\n${locationName}, ${city}`);
  }
}
