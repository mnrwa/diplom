import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

export type GeocodeResult = {
  displayName: string;
  lat: number;
  lon: number;
  city: string;
  address: string;
  country: string;
};

@Injectable()
export class LocationsService {
  constructor(
    private prisma: PrismaService,
    private http: HttpService,
  ) {}

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

  async geocode(query: string): Promise<GeocodeResult[]> {
    try {
      const response = await firstValueFrom(
        this.http.get('https://nominatim.openstreetmap.org/search', {
          params: {
            q: query,
            format: 'json',
            limit: 6,
            addressdetails: 1,
            'accept-language': 'ru',
          },
          headers: {
            'User-Agent': 'logistics-platform/1.0 (admin@logistics.local)',
            'Accept-Language': 'ru',
          },
          timeout: 6_000,
        }),
      );

      const items = Array.isArray(response.data) ? response.data : [];
      return items.map((item: any) => {
        const addr = item.address || {};
        const city =
          addr.city ||
          addr.town ||
          addr.village ||
          addr.county ||
          addr.state ||
          '';
        const road = addr.road || addr.pedestrian || addr.footway || '';
        const houseNumber = addr.house_number || '';
        const addressLine = [road, houseNumber].filter(Boolean).join(', ') || item.display_name?.split(',')[0] || '';

        return {
          displayName: item.display_name || '',
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
          city,
          address: addressLine,
          country: addr.country || '',
        };
      });
    } catch {
      return [];
    }
  }

  // Find or create a LocationPoint near given coordinates (100m tolerance)
  async findOrCreate(data: {
    name: string;
    type: 'WAREHOUSE' | 'PICKUP_POINT';
    city: string;
    address: string;
    lat: number;
    lon: number;
  }) {
    const nearby = await this.prisma.locationPoint.findFirst({
      where: {
        lat: { gte: data.lat - 0.001, lte: data.lat + 0.001 },
        lon: { gte: data.lon - 0.001, lte: data.lon + 0.001 },
        type: data.type,
      },
    });

    if (nearby) return nearby;

    return this.create(data);
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
