import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  findAll(type?: 'WAREHOUSE' | 'PICKUP_POINT') {
    return this.prisma.locationPoint.findMany({
      where: type ? { type } : undefined,
      orderBy: [{ type: 'asc' }, { city: 'asc' }, { name: 'asc' }],
    });
  }

  create(data: {
    name: string;
    code?: string;
    type: 'WAREHOUSE' | 'PICKUP_POINT';
    city: string;
    address: string;
    lat: number;
    lon: number;
    notes?: string;
  }) {
    return this.prisma.locationPoint.create({
      data: {
        ...data,
        code: data.code || this.buildCode(data),
      },
    });
  }

  async update(id: number, data: Record<string, any>) {
    const exists = await this.prisma.locationPoint.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('Точка не найдена');
    }

    return this.prisma.locationPoint.update({
      where: { id },
      data,
    });
  }

  async delete(id: number) {
    const routesUsingPoint = await this.prisma.route.count({
      where: {
        OR: [{ startPointId: id }, { endPointId: id }],
      },
    });

    if (routesUsingPoint > 0) {
      throw new BadRequestException(
        'Нельзя удалить точку, пока она используется в маршрутах',
      );
    }

    await this.prisma.driverNews.deleteMany({
      where: { locationPointId: id },
    });

    return this.prisma.locationPoint.delete({ where: { id } });
  }

  private buildCode(data: {
    name: string;
    type: 'WAREHOUSE' | 'PICKUP_POINT';
    city: string;
  }) {
    const prefix = data.type === 'WAREHOUSE' ? 'WH' : 'PVZ';
    const city = data.city
      .replace(/[^a-zA-Zа-яА-Я0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 12)
      .toUpperCase();
    const name = data.name
      .replace(/[^a-zA-Zа-яА-Я0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 12)
      .toUpperCase();

    return `${prefix}-${city}-${name}-${Date.now().toString().slice(-4)}`;
  }
}
