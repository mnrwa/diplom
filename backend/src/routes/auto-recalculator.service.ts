import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoutesService } from './routes.service';

const SEVERITY_THRESHOLD = 0.6;
const CHECK_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const COOLDOWN_MS = 10 * 60 * 1000;      // don't recalculate same route more often than 10 min

@Injectable()
export class AutoRecalculatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoRecalculatorService.name);
  private interval: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly lastRecalc = new Map<number, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly routes: RoutesService,
  ) {}

  onModuleInit() {
    setTimeout(() => void this.tick(), 20_000);
    this.interval = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
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
      const activeRoutes = await this.prisma.route.findMany({
        where: { status: 'ACTIVE' },
        include: {
          newsItems: {
            where: { severity: { gte: SEVERITY_THRESHOLD } },
            orderBy: { publishedAt: 'desc' },
            take: 1,
          },
        },
        take: 20,
      });

      for (const route of activeRoutes) {
        if (!route.newsItems.length) continue;

        const now = Date.now();
        const last = this.lastRecalc.get(route.id) ?? 0;
        if (now - last < COOLDOWN_MS) continue;

        this.lastRecalc.set(route.id, now);
        this.logger.log(`Auto-recalculating route ${route.id} (news severity ≥ ${SEVERITY_THRESHOLD})`);

        try {
          await this.routes.recalculate(route.id);
        } catch (err) {
          this.logger.warn(`Route ${route.id} auto-recalc failed: ${String(err)}`);
        }

        await sleep(500);
      }
    } finally {
      this.ticking = false;
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
