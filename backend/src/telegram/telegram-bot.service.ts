import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';

const FUEL_PRICE_RUB = Number(process.env.FUEL_PRICE_RUB ?? 65);

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}
interface TgMessage {
  message_id: number;
  from: { id: number; first_name: string; username?: string };
  chat: { id: number };
  text?: string;
  location?: { latitude: number; longitude: number };
}
interface TgCallbackQuery {
  id: string;
  from: { id: number };
  data: string;
  message?: { chat: { id: number }; message_id: number };
}

// Inline keyboard definitions
const MAIN_MENU = {
  inline_keyboard: [
    [{ text: '🗺️ Текущий маршрут', callback_data: 'route_info' }],
    [{ text: '📍 Отправить позицию', callback_data: 'send_location_hint' }],
    [{ text: '💬 Написать диспетчеру', callback_data: 'chat_mode' }],
    [{ text: '📊 Статус смены', callback_data: 'shift_status' }],
  ],
};

const ROUTE_MENU = (routeId: number) => ({
  inline_keyboard: [
    [{ text: '✅ Завершить рейс', callback_data: `complete_route_${routeId}` }],
    [{ text: '💬 Написать диспетчеру', callback_data: 'chat_mode' }],
    [{ text: '↩️ Главное меню', callback_data: 'main_menu' }],
  ],
});

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly token = process.env.TELEGRAM_BOT_TOKEN || '';
  private readonly apiBase: string;
  private enabled = false;
  private offset = 0;
  private polling: NodeJS.Timeout | null = null;

  // Per-chat state: "idle" | "linking" | "chatting"
  private chatState = new Map<number, string>();
  // Drivers in "chatting" mode track their driverId
  private chatDriverId = new Map<number, number>();

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {
    this.apiBase = `https://api.telegram.org/bot${this.token}`;
  }

  onModuleInit() {
    if (!this.token || this.token === 'YOUR_BOT_TOKEN') {
      this.logger.warn('TELEGRAM_BOT_TOKEN не задан — бот отключён');
      return;
    }
    this.enabled = true;
    this.logger.log('Telegram Bot polling запущен');
    void this.startPolling();
  }

  onModuleDestroy() {
    if (this.polling) clearTimeout(this.polling);
  }

  private async startPolling() {
    if (!this.enabled) return;
    try {
      const res = await firstValueFrom(
        this.http.get(`${this.apiBase}/getUpdates`, {
          params: { offset: this.offset, timeout: 25, limit: 20 },
          timeout: 30_000,
        }),
      );
      const updates: TgUpdate[] = res.data?.result ?? [];
      for (const u of updates) {
        this.offset = u.update_id + 1;
        await this.handleUpdate(u).catch((e) =>
          this.logger.error(`Update handler error: ${String(e)}`),
        );
      }
    } catch {
      // Network/timeout errors are normal during polling
    }
    this.polling = setTimeout(() => void this.startPolling(), 500);
  }

  // ── Update dispatcher ──────────────────────────────────────────────────────

  private async handleUpdate(u: TgUpdate) {
    if (u.callback_query) {
      await this.handleCallback(u.callback_query);
      return;
    }
    if (!u.message) return;
    const msg = u.message;
    const chatId = msg.chat.id;

    if (msg.location) {
      await this.handleLocation(chatId, msg.location.latitude, msg.location.longitude);
      return;
    }

    const text = (msg.text ?? '').trim();
    if (text.startsWith('/')) {
      await this.handleCommand(chatId, text);
    } else {
      await this.handleText(chatId, text);
    }
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  private async handleCommand(chatId: number, text: string) {
    const [cmd, ...args] = text.split(/\s+/);

    switch (cmd.toLowerCase()) {
      case '/start':
        await this.sendWelcome(chatId);
        break;
      case '/link':
        await this.handleLink(chatId, args[0], args[1]);
        break;
      case '/menu':
        await this.sendMainMenu(chatId);
        break;
      case '/status':
        await this.sendShiftStatus(chatId);
        break;
      case '/route':
        await this.sendRouteCard(chatId);
        break;
      case '/stop':
        this.chatState.set(chatId, 'idle');
        await this.send(chatId, '🔕 Режим чата отключён.', MAIN_MENU);
        break;
      default:
        await this.send(chatId, 'Неизвестная команда. Используйте /menu для навигации.');
    }
  }

  private async sendWelcome(chatId: number) {
    const driver = await this.findDriverByChatId(chatId);
    if (driver) {
      await this.send(
        chatId,
        `👋 С возвращением, <b>${driver.user.name}</b>!\nВы уже подключены к VELTO.`,
        MAIN_MENU,
      );
    } else {
      await this.send(
        chatId,
        `🚛 <b>Добро пожаловать в VELTO Logistics!</b>\n\n` +
          `Для подключения аккаунта введите:\n` +
          `<code>/link ваш@email.ru ваш_пароль</code>\n\n` +
          `После привязки вы получите доступ к маршрутам, чату с диспетчером и GPS-трекингу прямо в Telegram.`,
      );
    }
  }

  private async handleLink(chatId: number, email?: string, password?: string) {
    if (!email || !password) {
      await this.send(chatId, '❌ Использование: <code>/link email пароль</code>');
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { driverProfile: true },
    });

    if (!user || user.role !== 'DRIVER' || !user.driverProfile) {
      await this.send(chatId, '❌ Водитель с таким email не найден.');
      return;
    }

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      await this.send(chatId, '❌ Неверный пароль.');
      return;
    }

    await this.prisma.driverProfile.update({
      where: { id: user.driverProfile.id },
      data: { telegramChatId: String(chatId), telegramLinkedAt: new Date() },
    });

    await this.send(
      chatId,
      `✅ <b>Аккаунт привязан!</b>\n\nВодитель: <b>${user.name}</b>\n\nТеперь вы будете получать уведомления о маршрутах и сможете общаться с диспетчером.`,
      MAIN_MENU,
    );
  }

  private async sendMainMenu(chatId: number) {
    const driver = await this.findDriverByChatId(chatId);
    if (!driver) {
      await this.send(chatId, '❌ Аккаунт не привязан. Используйте /link email пароль');
      return;
    }
    this.chatState.set(chatId, 'idle');
    await this.send(chatId, `👋 <b>${driver.user.name}</b>, выберите действие:`, MAIN_MENU);
  }

  private async sendShiftStatus(chatId: number) {
    const driver = await this.findDriverByChatId(chatId);
    if (!driver) { await this.sendNotLinked(chatId); return; }

    const route = driver.routes?.[0] ?? null;
    const statusMap: Record<string, string> = {
      ON_SHIFT: '🟢 На смене',
      RESTING: '🟡 Отдыхает',
      OFFLINE: '🔴 Офлайн',
    };

    const lines = [
      `👤 <b>${driver.user.name}</b>`,
      `📋 Статус: ${statusMap[driver.status] ?? driver.status}`,
      `🚛 ТС: ${driver.vehicle?.plateNumber ?? 'не назначен'}`,
    ];
    if (route) {
      lines.push(`\n🗺️ <b>Активный маршрут</b>: ${route.name}`);
      lines.push(`📍 ${route.startPoint?.name ?? '—'} → ${route.endPoint?.name ?? '—'}`);
    } else {
      lines.push('\n📭 Активного маршрута нет');
    }

    await this.send(chatId, lines.join('\n'), MAIN_MENU);
  }

  private async sendRouteCard(chatId: number) {
    const driver = await this.findDriverByChatId(chatId);
    if (!driver) { await this.sendNotLinked(chatId); return; }

    const route = driver.routes?.[0] ?? null;
    if (!route) {
      await this.send(chatId, '📭 Активного маршрута нет.', MAIN_MENU);
      return;
    }

    const dist = route.distance ? `${route.distance.toFixed(0)} км` : '—';
    const eta = route.estimatedTime ? `${Math.floor(route.estimatedTime / 60)} ч ${route.estimatedTime % 60} мин` : '—';
    const risk = route.riskScore != null ? `${Math.round(route.riskScore * 100)}%` : '—';
    const fuelCost = route.fuelCostRub ? `~${Math.round(route.fuelCostRub).toLocaleString('ru')} ₽` : '—';

    const trackUrl = route.trackingToken
      ? `\n🔗 <a href="${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/track/${route.trackingToken}">Ссылка для клиента</a>`
      : '';

    await this.send(
      chatId,
      `🗺️ <b>${route.name}</b>\n\n` +
        `📍 ${route.startPoint?.name ?? '—'} → ${route.endPoint?.name ?? '—'}\n` +
        `📏 Дистанция: <b>${dist}</b>\n` +
        `⏱️ ETA: <b>${eta}</b>\n` +
        `⚠️ Риск: ${risk}\n` +
        `⛽ Стоимость: ${fuelCost}${trackUrl}`,
      ROUTE_MENU(route.id),
    );
  }

  // ── Callback query handler ─────────────────────────────────────────────────

  private async handleCallback(cb: TgCallbackQuery) {
    const chatId = cb.message?.chat.id;
    if (!chatId) return;

    await this.answerCallback(cb.id).catch(() => {});

    const data = cb.data;

    if (data === 'main_menu') {
      await this.sendMainMenu(chatId);
    } else if (data === 'route_info') {
      await this.sendRouteCard(chatId);
    } else if (data === 'shift_status') {
      await this.sendShiftStatus(chatId);
    } else if (data === 'send_location_hint') {
      await this.send(
        chatId,
        '📍 Нажмите 📎 → Геопозиция → Отправить текущую геолокацию.\n\nОна сразу появится у диспетчера на карте.',
      );
    } else if (data === 'chat_mode') {
      const driver = await this.findDriverByChatId(chatId);
      if (!driver) { await this.sendNotLinked(chatId); return; }
      this.chatState.set(chatId, 'chatting');
      this.chatDriverId.set(chatId, driver.id);
      await this.send(
        chatId,
        '💬 <b>Режим чата с диспетчером</b>\n\nПишите сообщение — оно сразу появится в веб-интерфейсе.\nДля выхода: /stop',
      );
    } else if (data.startsWith('complete_route_')) {
      const routeId = Number(data.split('_')[2]);
      await this.completeRoute(chatId, routeId);
    }
  }

  private async completeRoute(chatId: number, routeId: number) {
    const driver = await this.findDriverByChatId(chatId);
    if (!driver) { await this.sendNotLinked(chatId); return; }

    const route = driver.routes?.find((r) => r.id === routeId);
    if (!route) {
      await this.send(chatId, '❌ Маршрут не найден или уже завершён.');
      return;
    }

    await this.prisma.route.update({
      where: { id: routeId },
      data: { status: 'COMPLETED' },
    });

    await this.send(
      chatId,
      `✅ <b>Рейс завершён!</b>\n\n${route.name}\n\nОтличная работа! До следующего рейса.`,
      MAIN_MENU,
    );
  }

  // ── Location sharing ───────────────────────────────────────────────────────

  private async handleLocation(chatId: number, lat: number, lon: number) {
    const driver = await this.findDriverByChatId(chatId);
    if (!driver) { await this.sendNotLinked(chatId); return; }
    if (!driver.vehicleId) {
      await this.send(chatId, '⚠️ ТС не назначен — позиция не сохранена.');
      return;
    }

    const route = driver.routes?.[0] ?? null;
    // Save GPS log directly to DB (GpsGateway picks it up on next WebSocket tick)
    await this.prisma.gpsLog.create({
      data: { vehicleId: driver.vehicleId, lat, lon, routeId: route?.id ?? null },
    });

    await this.send(chatId, `✅ Позиция сохранена и появится у диспетчера:\n${lat.toFixed(5)}, ${lon.toFixed(5)}`);
  }

  // ── Text relay (chat mode) ─────────────────────────────────────────────────

  private async handleText(chatId: number, text: string) {
    if (!text) return;
    const state = this.chatState.get(chatId) ?? 'idle';

    if (state !== 'chatting') {
      await this.send(chatId, '💡 Используйте /menu для навигации.');
      return;
    }

    const driverId = this.chatDriverId.get(chatId);
    if (!driverId) return;

    const driver = await this.prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: { user: true, routes: { where: { status: { in: ['ACTIVE', 'PLANNED'] } }, take: 1 } },
    });
    if (!driver) return;

    // Store message in DB so web chat can poll it (WebSocket relay happens via onMessage hook)
    // The dispatcher will see "[Telegram] Name: message" format
    if (this.onChatMessage) {
      this.onChatMessage({
        id: `tg-${Date.now()}`,
        senderId: driverId,
        senderName: `${driver.user.name} 📱`,
        role: 'DRIVER',
        targetDriverId: driverId,
        routeId: driver.routes?.[0]?.id ?? null,
        text,
        timestamp: new Date().toISOString(),
      });
    }

    await this.send(chatId, '✅ Сообщение отправлено диспетчеру.');
  }

  // Injected by GpsGateway after init to avoid circular dep
  onChatMessage: ((msg: any) => void) | null = null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async findDriverByChatId(chatId: number) {
    return this.prisma.driverProfile.findFirst({
      where: { telegramChatId: String(chatId) },
      include: {
        user: true,
        vehicle: true,
        routes: {
          where: { status: { in: ['ACTIVE', 'PLANNED'] } },
          include: { startPoint: true, endPoint: true },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  private sendNotLinked(chatId: number) {
    return this.send(chatId, '❌ Аккаунт не привязан.\n\nИспользуйте <code>/link email пароль</code>');
  }

  private async send(chatId: number, text: string, replyMarkup?: object) {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.apiBase}/sendMessage`,
          {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
            disable_web_page_preview: true,
          },
          { timeout: 8_000 },
        ),
      );
    } catch (e) {
      this.logger.warn(`TG send failed [${chatId}]: ${String(e)}`);
    }
  }

  private async answerCallback(callbackId: string) {
    await firstValueFrom(
      this.http.post(`${this.apiBase}/answerCallbackQuery`, { callback_query_id: callbackId }, { timeout: 4_000 }),
    );
  }

  // Called by GpsGateway when dispatcher sends a chat message — relay to TG
  async relayDispatcherMessage(driverId: number, senderName: string, text: string) {
    if (!this.enabled) return;
    const driver = await this.prisma.driverProfile.findUnique({ where: { id: driverId } });
    if (!driver?.telegramChatId) return;

    const chatId = Number(driver.telegramChatId);
    await this.send(
      chatId,
      `💬 <b>Диспетчер ${senderName}:</b>\n${text}`,
      { inline_keyboard: [[{ text: '↩️ Ответить', callback_data: 'chat_mode' }]] },
    );
  }
}
