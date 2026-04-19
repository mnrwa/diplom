import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WaybillService {
  constructor(private prisma: PrismaService) {}

  async getOrCreate(routeId: number) {
    const existing = await this.prisma.waybill.findUnique({ where: { routeId }, include: { route: { include: { driver: { include: { user: true } }, vehicle: true, startPoint: true, endPoint: true } } } });
    if (existing) return existing;

    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      include: { driver: { include: { user: true } }, vehicle: true, startPoint: true, endPoint: true },
    });
    if (!route) throw new NotFoundException('Маршрут не найден');

    return this.prisma.waybill.create({
      data: {
        routeId,
        driverName: route.driver?.user?.name ?? 'Не назначен',
        vehiclePlate: route.vehicle?.plateNumber ?? 'Не назначен',
        cargoDesc: `Доставка: ${route.startPoint?.name ?? '—'} → ${route.endPoint?.name ?? '—'}`,
        status: 'DRAFT',
        checkpoints: Array.isArray(route.waypoints)
          ? (route.waypoints as any[]).map((wp, i) => ({ order: i + 1, lat: wp.lat, lon: wp.lon, status: 'PENDING' }))
          : [],
      },
      include: { route: { include: { driver: { include: { user: true } }, vehicle: true, startPoint: true, endPoint: true } } },
    });
  }

  async sign(routeId: number, signatureData: string) {
    const waybill = await this.prisma.waybill.findUnique({ where: { routeId } });
    if (!waybill) throw new NotFoundException('Путевой лист не найден');

    return this.prisma.waybill.update({
      where: { routeId },
      data: { signatureData, status: 'SIGNED', updatedAt: new Date() },
    });
  }

  async updateCheckpoints(routeId: number, checkpoints: any[]) {
    return this.prisma.waybill.update({
      where: { routeId },
      data: { checkpoints, updatedAt: new Date() },
    });
  }
}
