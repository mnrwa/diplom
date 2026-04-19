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
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.vehicle.findMany({
      include: {
        routes: { where: { status: 'ACTIVE' }, take: 1 },
        gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 },
        driverProfile: { include: { user: true } },
        maintenanceRecords: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
    });
  }

  create(data: any) {
    return this.prisma.vehicle.create({ data });
  }

  update(id: number, data: any) {
    return this.prisma.vehicle.update({ where: { id }, data });
  }

  delete(id: number) {
    return this.prisma.vehicle.delete({ where: { id } });
  }

  async getMaintenance(vehicleId: number) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        gpsLogs: { orderBy: { timestamp: 'asc' } },
        maintenanceRecords: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!vehicle) return null;

    const logs = vehicle.gpsLogs;
    let computedMileage = vehicle.mileageKm;

    if (logs.length > 1) {
      let dist = 0;
      for (let i = 1; i < logs.length; i++) {
        dist += haversineKm(logs[i - 1].lat, logs[i - 1].lon, logs[i].lat, logs[i].lon);
      }
      computedMileage = Math.max(vehicle.mileageKm, dist);

      if (computedMileage !== vehicle.mileageKm) {
        await this.prisma.vehicle.update({ where: { id: vehicleId }, data: { mileageKm: computedMileage } });
      }
    }

    const SERVICE_INTERVAL = 15000;
    const kmSinceService = computedMileage - vehicle.lastServiceKm;
    const kmToNext = Math.max(0, SERVICE_INTERVAL - kmSinceService);
    const urgency = kmToNext < 1000 ? 'CRITICAL' : kmToNext < 3000 ? 'WARNING' : 'OK';

    const avgDailyKm = 200;
    const daysToNext = Math.round(kmToNext / avgDailyKm);

    return {
      vehicleId,
      plateNumber: vehicle.plateNumber,
      model: vehicle.model,
      currentMileageKm: Number(computedMileage.toFixed(1)),
      lastServiceKm: vehicle.lastServiceKm,
      kmSinceService: Number(kmSinceService.toFixed(1)),
      kmToNextService: Number(kmToNext.toFixed(1)),
      daysToNextService: daysToNext,
      urgency,
      serviceInterval: SERVICE_INTERVAL,
      history: vehicle.maintenanceRecords,
    };
  }

  async logMaintenance(vehicleId: number, data: { type: string; notes?: string }) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) return null;

    await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { lastServiceKm: vehicle.mileageKm, status: 'IDLE' },
    });

    return this.prisma.maintenanceRecord.create({
      data: {
        vehicleId,
        type: data.type,
        mileageKm: vehicle.mileageKm,
        doneAt: new Date(),
        notes: data.notes,
      },
    });
  }
}
