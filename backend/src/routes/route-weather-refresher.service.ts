import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoutesService } from './routes.service';

@Injectable()
export class RouteWeatherRefresherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RouteWeatherRefresherService.name);
  private interval: NodeJS.Timeout | null = null;
  private ticking = false;

  private readonly tickSeconds = Number(
    process.env.ROUTE_WEATHER_REFRESH_TICK_SECONDS ?? 60,
  );
  private readonly refreshSeconds = Number(
    process.env.ROUTE_WEATHER_REFRESH_SECONDS ?? 300,
  );
  private readonly maxPerTick = Number(
    process.env.ROUTE_WEATHER_REFRESH_MAX_PER_TICK ?? 5,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly routes: RoutesService,
  ) {}

  onModuleInit() {
    setTimeout(() => void this.tick(), 20_000);

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
      const refreshWindowMs = Math.max(60, this.refreshSeconds) * 1_000;
      const due = routes
        .map((route) => ({
          id: route.id,
          lastRefreshMs: resolveLastWeatherRefreshMs(
            route.riskFactors,
            route.updatedAt,
          ),
        }))
        .filter((route) => nowMs - route.lastRefreshMs >= refreshWindowMs)
        .sort((left, right) => left.lastRefreshMs - right.lastRefreshMs);

      if (!due.length) {
        return;
      }

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
          await this.routes.refreshRouteWeather(route.id);
        } catch (error) {
          this.logger.warn(
            `Route ${route.id} weather refresh failed: ${String(error)}`,
          );
        }

        await sleep(250);
      }
    } finally {
      this.ticking = false;
    }
  }
}

function resolveLastWeatherRefreshMs(riskFactors: unknown, fallback: Date) {
  if (riskFactors && typeof riskFactors === 'object') {
    const raw = (riskFactors as any).weather_updated_at;
    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return fallback instanceof Date ? fallback.getTime() : Date.now();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
