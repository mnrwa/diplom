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

const TICK_MS = 4_000;        // broadcast every 4 seconds
const STEP_KM = 0.25;          // advance ~250m per tick along the path
const INTERP_STEP_KM = 0.15;   // interpolate a point every 150m for smooth path

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
    setTimeout(() => void this.tick(), 3_000);
    this.interval = setInterval(() => void this.tick(), TICK_MS);
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
          vehicleId: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          vehicle: {
            include: {
              gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 },
            },
          },
        },
      });

      const latestRoutesByVehicle = new Map<number, (typeof routes)[number]>();
      for (const route of routes) {
        if (!route.vehicleId || latestRoutesByVehicle.has(route.vehicleId)) {
          continue;
        }
        latestRoutesByVehicle.set(route.vehicleId, route);
      }

      for (const route of latestRoutesByVehicle.values()) {
        if (!route.vehicleId) continue;

        const path = buildSimulationPath(route);
        if (path.length < 2) continue;

        const currentIndex = this.resolveCursor(
          route.vehicleId,
          path,
          route.vehicle?.gpsLogs?.[0] ?? null,
        );

        // Advance by STEP_KM along the path
        const nextIndex = advanceCursor(path, currentIndex, STEP_KM);
        const point = path[nextIndex];
        const prev = path[currentIndex] ?? point;
        const speed = deriveSpeed(prev, point);

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
    latestLog: { lat: number; lon: number } | null,
  ) {
    const known = this.cursorByVehicle.get(vehicleId);
    if (known != null && known < path.length) return known;

    if (!latestLog) {
      this.cursorByVehicle.set(vehicleId, 0);
      return 0;
    }

    let nearestIndex = 0;
    let nearestDist = Infinity;
    path.forEach((pt, i) => {
      const d = (pt.lat - latestLog.lat) ** 2 + (pt.lon - latestLog.lon) ** 2;
      if (d < nearestDist) { nearestDist = d; nearestIndex = i; }
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
  riskFactors?: unknown;
}): SimulationPoint[] {
  // Prefer OSRM geometry stored in riskFactors.routing.geometry
  const osrmGeom = (route.riskFactors as any)?.routing?.geometry;
  if (Array.isArray(osrmGeom) && osrmGeom.length >= 2) {
    const raw: SimulationPoint[] = osrmGeom
      .filter((p: any) => isCoord(Number(p?.lat), Number(p?.lon)))
      .map((p: any) => ({ lat: Number(p.lat), lon: Number(p.lon) }));
    if (raw.length >= 2) return interpolatePath(raw, INTERP_STEP_KM);
  }

  // Fall back to waypoints
  const raw: SimulationPoint[] = [];
  if (isCoord(route.startLat, route.startLon))
    raw.push({ lat: route.startLat, lon: route.startLon });

  if (Array.isArray(route.waypoints)) {
    for (const wp of route.waypoints) {
      const lat = Number((wp as any)?.lat);
      const lon = Number((wp as any)?.lon);
      if (isCoord(lat, lon)) raw.push({ lat, lon });
    }
  }

  if (isCoord(route.endLat, route.endLon))
    raw.push({ lat: route.endLat, lon: route.endLon });

  return raw.length >= 2 ? interpolatePath(raw, INTERP_STEP_KM) : raw;
}

/** Insert intermediate points every stepKm along each segment */
function interpolatePath(pts: SimulationPoint[], stepKm: number): SimulationPoint[] {
  const result: SimulationPoint[] = [pts[0]];

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const segKm = haversineKm(a, b);
    if (segKm < 0.001) { result.push(b); continue; }

    const steps = Math.floor(segKm / stepKm);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      result.push({
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
      });
    }
    result.push(b);
  }

  return result;
}

/** Advance cursor by targetKm along the path, wrapping around */
function advanceCursor(path: SimulationPoint[], from: number, targetKm: number): number {
  let accumulated = 0;
  let idx = from;

  while (accumulated < targetKm) {
    const next = (idx + 1) % path.length;
    accumulated += haversineKm(path[idx], path[next]);
    idx = next;
    if (idx === from) break; // completed full loop
  }

  return idx;
}

function isCoord(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function deriveSpeed(a: SimulationPoint, b: SimulationPoint): number {
  const distKm = haversineKm(a, b);
  const speedKmh = (distKm / (TICK_MS / 1000)) * 3600;
  return Number(Math.min(90, Math.max(20, speedKmh)).toFixed(1));
}

function haversineKm(a: SimulationPoint, b: SimulationPoint): number {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinA = Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat));
  return R * 2 * Math.atan2(Math.sqrt(sinA), Math.sqrt(1 - sinA));
}
