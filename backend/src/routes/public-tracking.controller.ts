import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('public/track')
export class PublicTrackingController {
  constructor(private readonly prisma: PrismaService) {}

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
      riskFactors: route.riskFactors,
    };
  }
}
