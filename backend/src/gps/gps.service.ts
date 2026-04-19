import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

    if (routeId) {
      await this.checkGeofence(vehicleId, routeId, lat, lon);
    }

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

  async getHeatmap(limit = 5000) {
    const logs = await this.prisma.gpsLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: { lat: true, lon: true, speed: true },
    });

    const GRID = 0.01;
    const cells: Record<string, { lat: number; lon: number; count: number; avgSpeed: number; totalSpeed: number }> = {};

    for (const log of logs) {
      const gridLat = Math.round(log.lat / GRID) * GRID;
      const gridLon = Math.round(log.lon / GRID) * GRID;
      const key = `${gridLat.toFixed(4)},${gridLon.toFixed(4)}`;

      if (!cells[key]) {
        cells[key] = { lat: gridLat, lon: gridLon, count: 0, avgSpeed: 0, totalSpeed: 0 };
      }
      cells[key].count++;
      cells[key].totalSpeed += log.speed ?? 0;
    }

    return Object.values(cells).map((cell) => ({
      lat: cell.lat,
      lon: cell.lon,
      count: cell.count,
      avgSpeed: cell.count > 0 ? Number((cell.totalSpeed / cell.count).toFixed(1)) : 0,
      intensity: Math.min(1, cell.count / 20),
    }));
  }

  async getGeofenceEvents(routeId?: number) {
    return this.prisma.geofenceEvent.findMany({
      where: routeId ? { routeId } : undefined,
      orderBy: { timestamp: 'desc' },
      take: 50,
    });
  }

  private async checkGeofence(vehicleId: number, routeId: number, lat: number, lon: number) {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      include: { endPoint: true },
    });

    if (!route?.endPoint) return null;

    const distToEnd = haversineKm(lat, lon, route.endPoint.lat, route.endPoint.lon);
    const radius = route.endPoint.geofenceRadius ?? 0.5;

    if (distToEnd <= radius) {
      const recentEvent = await this.prisma.geofenceEvent.findFirst({
        where: {
          routeId,
          locationPointId: route.endPoint.id,
          eventType: 'ARRIVED',
          timestamp: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
      });

      if (!recentEvent) {
        await this.prisma.geofenceEvent.create({
          data: {
            routeId,
            locationPointId: route.endPoint.id,
            eventType: 'ARRIVED',
            lat,
            lon,
          },
        });

        if (route.status === 'ACTIVE') {
          await this.prisma.route.update({
            where: { id: routeId },
            data: { status: 'COMPLETED' },
          });
        }

        return { event: 'ARRIVED', locationId: route.endPoint.id };
      }
    }

    return null;
  }
}
