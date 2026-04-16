import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GpsService {
  constructor(private prisma: PrismaService) {}

  async saveLocation(
    vehicleId: number,
    lat: number,
    lon: number,
    speed?: number,
    routeId?: number,
  ) {
    const log = await this.prisma.gpsLog.create({
      data: { vehicleId, lat, lon, speed, routeId },
    });

    await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { status: 'ON_ROUTE' },
    });

    return log;
  }

  async saveBulk(
    vehicleId: number,
    locations: Array<{
      lat: number;
      lon: number;
      speed?: number;
      timestamp?: string;
    }>,
  ) {
    const data = locations.map((location) => ({
      vehicleId,
      lat: location.lat,
      lon: location.lon,
      speed: location.speed,
      timestamp: location.timestamp ? new Date(location.timestamp) : new Date(),
    }));

    return this.prisma.gpsLog.createMany({ data });
  }

  async getHistory(vehicleId: number, limit = 200) {
    return this.prisma.gpsLog.findMany({
      where: { vehicleId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  async getLatestPositions() {
    const vehicles = await this.prisma.vehicle.findMany({
      include: {
        gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 },
        driverProfile: { include: { user: true } },
        routes: {
          where: { status: { in: ['ACTIVE', 'PLANNED'] } },
          include: { startPoint: true, endPoint: true },
          take: 1,
          orderBy: { updatedAt: 'desc' },
        },
      },
    });

    return vehicles.map((vehicle) => ({
      vehicleId: vehicle.id,
      plateNumber: vehicle.plateNumber,
      driverName: vehicle.driverProfile?.user?.name || vehicle.driverName,
      status: vehicle.status,
      route: vehicle.routes[0] || null,
      position: vehicle.gpsLogs[0] || null,
    }));
  }
}
