import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DemoDataService implements OnModuleInit {
  private readonly logger = new Logger(DemoDataService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.seed();
    } catch (error) {
      this.logger.warn(`Demo data seed skipped: ${String(error)}`);
    }
  }

  private async seed() {
    await this.ensureAdmin();
    await this.ensureLocations();
    const vehicles = await this.ensureVehicles();
    await this.ensureDrivers(vehicles);

    /*
    const seededRoutesCount = await this.prisma.route.count({
      where: {
        startPointId: { not: null },
        endPointId: { not: null },
      },
    });

    if (seededRoutesCount === 0) {
      const routeSpecs = [
        {
          name: 'Москва -> Казань / Северный коридор',
          start: locations.find((item) => item.code === 'WH-MSK-NORTH')!,
          end: locations.find((item) => item.code === 'PVZ-KZN-CENTER')!,
          driver: drivers[0],
          vehicle: vehicles[0],
          riskScore: 0.31,
          riskFactors: { weather: 0.18, news: 0.42, traffic: 0.38, night_hours: false },
        },
        {
          name: 'Екатеринбург -> Тюмень / Урал',
          start: locations.find((item) => item.code === 'WH-EKB-URAL')!,
          end: locations.find((item) => item.code === 'PVZ-TMN-WEST')!,
          driver: drivers[1],
          vehicle: vehicles[1],
          riskScore: 0.24,
          riskFactors: { weather: 0.12, news: 0.24, traffic: 0.29, night_hours: false },
        },
        {
          name: 'Новосибирск -> Красноярск / Восток',
          start: locations.find((item) => item.code === 'WH-NSK-EAST')!,
          end: locations.find((item) => item.code === 'PVZ-KJA-HUB')!,
          driver: drivers[2],
          vehicle: vehicles[2],
          riskScore: 0.47,
          riskFactors: { weather: 0.35, news: 0.44, traffic: 0.41, night_hours: true },
        },
      ];

      for (const spec of routeSpecs) {
        const distance = calculateDistanceKm(spec.start, spec.end);
        const waypoints = buildRouteWaypoints(spec.start, spec.end);
        const route = await this.prisma.route.create({
          data: {
            name: spec.name,
            status: 'ACTIVE',
            startPointId: spec.start.id,
            endPointId: spec.end.id,
            startLat: spec.start.lat,
            startLon: spec.start.lon,
            endLat: spec.end.lat,
            endLon: spec.end.lon,
            waypoints,
            distance,
            estimatedTime: Math.max(95, Math.round((distance / 62) * 60)),
            riskScore: spec.riskScore,
            riskFactors: spec.riskFactors,
            dispatcherId: admin.id,
            driverId: spec.driver.id,
            vehicleId: spec.vehicle.id,
          },
        });

        await this.prisma.vehicle.update({
          where: { id: spec.vehicle.id },
          data: { status: 'ON_ROUTE', driverName: spec.driver.user.name },
        });

        const track = buildMockTrack(spec.start, spec.end);
        await this.prisma.gpsLog.createMany({
          data: track.map((point) => ({
            vehicleId: spec.vehicle.id,
            routeId: route.id,
            lat: point.lat,
            lon: point.lon,
            speed: point.speed,
            timestamp: point.timestamp,
          })),
        });

        const newsItems = buildDriverNewsSeed({
          startName: spec.start.name,
          startCity: spec.start.city,
          endName: spec.end.name,
          endCity: spec.end.city,
        });

        await this.prisma.driverNews.createMany({
          data: newsItems.map((item) => ({
            driverId: spec.driver.id,
            routeId: route.id,
            locationPointId: spec.end.id,
            source: item.source,
            channel: item.channel,
            title: item.title,
            summary: item.summary,
            severity: item.severity,
            city: item.city,
            publishedAt: item.publishedAt,
            url: item.url,
          })),
        });
      }
    }

    */

    const riskEventsCount = await this.prisma.riskEvent.count();
    if (riskEventsCount === 0) {
      await this.prisma.riskEvent.createMany({
        data: [
          {
            type: 'ROAD_WORK',
            title: 'Ремонт полосы у М-7',
            description: 'Ограничение скорости и сужение правой полосы на маршруте в сторону Казани.',
            severity: 0.54,
            source: 'demo/telegram',
            lat: 55.74,
            lon: 49.15,
          },
          {
            type: 'WEATHER',
            title: 'Порывистый ветер на восточном коридоре',
            description: 'AI-модуль рекомендует увеличить временной буфер для рейсов Сибири.',
            severity: 0.43,
            source: 'demo/weather',
            lat: 56.01,
            lon: 92.85,
          },
        ],
      });
    }
  }

  private async ensureAdmin() {
    const existing = await this.prisma.user.findUnique({
      where: { email: 'admin@logistics.local' },
    });

    if (existing) {
      return existing;
    }

    const password = await bcrypt.hash('Admin123!', 10);

    return this.prisma.user.create({
      data: {
        email: 'admin@logistics.local',
        password,
        name: 'Администратор платформы',
        role: 'ADMIN',
        phone: '+7 (900) 100-10-10',
      },
    });
  }

  private async ensureLocations() {
    const items = [
      {
        code: 'WH-MSK-NORTH',
        name: 'Склад Северный',
        type: 'WAREHOUSE' as const,
        city: 'Москва',
        address: 'Ленинградское ш., 71',
        lat: 55.8599,
        lon: 37.5003,
        notes: 'Главный хаб региона',
      },
      {
        code: 'WH-EKB-URAL',
        name: 'Склад Урал',
        type: 'WAREHOUSE' as const,
        city: 'Екатеринбург',
        address: 'ул. Бахчиванджи, 2',
        lat: 56.7501,
        lon: 60.8027,
        notes: 'Хаб для УФО',
      },
      {
        code: 'WH-NSK-EAST',
        name: 'Склад Восточный',
        type: 'WAREHOUSE' as const,
        city: 'Новосибирск',
        address: 'ул. Станционная, 60/1',
        lat: 55.0056,
        lon: 82.8257,
        notes: 'Центральная сортировка',
      },
      {
        code: 'PVZ-KZN-CENTER',
        name: 'ПВЗ Казань Центр',
        type: 'PICKUP_POINT' as const,
        city: 'Казань',
        address: 'ул. Петербургская, 9',
        lat: 55.7887,
        lon: 49.1221,
        notes: 'Основной пункт выдачи',
      },
      {
        code: 'PVZ-TMN-WEST',
        name: 'ПВЗ Тюмень Запад',
        type: 'PICKUP_POINT' as const,
        city: 'Тюмень',
        address: 'Московский тракт, 120',
        lat: 57.153,
        lon: 65.4967,
        notes: 'Коридор в ХМАО',
      },
      {
        code: 'PVZ-KJA-HUB',
        name: 'ПВЗ Красноярск Хаб',
        type: 'PICKUP_POINT' as const,
        city: 'Красноярск',
        address: 'Северное шоссе, 35',
        lat: 56.0375,
        lon: 92.8526,
        notes: 'Точка выдачи и возвратов',
      },
    ];

    const result = [];
    for (const item of items) {
      const location = await this.prisma.locationPoint.upsert({
        where: { code: item.code },
        update: item,
        create: item,
      });
      result.push(location);
    }

    return result;
  }

  private async ensureVehicles() {
    const items = [
      { plateNumber: 'A777MP 138', model: 'Volvo FH 540' },
      { plateNumber: 'B142KT 96', model: 'SITRAK C7H' },
      { plateNumber: 'K908AE 154', model: 'KAMAZ K5' },
    ];

    const result = [];
    for (const item of items) {
      const vehicle = await this.prisma.vehicle.upsert({
        where: { plateNumber: item.plateNumber },
        update: item,
        create: item,
      });
      result.push(vehicle);
    }

    return result;
  }

  private async ensureDrivers(vehicles: Array<{ id: number }>) {
    const items = [
      {
        email: 'driver.morozov@logistics.local',
        name: 'Илья Морозов',
        phone: '+7 (900) 400-10-10',
        licenseNumber: '77 11 456789',
        experienceYears: 7,
        vehicleId: vehicles[0].id,
      },
      {
        email: 'driver.egorova@logistics.local',
        name: 'Марина Егорова',
        phone: '+7 (900) 400-20-20',
        licenseNumber: '66 22 843112',
        experienceYears: 5,
        vehicleId: vehicles[1].id,
      },
      {
        email: 'driver.sokolov@logistics.local',
        name: 'Савелий Соколов',
        phone: '+7 (900) 400-30-30',
        licenseNumber: '54 33 114578',
        experienceYears: 9,
        vehicleId: vehicles[2].id,
      },
    ];

    const result = [];

    for (const item of items) {
      const password = await bcrypt.hash('Driver123!', 10);
      const user = await this.prisma.user.upsert({
        where: { email: item.email },
        update: {
          name: item.name,
          phone: item.phone,
          role: 'DRIVER',
        },
        create: {
          email: item.email,
          password,
          name: item.name,
          phone: item.phone,
          role: 'DRIVER',
        },
      });

      const profile = await this.prisma.driverProfile.upsert({
        where: { userId: user.id },
        update: {
          phone: item.phone,
          licenseNumber: item.licenseNumber,
          experienceYears: item.experienceYears,
          vehicleId: item.vehicleId,
        },
        create: {
          userId: user.id,
          phone: item.phone,
          licenseNumber: item.licenseNumber,
          experienceYears: item.experienceYears,
          vehicleId: item.vehicleId,
        },
      });

      await this.prisma.vehicle.update({
        where: { id: item.vehicleId },
        data: { driverName: item.name },
      });

      result.push({ ...profile, user });
    }

    return result;
  }
}
