import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DriversService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const profiles = await this.prisma.driverProfile.findMany({
      include: {
        user: true,
        vehicle: {
          include: {
            gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 },
          },
        },
        routes: {
          where: { status: { in: ['ACTIVE', 'PLANNED', 'RECALCULATING'] } },
          include: { startPoint: true, endPoint: true },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
        newsItems: { orderBy: { publishedAt: 'desc' }, take: 3 },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return profiles.map((profile) => this.serializeDriver(profile));
  }

  async findOne(id: number) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { id },
      include: {
        user: true,
        vehicle: {
          include: {
            gpsLogs: { orderBy: { timestamp: 'desc' }, take: 48 },
          },
        },
        routes: {
          include: {
            startPoint: true,
            endPoint: true,
            gpsLogs: { orderBy: { timestamp: 'desc' }, take: 48 },
            newsItems: { orderBy: { publishedAt: 'desc' }, take: 12 },
          },
          orderBy: { updatedAt: 'desc' },
          take: 6,
        },
        newsItems: { orderBy: { publishedAt: 'desc' }, take: 12 },
      },
    });

    if (!profile) {
      throw new NotFoundException('Водитель не найден');
    }

    const activeRoute =
      profile.routes.find((route) => route.status === 'ACTIVE') ??
      profile.routes.find((route) => route.status === 'PLANNED') ??
      profile.routes[0] ??
      null;

    const history =
      activeRoute?.gpsLogs?.length
        ? [...activeRoute.gpsLogs].sort(
            (left, right) =>
              new Date(left.timestamp).getTime() -
              new Date(right.timestamp).getTime(),
          )
        : [...(profile.vehicle?.gpsLogs ?? [])].sort(
            (left, right) =>
              new Date(left.timestamp).getTime() -
              new Date(right.timestamp).getTime(),
          );

    const newsFeed = activeRoute?.newsItems?.length
      ? activeRoute.newsItems
      : profile.newsItems;

    return {
      ...this.serializeDriver(profile),
      routes: profile.routes.map((route) => ({
        id: route.id,
        name: route.name,
        status: route.status,
        startLat: route.startLat,
        startLon: route.startLon,
        endLat: route.endLat,
        endLon: route.endLon,
        startPoint: route.startPoint,
        endPoint: route.endPoint,
        distance: route.distance,
        estimatedTime: route.estimatedTime,
        riskScore: route.riskScore,
        riskFactors: route.riskFactors,
      })),
      activeRoute: activeRoute
        ? {
            id: activeRoute.id,
            name: activeRoute.name,
            status: activeRoute.status,
            startLat: activeRoute.startLat,
            startLon: activeRoute.startLon,
            endLat: activeRoute.endLat,
            endLon: activeRoute.endLon,
            startPoint: activeRoute.startPoint,
            endPoint: activeRoute.endPoint,
            distance: activeRoute.distance,
            estimatedTime: activeRoute.estimatedTime,
            riskScore: activeRoute.riskScore,
            riskFactors: activeRoute.riskFactors,
            waypoints: activeRoute.waypoints,
          }
        : null,
      track: history,
      newsFeed,
    };
  }

  async findMe(userId: number) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!profile) {
      throw new NotFoundException('У текущего пользователя нет профиля водителя');
    }

    return this.findOne(profile.id);
  }

  async create(data: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    licenseNumber?: string;
    licenseCategory?: string;
    experienceYears?: number;
    vehicleId?: number;
  }) {
    const exists = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (exists) {
      throw new ConflictException('Email уже используется');
    }

    const hashed = await bcrypt.hash(data.password, 10);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          password: hashed,
          name: data.name,
          phone: data.phone,
          role: 'DRIVER',
        },
      });

      const profile = await tx.driverProfile.create({
        data: {
          userId: user.id,
          phone: data.phone,
          licenseNumber: data.licenseNumber,
          licenseCategory: data.licenseCategory || 'C',
          experienceYears: data.experienceYears ?? 3,
          vehicleId: data.vehicleId,
        },
      });

      if (data.vehicleId) {
        await tx.vehicle.update({
          where: { id: data.vehicleId },
          data: {
            driverName: data.name,
          },
        });
      }

      return { user, profile };
    });

    return {
      message: 'Учетная запись водителя создана',
      credentials: {
        email: created.user.email,
        password: data.password,
      },
      driver: await this.findOne(created.profile.id),
    };
  }

  private serializeDriver(profile: any) {
    const latestPosition = profile.vehicle?.gpsLogs?.[0]
      ? {
          lat: profile.vehicle.gpsLogs[0].lat,
          lon: profile.vehicle.gpsLogs[0].lon,
          speed: profile.vehicle.gpsLogs[0].speed,
          timestamp: profile.vehicle.gpsLogs[0].timestamp,
        }
      : null;

    const activeRoute = profile.routes?.[0]
      ? {
          id: profile.routes[0].id,
          name: profile.routes[0].name,
          status: profile.routes[0].status,
          startLat: profile.routes[0].startLat,
          startLon: profile.routes[0].startLon,
          endLat: profile.routes[0].endLat,
          endLon: profile.routes[0].endLon,
          startPoint: profile.routes[0].startPoint,
          endPoint: profile.routes[0].endPoint,
          distance: profile.routes[0].distance,
          estimatedTime: profile.routes[0].estimatedTime,
          riskScore: profile.routes[0].riskScore,
        }
      : null;

    return {
      id: profile.id,
      userId: profile.userId,
      name: profile.user.name,
      email: profile.user.email,
      role: profile.user.role,
      phone: profile.phone || profile.user.phone,
      status: profile.status,
      rating: profile.rating,
      experienceYears: profile.experienceYears,
      licenseCategory: profile.licenseCategory,
      licenseNumber: profile.licenseNumber,
      notes: profile.notes,
      shiftStartedAt: profile.shiftStartedAt,
      vehicle: profile.vehicle
        ? {
            id: profile.vehicle.id,
            plateNumber: profile.vehicle.plateNumber,
            model: profile.vehicle.model,
            status: profile.vehicle.status,
          }
        : null,
      latestPosition,
      activeRoute,
      latestNews: profile.newsItems ?? [],
    };
  }
}
