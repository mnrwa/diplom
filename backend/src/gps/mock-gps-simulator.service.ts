import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GpsGateway } from './gps.gateway';
import { GpsService } from './gps.service';

type SimulationPoint = {
  lat: number;
  lon: number;
};

@Injectable()
export class MockGpsSimulatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MockGpsSimulatorService.name);
  private readonly cursorByVehicle = new Map<number, number>();
  private interval: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gps: GpsService,
    private readonly gateway: GpsGateway,
  ) {}

  onModuleInit() {
    setTimeout(() => {
      void this.tick();
    }, 3_000);

    this.interval = setInterval(() => {
      void this.tick();
    }, 10_000);
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async tick() {
    if (this.ticking) {
      return;
    }

    this.ticking = true;

    try {
      const routes = await this.prisma.route.findMany({
        where: {
          status: { in: ['ACTIVE', 'PLANNED', 'RECALCULATING'] },
          vehicleId: { not: null },
        },
        include: {
          vehicle: {
            include: {
              gpsLogs: {
                orderBy: { timestamp: 'desc' },
                take: 1,
              },
            },
          },
        },
      });

      for (const route of routes) {
        if (!route.vehicleId) {
          continue;
        }

        const path = buildSimulationPath(route);
        if (path.length < 2) {
          continue;
        }

        const currentIndex = this.resolveCursor(
          route.vehicleId,
          path,
          route.vehicle?.gpsLogs?.[0] ?? null,
        );
        const nextIndex = (currentIndex + 1) % path.length;
        const point = path[nextIndex];
        const previousPoint = path[currentIndex] ?? point;
        const speed = deriveSpeed(previousPoint, point);

        const log = await this.gps.saveLocation(
          route.vehicleId,
          point.lat,
          point.lon,
          speed,
          route.id,
        );

        this.cursorByVehicle.set(route.vehicleId, nextIndex);
        this.gateway.broadcastLocation({
          vehicleId: route.vehicleId,
          routeId: route.id,
          lat: log.lat,
          lon: log.lon,
          speed: log.speed,
          timestamp: log.timestamp,
        });
      }
    } catch (error) {
      this.logger.error(
        'Mock GPS simulation tick failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.ticking = false;
    }
  }

  private resolveCursor(
    vehicleId: number,
    path: SimulationPoint[],
    latestLog:
      | {
          lat: number;
          lon: number;
        }
      | null,
  ) {
    const knownCursor = this.cursorByVehicle.get(vehicleId);
    if (knownCursor != null && knownCursor < path.length) {
      return knownCursor;
    }

    if (!latestLog) {
      this.cursorByVehicle.set(vehicleId, 0);
      return 0;
    }

    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    path.forEach((point, index) => {
      const distance =
        Math.pow(point.lat - latestLog.lat, 2) +
        Math.pow(point.lon - latestLog.lon, 2);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    this.cursorByVehicle.set(vehicleId, nearestIndex);
    return nearestIndex;
  }
}

function buildSimulationPath(route: {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  waypoints?: unknown;
}) {
  const points: SimulationPoint[] = [];

  if (isCoordinate(route.startLat, route.startLon)) {
    points.push({ lat: route.startLat, lon: route.startLon });
  }

  if (Array.isArray(route.waypoints)) {
    route.waypoints.forEach((waypoint) => {
      const lat = Number((waypoint as { lat?: number })?.lat);
      const lon = Number((waypoint as { lon?: number })?.lon);

      if (isCoordinate(lat, lon)) {
        points.push({ lat, lon });
      }
    });
  }

  if (isCoordinate(route.endLat, route.endLon)) {
    points.push({ lat: route.endLat, lon: route.endLon });
  }

  return points.filter((point, index, source) => {
    if (index === 0) {
      return true;
    }

    const previous = source[index - 1];
    return (
      Math.abs(previous.lat - point.lat) > 0.00001 ||
      Math.abs(previous.lon - point.lon) > 0.00001
    );
  });
}

function isCoordinate(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function deriveSpeed(previousPoint: SimulationPoint, point: SimulationPoint) {
  const distanceKm = haversineKm(previousPoint, point);
  const rawSpeed = distanceKm * 360;
  const clamped = Math.min(82, Math.max(24, rawSpeed || 24));
  return Number(clamped.toFixed(1));
}

function haversineKm(first: SimulationPoint, second: SimulationPoint) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(second.lat - first.lat);
  const dLon = toRadians(second.lon - first.lon);
  const lat1 = toRadians(first.lat);
  const lat2 = toRadians(second.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
      Math.sin(dLon / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
