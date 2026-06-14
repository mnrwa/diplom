import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { serializeRouteGeometry } from './route-optimizer';

const OSRM_URL = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';

@Controller('public/track')
export class PublicTrackingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HttpService,
  ) {}

  @Get(':token')
  async getByToken(@Param('token') token: string) {
    const route = await this.prisma.route.findUnique({
      where: { trackingToken: token },
      include: {
        startPoint: true,
        endPoint: true,
        driver: { include: { user: true, vehicle: { include: { gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 } } } } },
        vehicle: { include: { gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 } } },
        gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
    });

    if (!route) throw new NotFoundException('Маршрут не найден');

    const latestLog =
      route.vehicle?.gpsLogs?.[0] ??
      route.gpsLogs?.[0] ??
      null;

    // ── Lazy OSRM geometry fetch ──────────────────────────────────────────────
    // If riskFactors has no routing geometry, fetch it from OSRM now so the
    // client always receives road-following geometry (not a straight line).
    let riskFactors: any = route.riskFactors ?? {};
    const hasGeometry = Array.isArray((riskFactors as any)?.routing?.geometry);

    if (!hasGeometry && route.startPoint && route.endPoint) {
      try {
        const { startPoint: sp, endPoint: ep } = route;
        const url =
          `${OSRM_URL}/route/v1/driving/${sp.lon},${sp.lat};${ep.lon},${ep.lat}` +
          `?geometries=geojson&overview=full&alternatives=false`;

        const resp = await firstValueFrom(this.http.get(url, { timeout: 8000 }));
        const coords: [number, number][] | undefined =
          resp.data?.routes?.[0]?.geometry?.coordinates;

        if (Array.isArray(coords) && coords.length > 1) {
          const geometry = serializeRouteGeometry(coords, 320);
          riskFactors = {
            ...riskFactors,
            routing: { ...(riskFactors?.routing ?? {}), geometry, source: 'osrm' },
          };
          // Persist so next request is instant
          await this.prisma.route.update({
            where: { id: route.id },
            data: { riskFactors: riskFactors as any },
          }).catch(() => { /* non-critical */ });
        }
      } catch {
        // OSRM unavailable — client will receive straight-line fallback
      }
    }

    return {
      id: route.id,
      name: route.name,
      status: route.status,
      startPoint: route.startPoint
        ? { name: route.startPoint.name, city: route.startPoint.city, lat: route.startPoint.lat, lon: route.startPoint.lon }
        : null,
      endPoint: route.endPoint
        ? { name: route.endPoint.name, city: route.endPoint.city, lat: route.endPoint.lat, lon: route.endPoint.lon }
        : null,
      distance: route.distance,
      estimatedTime: route.estimatedTime,
      riskScore: route.riskScore,
      fuelCostRub: route.fuelCostRub,
      driver: route.driver?.user
        ? { name: route.driver.user.name }
        : null,
      vehicle: route.vehicle
        ? { plateNumber: route.vehicle.plateNumber, model: route.vehicle.model }
        : null,
      latestPosition: latestLog
        ? { lat: latestLog.lat, lon: latestLog.lon, speed: latestLog.speed, timestamp: latestLog.timestamp }
        : null,
      waypoints: route.waypoints,
      riskFactors,
    };
  }
}
