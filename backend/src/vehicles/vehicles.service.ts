import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.vehicle.findMany({
      include: {
        routes: { where: { status: 'ACTIVE' }, take: 1 },
        gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 },
        driverProfile: { include: { user: true } },
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
}
