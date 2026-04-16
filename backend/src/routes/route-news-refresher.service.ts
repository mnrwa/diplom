import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoutesService } from './routes.service';

@Injectable()
export class RouteNewsRefresherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RouteNewsRefresherService.name);
  private interval: NodeJS.Timeout | null = null;
  private ticking = false;

  private readonly tickSeconds = Number(
    process.env.ROUTE_NEWS_REFRESH_TICK_SECONDS ?? 60,
  );
  private readonly refreshSeconds = Number(
    process.env.ROUTE_NEWS_REFRESH_SECONDS ?? 600,
  );
  private readonly emptyRefreshSeconds = Number(
    process.env.ROUTE_NEWS_EMPTY_REFRESH_SECONDS ?? 180,
  );
  private readonly maxPerTick = Number(
    process.env.ROUTE_NEWS_REFRESH_MAX_PER_TICK ?? 3,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly routes: RoutesService,
  ) {}

  onModuleInit() {
    // Give DB + AI service a moment to boot.
    setTimeout(() => void this.tick(), 12_000);

    this.interval = setInterval(
      () => void this.tick(),
      Math.max(15, this.tickSeconds) * 1_000,
    );
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;

    try {
      const routes = await this.prisma.route.findMany({
        where: {
          status: { in: ['ACTIVE', 'PLANNED', 'RECALCULATING'] },
          startPointId: { not: null },
          endPointId: { not: null },
        },
        select: {
          id: true,
          updatedAt: true,
          riskFactors: true,
        },
      });

      if (!routes.length) {
        return;
      }

      const nowMs = Date.now();

      const due = routes
        .map((route) => ({
          id: route.id,
          lastRefreshMs: resolveLastNewsRefreshMs(
            route.riskFactors,
            route.updatedAt,
          ),
          refreshWindowMs: resolveRefreshWindowMs(
            route.riskFactors,
            this.refreshSeconds,
            this.emptyRefreshSeconds,
          ),
        }))
        .filter(
          (route) => nowMs - route.lastRefreshMs >= route.refreshWindowMs,
        )
        .sort((left, right) => left.lastRefreshMs - right.lastRefreshMs);

      if (!due.length) {
        return;
      }

      // Try to keep a "10 минут на маршрут" budget without пиков:
      // e.g. 30 маршрутов -> ~3 обновления за тик (при тике раз в минуту).
      const idealPerTick = Math.ceil(
        (routes.length * Math.max(15, this.tickSeconds)) /
          Math.max(60, this.refreshSeconds),
      );
      const batchSize = Math.min(
        Math.max(1, idealPerTick),
        Math.max(1, this.maxPerTick),
        due.length,
      );

      for (const route of due.slice(0, batchSize)) {
        try {
          await this.routes.refreshRouteNews(route.id);
        } catch (error) {
          this.logger.warn(
            `Route ${route.id} news refresh failed: ${String(error)}`,
          );
        }

        // small spacing to avoid burst-load on AI-service / search providers
        await sleep(350);
      }
    } finally {
      this.ticking = false;
    }
  }
}

function resolveLastNewsRefreshMs(riskFactors: unknown, fallback: Date) {
  if (riskFactors && typeof riskFactors === 'object') {
    const raw = (riskFactors as any).news_updated_at;
    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return fallback instanceof Date ? fallback.getTime() : Date.now();
}

function resolveRefreshWindowMs(
  riskFactors: unknown,
  refreshSeconds: number,
  emptyRefreshSeconds: number,
) {
  const baseSeconds = Math.max(60, refreshSeconds);
  const emptySeconds = Math.max(60, emptyRefreshSeconds);

  if (riskFactors && typeof riskFactors === 'object') {
    const rawCount = Number((riskFactors as any).news_items);
    if (Number.isFinite(rawCount) && rawCount <= 0) {
      return emptySeconds * 1_000;
    }
  }

  return baseSeconds * 1_000;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
