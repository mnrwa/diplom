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
  // ACTIVE routes refresh more often (position changes)
  private readonly activeRefreshSeconds = Number(
    process.env.ROUTE_NEWS_ACTIVE_REFRESH_SECONDS ?? 240,
  );
  // GPS position must be fresher than this to be used as anchor
  private readonly gpsFreshMs = 30 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly routes: RoutesService,
  ) {}

  onModuleInit() {
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
          status: true,
          updatedAt: true,
          riskFactors: true,
          driver: {
            select: {
              vehicle: {
                select: {
                  gpsLogs: {
                    orderBy: { timestamp: 'desc' },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });

      if (!routes.length) return;

      const nowMs = Date.now();

      const due = routes
        .map((route) => {
          const isActive = route.status === 'ACTIVE';
          const refreshWindowMs = resolveRefreshWindowMs(
            route.riskFactors,
            isActive ? this.activeRefreshSeconds : this.refreshSeconds,
            this.emptyRefreshSeconds,
          );
          const lastRefreshMs = resolveLastNewsRefreshMs(
            route.riskFactors,
            route.updatedAt,
          );

          // Extract fresh GPS position for active routes
          const latestGps = route.driver?.vehicle?.gpsLogs?.[0] ?? null;
          const gpsAge = latestGps
            ? nowMs - new Date(latestGps.timestamp).getTime()
            : Infinity;
          const currentPos =
            isActive && latestGps && gpsAge < this.gpsFreshMs
              ? { lat: latestGps.lat, lon: latestGps.lon }
              : undefined;

          return { id: route.id, lastRefreshMs, refreshWindowMs, currentPos };
        })
        .filter((r) => nowMs - r.lastRefreshMs >= r.refreshWindowMs)
        .sort((a, b) => a.lastRefreshMs - b.lastRefreshMs);

      if (!due.length) return;

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
          await this.routes.refreshRouteNews(route.id, route.currentPos);
          if (route.currentPos) {
            this.logger.debug(
              `Route ${route.id} news refreshed from live GPS (${route.currentPos.lat.toFixed(4)}, ${route.currentPos.lon.toFixed(4)})`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Route ${route.id} news refresh failed: ${String(error)}`,
          );
        }
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
      if (Number.isFinite(parsed)) return parsed;
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
    if (Number.isFinite(rawCount) && rawCount <= 0) return emptySeconds * 1_000;
  }
  return baseSeconds * 1_000;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
