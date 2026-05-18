import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LocationsService } from '../locations/locations.service';
import {
  buildRouteWaypoints,
  calculateDistanceKm,
} from '../demo/demo.utils';
import {
  buildTrackFromGeometry,
  calculateRouteEventExposure,
  extractSpeedSamples,
  geometryToWaypoints,
  getRouteMidpoint,
  pickShortestRoadAlternative,
  rankAlternatives,
  serializeRouteGeometry,
  type Coordinates,
} from './route-optimizer';

@Injectable()
export class RoutesService {
  private readonly aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
  private readonly osrmUrl =
    process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';

  constructor(
    private prisma: PrismaService,
    private http: HttpService,
    private locations: LocationsService,
  ) {}

  async findAll() {
    return this.prisma.route.findMany({
      include: {
        vehicle: true,
        dispatcher: { select: { id: true, name: true, email: true } },
        driver: { include: { user: true } },
        startPoint: true,
        endPoint: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: number) {
    const route = await this.prisma.route.findUnique({
      where: { id },
      include: {
        vehicle: true,
        dispatcher: { select: { id: true, name: true, email: true } },
        driver: { include: { user: true } },
        startPoint: true,
        endPoint: true,
        gpsLogs: { orderBy: { timestamp: 'desc' }, take: 100 },
        newsItems: { orderBy: { publishedAt: 'desc' }, take: 12 },
      },
    });
    if (!route) {
      throw new NotFoundException('Маршрут не найден');
    }
    return route;
  }

  async create(data: any, dispatcherId?: number) {
    const startPoint = await this.prisma.locationPoint.findUnique({
      where: { id: data.startPointId },
    });
    const endPoint = await this.prisma.locationPoint.findUnique({
      where: { id: data.endPointId },
    });

    if (!startPoint || !endPoint) {
      throw new NotFoundException('Стартовая или конечная точка не найдена');
    }

    const vehicle = data.vehicleId
      ? await this.prisma.vehicle.findUnique({
          where: { id: data.vehicleId },
          include: { driverProfile: true },
        })
      : null;

    // ── Capacity check ────────────────────────────────────────────────────────
    if (vehicle && (data.cargoWeightKg || data.cargoVolumeCbm)) {
      const load = await this.getVehicleCurrentLoad(vehicle.id);
      const maxW = (vehicle as any).maxWeightKg ?? 3500;
      const maxV = (vehicle as any).maxVolumeCbm ?? 20;
      if (data.cargoWeightKg && load.weightKg + data.cargoWeightKg > maxW) {
        throw new BadRequestException(
          `Превышена грузоподъёмность: ${Math.round(load.weightKg + data.cargoWeightKg)} кг > ${maxW} кг`,
        );
      }
      if (data.cargoVolumeCbm && load.volumeCbm + data.cargoVolumeCbm > maxV) {
        throw new BadRequestException(
          `Превышен объём кузова: ${(load.volumeCbm + data.cargoVolumeCbm).toFixed(1)} м³ > ${maxV} м³`,
        );
      }
    }

    let driverId = data.driverId;
    if (!driverId && vehicle?.driverProfile?.id) {
      driverId = vehicle.driverProfile.id;
    }

    // ── Geographic feasibility check ──────────────────────────────────────────
    if (driverId) {
      const driverWithGps = await this.prisma.driverProfile.findUnique({
        where: { id: driverId },
        include: {
          vehicle: { include: { gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 } } },
        },
      });
      const gps = driverWithGps?.vehicle?.gpsLogs?.[0];
      if (gps) {
        const dist = calculateDistanceKm(
          { lat: gps.lat, lon: gps.lon },
          { lat: startPoint.lat, lon: startPoint.lon },
        );
        if (dist > 1500) {
          throw new BadRequestException(
            `Водитель находится в ${Math.round(dist)} км от старта маршрута — назначение физически невозможно`,
          );
        }
      }
    }

    const optimized = await this.buildOptimizedRoutePlan(startPoint, endPoint);
    const shouldActivate = Boolean(driverId || data.vehicleId);

    if (shouldActivate) {
      await this.cancelConflictingRoutes({
        driverId,
        vehicleId: data.vehicleId,
      });
    }

    // Calculate fuel cost if vehicle has fuel efficiency data
    const fuelCostRub = await this.calcFuelCost(data.vehicleId, optimized.distanceKm);

    const created = await this.prisma.route.create({
      data: {
        name: data.name,
        startPointId: startPoint.id,
        endPointId: endPoint.id,
        startLat: startPoint.lat,
        startLon: startPoint.lon,
        endLat: endPoint.lat,
        endLon: endPoint.lon,
        waypoints: optimized.waypoints,
        distance: optimized.distanceKm,
        estimatedTime: optimized.estimatedTimeMin,
        riskScore: optimized.riskScore,
        riskFactors: optimized.riskFactors,
        driverId,
        vehicleId: data.vehicleId,
        dispatcherId,
        status: shouldActivate ? 'ACTIVE' : 'PLANNED',
        trackingToken: randomUUID(),
        fuelCostRub,
        cargoWeightKg: data.cargoWeightKg ?? null,
        cargoVolumeCbm: data.cargoVolumeCbm ?? null,
      },
      include: {
        vehicle: true,
        driver: { include: { user: true } },
        startPoint: true,
        endPoint: true,
      },
    });

    if (data.vehicleId) {
      const driver = driverId
        ? await this.prisma.driverProfile.findUnique({
            where: { id: driverId },
            include: { user: true },
          })
        : null;

      await this.prisma.vehicle.update({
        where: { id: data.vehicleId },
        data: {
          status: 'ON_ROUTE',
          driverName: driver?.user.name ?? vehicle?.driverName ?? undefined,
        },
      });

      await this.replaceRouteTrack(created.id, data.vehicleId, optimized.track);
    }

    await this.replaceRouteNews(
      created.id,
      driverId,
      startPoint,
      endPoint,
      optimized,
    );

    return this.findOne(created.id);
  }

  async createQuick(
    data: {
      name?: string;
      startLat: number;
      startLon: number;
      startName: string;
      startCity: string;
      startAddress: string;
      endLat: number;
      endLon: number;
      endName: string;
      endCity: string;
      endAddress: string;
      vehicleId?: number;
      driverId?: number;
    },
    dispatcherId?: number,
  ) {
    const [startPoint, endPoint] = await Promise.all([
      this.locations.findOrCreate({
        name: data.startName,
        type: 'WAREHOUSE',
        city: data.startCity,
        address: data.startAddress,
        lat: data.startLat,
        lon: data.startLon,
      }),
      this.locations.findOrCreate({
        name: data.endName,
        type: 'PICKUP_POINT',
        city: data.endCity,
        address: data.endAddress,
        lat: data.endLat,
        lon: data.endLon,
      }),
    ]);

    const autoName =
      data.name ||
      `${data.startCity} → ${data.endCity}`;

    return this.create(
      {
        name: autoName,
        startPointId: startPoint.id,
        endPointId: endPoint.id,
        vehicleId: data.vehicleId,
        driverId: data.driverId,
      },
      dispatcherId,
    );
  }

  async updateStatus(id: number, status: string) {
    return this.prisma.route.update({
      where: { id },
      data: { status: status as any },
    });
  }

  async recalculate(id: number) {
    const route = await this.findOne(id);

    await this.prisma.route.update({
      where: { id },
      data: { status: 'RECALCULATING' },
    });

    if (!route.startPoint || !route.endPoint) {
      throw new NotFoundException(
        'Маршрут нельзя пересчитать без стартовой и конечной точки',
      );
    }

    const optimized = await this.buildOptimizedRoutePlan(
      route.startPoint,
      route.endPoint,
    );

    const updated = await this.prisma.route.update({
      where: { id },
      data: {
        waypoints: optimized.waypoints,
        distance: optimized.distanceKm,
        estimatedTime: optimized.estimatedTimeMin,
        riskScore: optimized.riskScore,
        riskFactors: optimized.riskFactors,
        status: route.status === 'COMPLETED' ? 'COMPLETED' : 'ACTIVE',
        updatedAt: new Date(),
      },
    });

    if (route.vehicleId) {
      await this.replaceRouteTrack(id, route.vehicleId, optimized.track);
    }

    await this.replaceRouteNews(
      id,
      route.driverId,
      route.startPoint,
      route.endPoint,
      optimized,
    );

    return updated;
  }

  async refreshRouteNews(id: number) {
    const route = await this.prisma.route.findUnique({
      where: { id },
      include: {
        startPoint: true,
        endPoint: true,
      },
    });

    if (!route) {
      throw new NotFoundException('РњР°СЂС€СЂСѓС‚ РЅРµ РЅР°Р№РґРµРЅ');
    }

    if (!route.startPoint || !route.endPoint) {
      return { ok: false, reason: 'missing_points' as const };
    }

    const geometry = this.buildGeometryFromRoute(route);
    if (geometry.length < 2) {
      return { ok: false, reason: 'missing_geometry' as const };
    }

    const newsPayload = await this.fetchNewsRisk({
      startPoint: route.startPoint,
      endPoint: route.endPoint,
      geometry,
    });

    const now = new Date();
    const existingRiskFactors =
      route.riskFactors && typeof route.riskFactors === 'object'
        ? (route.riskFactors as any)
        : {};

    const updatedRiskFactors = {
      ...existingRiskFactors,
      news: Number((newsPayload.totalRisk ?? 0).toFixed(3)),
      news_updated_at: now.toISOString(),
      news_items: Array.isArray(newsPayload.risks) ? newsPayload.risks.length : 0,
    };

    await this.prisma.route.update({
      where: { id },
      data: {
        riskFactors: updatedRiskFactors,
      },
    });

    await this.replaceRouteNews(
      id,
      route.driverId,
      route.startPoint,
      route.endPoint,
      {
        distanceKm:
          typeof route.distance === 'number'
            ? route.distance
            : calculateDistanceKm(route.startPoint, route.endPoint),
        estimatedTimeMin: route.estimatedTime ?? 0,
        riskFactors: updatedRiskFactors,
        newsFeedItems: newsPayload.risks,
      },
    );

    return {
      ok: true,
      updated: Array.isArray(newsPayload.risks) && newsPayload.risks.length > 0,
      count: Array.isArray(newsPayload.risks) ? newsPayload.risks.length : 0,
      totalRisk: Number((newsPayload.totalRisk ?? 0).toFixed(3)),
    };
  }

  async refreshRouteWeather(id: number) {
    const route = await this.prisma.route.findUnique({
      where: { id },
      include: {
        startPoint: true,
        endPoint: true,
      },
    });

    if (!route) {
      throw new NotFoundException('РњР°СЂС€СЂСѓС‚ РЅРµ РЅР°Р№РґРµРЅ');
    }

    if (!route.startPoint || !route.endPoint) {
      return { ok: false, reason: 'missing_points' as const };
    }

    const geometry = this.buildGeometryFromRoute(route);
    const weatherPoint = getRouteMidpoint(
      geometry.length >= 2
        ? geometry
        : [
            [route.startLon, route.startLat],
            [route.endLon, route.endLat],
          ],
      route.startPoint,
      route.endPoint,
    );
    const weatherRisk = await this.fetchWeatherRisk(weatherPoint);
    const now = new Date();
    const existingRiskFactors =
      route.riskFactors && typeof route.riskFactors === 'object'
        ? (route.riskFactors as any)
        : {};
    const previousWeatherRisk = Number(existingRiskFactors.weather ?? 0);
    const updatedRiskFactors = {
      ...existingRiskFactors,
      weather: Number(weatherRisk.toFixed(3)),
      weather_updated_at: now.toISOString(),
      weather_delta: Number((weatherRisk - previousWeatherRisk).toFixed(3)),
      weather_point: {
        lat: Number(weatherPoint.lat.toFixed(5)),
        lon: Number(weatherPoint.lon.toFixed(5)),
      },
      weather_status:
        weatherRisk >= 0.65 ? 'high' : weatherRisk >= 0.35 ? 'medium' : 'low',
    };
    const riskScore = this.recalculateRouteRiskScore(
      updatedRiskFactors,
      route.riskScore ?? 0,
    );

    await this.prisma.route.update({
      where: { id },
      data: {
        riskFactors: updatedRiskFactors,
        riskScore,
      },
    });

    return {
      ok: true,
      weatherRisk,
      previousWeatherRisk,
      riskScore,
      changed: Math.abs(weatherRisk - previousWeatherRisk) >= 0.03,
    };
  }

  async delete(id: number) {
    await this.prisma.driverNews.deleteMany({ where: { routeId: id } });
    await this.prisma.gpsLog.deleteMany({ where: { routeId: id } });
    return this.prisma.route.delete({ where: { id } });
  }

  private async calcFuelCost(vehicleId: number | undefined, distanceKm: number | undefined): Promise<number | null> {
    if (!vehicleId || !distanceKm) return null;
    try {
      const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
      const efficiency = (vehicle as any)?.fuelEfficiencyL100km ?? 25.0;
      const fuelPrice = Number(process.env.FUEL_PRICE_RUB ?? 65);
      return Math.round(distanceKm * efficiency / 100 * fuelPrice);
    } catch { return null; }
  }

  private buildGeometryFromRoute(route: {
    startLat: number;
    startLon: number;
    endLat: number;
    endLon: number;
    waypoints?: unknown;
    riskFactors?: unknown;
  }): [number, number][] {
    const geometry: [number, number][] = [];

    const pushPoint = (lon: number, lat: number) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      if (!geometry.length) {
        geometry.push([lon, lat]);
        return;
      }

      const last = geometry[geometry.length - 1];
      if (Math.abs(last[0] - lon) < 0.000001 && Math.abs(last[1] - lat) < 0.000001) {
        return;
      }

      geometry.push([lon, lat]);
    };

    pushPoint(route.startLon, route.startLat);

    const routingGeometry = (route.riskFactors as any)?.routing?.geometry;
    if (Array.isArray(routingGeometry)) {
      routingGeometry.forEach((point: any) => {
        const lat = Number(point?.lat);
        const lon = Number(point?.lon);
        pushPoint(lon, lat);
      });
    }

    if (Array.isArray(route.waypoints)) {
      route.waypoints.forEach((waypoint: any) => {
        const lat = Number(waypoint?.lat);
        const lon = Number(waypoint?.lon);
        pushPoint(lon, lat);
      });
    }

    pushPoint(route.endLon, route.endLat);

    return geometry;
  }

  private async buildOptimizedRoutePlan(startPoint: any, endPoint: any) {
    const routeEvents = await this.prisma.riskEvent.findMany({
      where: {
        active: true,
        lat: { not: null },
        lon: { not: null },
      },
      orderBy: { severity: 'desc' },
      take: 16,
    });

    try {
      const osrmResponse = await firstValueFrom(
        this.http.get(
          `${this.osrmUrl}/route/v1/driving/${startPoint.lon},${startPoint.lat};${endPoint.lon},${endPoint.lat}`,
          {
            params: {
              alternatives: 3,
              annotations: 'duration,distance,speed',
              geometries: 'geojson',
              overview: 'full',
              steps: false,
            },
            headers: {
              'User-Agent': 'logistics-platform/1.0',
            },
            timeout: 12_000,
          },
        ),
      );

      if (
        osrmResponse.data?.code !== 'Ok' ||
        !Array.isArray(osrmResponse.data?.routes) ||
        !osrmResponse.data.routes.length
      ) {
        throw new Error('No road routes returned from OSRM');
      }

      const rawAlternatives = osrmResponse.data.routes.map((route: any) => {
        const geometry =
          route?.geometry?.coordinates?.map(
            (item: [number, number]) => [item[0], item[1]] as [number, number],
          ) ?? [];
        const distanceKm = Number(((route.distance || 0) / 1000).toFixed(1));
        const durationMin = Math.max(
          1,
          Math.round((route.duration || 0) / 60),
        );
        const avgSpeedKph =
          durationMin > 0
            ? Number(((distanceKm / durationMin) * 60).toFixed(1))
            : 0;
        const speedSamples = extractSpeedSamples(route);
        const eventExposure = calculateRouteEventExposure(geometry, routeEvents);

        return {
          geometry,
          distanceKm,
          durationMin,
          avgSpeedKph,
          speedSamples,
          eventExposure: eventExposure.score,
          eventMatches: eventExposure.matches,
        };
      });

      const weatherRisk = await this.fetchWeatherRisk(
        getRouteMidpoint(rawAlternatives[0].geometry, startPoint, endPoint),
      );
      const newsPayload = await this.fetchNewsRisk({
        startPoint,
        endPoint,
        geometry: rawAlternatives[0].geometry,
      });
      const baseDistance = Math.min(
        ...rawAlternatives.map((item) => item.distanceKm),
      );
      const aiRiskBase = await this.fetchAiRisk({
        start: startPoint,
        end: endPoint,
        distanceKm: baseDistance,
        weatherRisk,
        newsRisk: newsPayload.totalRisk,
      });

      const ranked = rankAlternatives(
        rawAlternatives.map((alternative) => ({
          geometry: alternative.geometry,
          distanceKm: alternative.distanceKm,
          durationMin: alternative.durationMin,
          avgSpeedKph: alternative.avgSpeedKph,
          eventExposure: alternative.eventExposure,
          eventMatches: alternative.eventMatches,
        })),
        {
          weatherRisk,
          newsRisk: newsPayload.totalRisk,
          aiRiskBase,
          hourOfDay: new Date().getHours(),
        },
      );

      const bestSummary = pickShortestRoadAlternative(ranked) ?? ranked[0];
      const bestAlternative =
        rawAlternatives[bestSummary.rank - 1] ?? rawAlternatives[0];
      const roadSituationRisk = Number(
        Math.min(
          1,
          aiRiskBase * 0.48 +
            bestSummary.eventExposure * 0.24 +
            bestSummary.trafficPenalty * 0.16 +
            weatherRisk * 0.07 +
            newsPayload.totalRisk * 0.05,
        ).toFixed(3),
      );

      return {
        distanceKm: bestSummary.distanceKm,
        estimatedTimeMin: bestSummary.durationMin,
        waypoints: geometryToWaypoints(bestAlternative.geometry),
        track: buildTrackFromGeometry(
          bestAlternative.geometry,
          bestAlternative.speedSamples,
        ),
        riskScore: roadSituationRisk,
        newsFeedItems: newsPayload.risks,
        riskFactors: {
          weather: Number(weatherRisk.toFixed(3)),
          news: Number(newsPayload.totalRisk.toFixed(3)),
          news_updated_at: new Date().toISOString(),
          news_items: Array.isArray(newsPayload.risks) ? newsPayload.risks.length : 0,
          traffic: bestSummary.trafficPenalty,
          road_situation: bestSummary.eventExposure,
          ai_base: Number(aiRiskBase.toFixed(3)),
          night_hours: false,
          routing: {
            source: 'osrm',
            profile: 'driving',
            selection_strategy: 'shortest_road_path',
            alternatives_considered: ranked.length,
            selected_rank: bestSummary.rank,
            avg_speed_kmh: bestSummary.avgSpeedKph,
            route_weight: bestSummary.routeWeight,
            geometry: serializeRouteGeometry(bestAlternative.geometry),
            route_midpoint: getRouteMidpoint(
              bestAlternative.geometry,
              startPoint,
              endPoint,
            ),
            road_events: bestSummary.eventMatches,
            alternative_scores: ranked.map((item) => ({
              rank: item.rank,
              distance_km: item.distanceKm,
              duration_min: item.durationMin,
              avg_speed_kmh: item.avgSpeedKph,
              route_weight: item.routeWeight,
            })),
          },
        },
      };
    } catch {
      return this.buildFallbackRoutePlan(startPoint, endPoint, routeEvents);
    }
  }

  private async fetchAiRisk(input: {
    start: Coordinates;
    end: Coordinates;
    distanceKm: number;
    weatherRisk: number;
    newsRisk: number;
  }) {
    try {
      const aiRes = await firstValueFrom(
        this.http.post(
          `${this.aiUrl}/analyze-risk`,
          {
            start_lat: input.start.lat,
            start_lon: input.start.lon,
            end_lat: input.end.lat,
            end_lon: input.end.lon,
            distance_km: input.distanceKm,
            weather_score: input.weatherRisk,
            news_score: input.newsRisk,
            hour_of_day: new Date().getHours(),
          },
          { timeout: 6_000 },
        ),
      );

      return Number((aiRes.data?.risk_score ?? 0).toFixed(3));
    } catch {
      return 0.28;
    }
  }

  private async fetchWeatherRisk(point: Coordinates) {
    try {
      const weatherRes = await firstValueFrom(
        this.http.get(`${this.aiUrl}/weather`, {
          params: { lat: point.lat, lon: point.lon },
          timeout: 5_000,
        }),
      );

      return Number((weatherRes.data?.risk_score ?? 0).toFixed(3));
    } catch {
      return 0.15;
    }
  }

  private recalculateRouteRiskScore(
    riskFactors: Record<string, any>,
    fallbackRiskScore: number,
  ) {
    const weather = Number(riskFactors.weather ?? 0);
    const news = Number(riskFactors.news ?? 0);
    const traffic = Number(riskFactors.traffic ?? 0);
    const roadSituation = Number(riskFactors.road_situation ?? 0);
    const aiBase = Number(riskFactors.ai_base ?? fallbackRiskScore ?? 0);

    const weighted =
      aiBase * 0.48 +
      roadSituation * 0.24 +
      traffic * 0.16 +
      weather * 0.07 +
      news * 0.05;

    if (!Number.isFinite(weighted) || weighted <= 0) {
      return Number(Math.min(1, Math.max(0, fallbackRiskScore)).toFixed(3));
    }

    return Number(Math.min(1, Math.max(0, weighted)).toFixed(3));
  }

  private async fetchNewsRisk(input: {
    startPoint: any;
    endPoint: any;
    geometry: [number, number][];
  }) {
    const midpoint = getRouteMidpoint(
      input.geometry,
      input.startPoint,
      input.endPoint,
    );
    const sampledWaypoints = geometryToWaypoints(input.geometry, 12)
      .filter((_, index, source) => {
        if (source.length <= 6) {
          return true;
        }

        return index % Math.ceil(source.length / 6) === 0;
      })
      .map((point, index) => ({
        name: `Промежуточная точка ${index + 1}`,
        lat: point.lat,
        lon: point.lon,
      }));

    try {
      const newsRes = await firstValueFrom(
        this.http.post(
          `${this.aiUrl}/news-risks/route`,
          {
            lat: midpoint.lat,
            lon: midpoint.lon,
            start: {
              name: input.startPoint.name,
              city: input.startPoint.city,
              address: input.startPoint.address,
              lat: input.startPoint.lat,
              lon: input.startPoint.lon,
            },
            end: {
              name: input.endPoint.name,
              city: input.endPoint.city,
              address: input.endPoint.address,
              lat: input.endPoint.lat,
              lon: input.endPoint.lon,
            },
            waypoints: sampledWaypoints,
            max_items: 10,
            lookback_hours: 72,
          },
          {
            timeout: 7_000,
          },
        ),
      );

      return {
        totalRisk: Number((newsRes.data?.total_risk ?? 0).toFixed(3)),
        risks: Array.isArray(newsRes.data?.risks) ? newsRes.data.risks : [],
      };
    } catch {
      try {
        const legacyNewsRes = await firstValueFrom(
          this.http.get(`${this.aiUrl}/news-risks`, {
            params: { lat: midpoint.lat, lon: midpoint.lon },
            timeout: 5_000,
          }),
        );

        return {
          totalRisk: Number((legacyNewsRes.data?.total_risk ?? 0).toFixed(3)),
          risks: Array.isArray(legacyNewsRes.data?.risks)
            ? legacyNewsRes.data.risks
            : [],
        };
      } catch {
        return { totalRisk: 0, risks: [] };
      }
    }
  }

  private async buildFallbackRoutePlan(
    startPoint: any,
    endPoint: any,
    routeEvents: any[],
  ) {
    const geometry: [number, number][] = [
      [startPoint.lon, startPoint.lat],
      ...buildRouteWaypoints(startPoint, endPoint).map((item) => [
        item.lon,
        item.lat,
      ] as [number, number]),
      [endPoint.lon, endPoint.lat],
    ];

    const distanceKm = calculateDistanceKm(startPoint, endPoint);
    const estimatedTimeMin = Math.max(90, Math.round((distanceKm / 58) * 60));
    const eventExposure = calculateRouteEventExposure(geometry, routeEvents);
    const newsPayload = await this.fetchNewsRisk({
      startPoint,
      endPoint,
      geometry,
    });
    const riskScore = Number(
      Math.min(
        1,
        0.24 + eventExposure.score * 0.35 + newsPayload.totalRisk * 0.16,
      ).toFixed(3),
    );

    return {
      distanceKm,
      estimatedTimeMin,
      waypoints: geometryToWaypoints(geometry, 18),
      track: buildTrackFromGeometry(geometry),
      riskScore,
      newsFeedItems: newsPayload.risks,
      riskFactors: {
        weather: 0.22,
        news: Number(newsPayload.totalRisk.toFixed(3)),
        news_updated_at: new Date().toISOString(),
        news_items: Array.isArray(newsPayload.risks) ? newsPayload.risks.length : 0,
        traffic: 0.31,
        road_situation: eventExposure.score,
        night_hours: false,
        routing: {
          source: 'fallback',
          profile: 'direct-demo',
          selection_strategy: 'fallback_direct_path',
          alternatives_considered: 1,
          selected_rank: 1,
          avg_speed_kmh: 58,
          route_weight: 1,
          geometry: serializeRouteGeometry(geometry, 96),
          road_events: eventExposure.matches,
          alternative_scores: [
            {
              rank: 1,
              distance_km: distanceKm,
              duration_min: estimatedTimeMin,
              avg_speed_kmh: 58,
              route_weight: 1,
            },
          ],
        },
      },
    };
  }

  private async replaceRouteTrack(
    routeId: number,
    vehicleId: number,
    track: Array<{ lat: number; lon: number; speed: number; timestamp: Date }>,
  ) {
    await this.prisma.gpsLog.deleteMany({ where: { routeId } });

    if (!track.length) {
      return;
    }

    await this.prisma.gpsLog.createMany({
      data: track.map((point) => ({
        vehicleId,
        routeId,
        lat: point.lat,
        lon: point.lon,
        speed: point.speed,
        timestamp: point.timestamp,
      })),
    });
  }

  private async replaceRouteNews(
    routeId: number,
    driverId: number | undefined | null,
    startPoint: any,
    endPoint: any,
    optimized: {
      distanceKm: number;
      estimatedTimeMin: number;
      riskFactors: Record<string, any>;
      newsFeedItems?: Array<Record<string, any>>;
    },
  ) {
    /*
    const roadEvents =
      optimized.riskFactors?.routing?.road_events?.length > 0
        ? optimized.riskFactors.routing.road_events
            .map((item: any) => item.title)
            .join(', ')
        : 'критичных дорожных событий по трассе не найдено';

    const internalNews = {
      source: 'INTERNAL' as const,
      channel: 'Route Optimizer',
      title: 'Маршрут подобран по дорожной сети',
      summary: `Выбран дорожный вариант: ${optimized.distanceKm} км, ${optimized.estimatedTimeMin} мин. Учтены дорожные события: ${roadEvents}.`,
      severity: Number(
        (
          optimized.riskFactors?.road_situation ??
          optimized.riskFactors?.traffic ??
          0.2
        ).toFixed(3),
      ),
      city: endPoint.city,
      publishedAt: new Date(),
      url: null,
    };

    */

    const parsedNews = Array.isArray(optimized.newsFeedItems)
      ? optimized.newsFeedItems
          .slice(0, 12)
          .map((item: any) => ({
            source: this.normalizeDriverNewsSource(item),
            channel: item.channel || item.source || 'Route Parser',
            title: item.title || 'Сигнал по маршруту',
            summary:
              item.summary ||
              item.description ||
              'Найдено событие по ходу следования маршрута.',
            severity: Number(
              (
                item.score ??
                item.severity ??
                optimized.riskFactors?.news ??
                0.3
              ).toFixed(3),
            ),
            city: item.city || endPoint.city,
            publishedAt: item.publishedAt
              ? new Date(item.publishedAt)
              : new Date(),
            url: item.url ?? null,
          }))
      : [];

    const newsItems = parsedNews;

    if (!newsItems.length) {
      return;
    }

    await this.prisma.driverNews.deleteMany({ where: { routeId } });

    await this.prisma.driverNews.createMany({
      data: newsItems.map((item) => ({
        driverId,
        routeId,
        locationPointId: endPoint.id,
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

  async autoAssign(routeId: number) {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      include: { startPoint: true },
    });
    if (!route) throw new NotFoundException('Маршрут не найден');

    const candidates = await this.prisma.driverProfile.findMany({
      where: { status: 'ON_SHIFT' },
      include: {
        user: true,
        vehicle: { include: { gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 } } },
        routes: { where: { status: { in: ['ACTIVE', 'PLANNED'] } }, take: 1 },
      },
    });

    const available = candidates.filter((d) => {
      if (!d.vehicle || d.routes.length > 0) return false;
      // Geographic feasibility: skip drivers physically too far from route start
      const gps = d.vehicle.gpsLogs?.[0];
      if (gps && route.startPoint) {
        const dist = calculateDistanceKm(
          { lat: gps.lat, lon: gps.lon },
          { lat: route.startPoint.lat, lon: route.startPoint.lon },
        );
        if (dist > 1500) return false;
      }
      return true;
    });

    if (!available.length) {
      return { ok: false, reason: 'no_available_drivers', suggestions: [] };
    }

    const scored = available.map((driver) => {
      const gps = driver.vehicle?.gpsLogs?.[0];
      let distScore = 0;
      if (gps && route.startPoint) {
        const dist = calculateDistanceKm(
          { lat: gps.lat, lon: gps.lon },
          { lat: route.startPoint.lat, lon: route.startPoint.lon },
        );
        distScore = Math.max(0, 1 - dist / 500);
      }
      const ratingScore = (driver.rating ?? 4.7) / 5;
      const expScore = Math.min(1, (driver.experienceYears ?? 3) / 10);
      const telemScore = driver.telematicsScore != null ? driver.telematicsScore / 100 : 0.7;
      const total = distScore * 0.35 + ratingScore * 0.30 + expScore * 0.20 + telemScore * 0.15;

      return {
        driverId: driver.id,
        name: driver.user.name,
        rating: driver.rating,
        experienceYears: driver.experienceYears,
        vehicleId: driver.vehicle?.id,
        vehiclePlate: driver.vehicle?.plateNumber,
        score: Number(total.toFixed(3)),
        distanceToStart: gps && route.startPoint
          ? Number(calculateDistanceKm({ lat: gps.lat, lon: gps.lon }, { lat: route.startPoint.lat, lon: route.startPoint.lon }).toFixed(1))
          : null,
      };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0];
    await this.cancelConflictingRoutes({
      driverId: best.driverId,
      vehicleId: best.vehicleId ?? undefined,
      excludeRouteId: routeId,
    });

    await this.prisma.route.update({
      where: { id: routeId },
      data: {
        driverId: best.driverId,
        vehicleId: best.vehicleId ?? undefined,
        status: 'ACTIVE',
      },
    });

    return { ok: true, assigned: best, suggestions: scored.slice(0, 3) };
  }

  private async cancelConflictingRoutes(input: {
    driverId?: number | null;
    vehicleId?: number | null;
    excludeRouteId?: number;
  }) {
    const clauses: Array<Record<string, number>> = [];

    if (input.driverId) {
      clauses.push({ driverId: input.driverId });
    }

    if (input.vehicleId) {
      clauses.push({ vehicleId: input.vehicleId });
    }

    if (!clauses.length) {
      return;
    }

    await this.prisma.route.updateMany({
      where: {
        id: input.excludeRouteId ? { not: input.excludeRouteId } : undefined,
        status: { in: ['ACTIVE', 'PLANNED', 'RECALCULATING'] },
        OR: clauses,
      },
      data: {
        status: 'CANCELLED',
        updatedAt: new Date(),
      },
    });
  }

  async createMultistop(
    data: { name: string; startPointId: number; stopIds: number[]; vehicleId?: number; driverId?: number },
    dispatcherId?: number,
  ) {
    const allIds = [data.startPointId, ...data.stopIds];
    const points = await this.prisma.locationPoint.findMany({ where: { id: { in: allIds } } });

    const pointMap = new Map(points.map((p) => [p.id, p]));
    const start = pointMap.get(data.startPointId);
    if (!start) throw new NotFoundException('Стартовая точка не найдена');

    const remainingIds = [...data.stopIds];
    const orderedIds: number[] = [];
    let current = start;

    while (remainingIds.length > 0) {
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < remainingIds.length; i++) {
        const p = pointMap.get(remainingIds[i]);
        if (!p) continue;
        const d = calculateDistanceKm(current, p);
        if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
      }
      orderedIds.push(remainingIds[nearestIdx]);
      current = pointMap.get(remainingIds[nearestIdx])!;
      remainingIds.splice(nearestIdx, 1);
    }

    let totalDist = 0;
    let prev = start;
    for (const sid of orderedIds) {
      const p = pointMap.get(sid)!;
      totalDist += calculateDistanceKm(prev, p);
      prev = p;
    }
    const estimatedTimeMin = Math.round((totalDist / 58) * 60);

    const multistop = await this.prisma.multistopRoute.create({
      data: {
        name: data.name,
        totalDistance: Number(totalDist.toFixed(1)),
        estimatedTime: estimatedTimeMin,
        vehicleId: data.vehicleId,
        driverId: data.driverId,
        dispatcherId,
        stops: {
          create: orderedIds.map((id, idx) => ({
            locationPointId: id,
            stopOrder: idx + 1,
          })),
        },
      },
      include: { stops: { include: { locationPoint: true }, orderBy: { stopOrder: 'asc' } } },
    });

    return multistop;
  }

  async listMultistop() {
    return this.prisma.multistopRoute.findMany({
      include: { stops: { include: { locationPoint: true }, orderBy: { stopOrder: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getMlEta(routeId: number) {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      include: { startPoint: true, endPoint: true },
    });
    if (!route) throw new NotFoundException('Маршрут не найден');

    try {
      const res = await firstValueFrom(
        this.http.post(`${this.aiUrl}/eta-predict`, {
          distance_km: route.distance ?? 100,
          hour_of_day: new Date().getHours(),
          day_of_week: new Date().getDay(),
          weather_score: (route.riskFactors as any)?.weather ?? 0.2,
          news_score: (route.riskFactors as any)?.news ?? 0.2,
          risk_score: route.riskScore ?? 0.3,
        }, { timeout: 5000 }),
      );

      const mlEta = res.data?.predicted_minutes ?? route.estimatedTime;

      await this.prisma.route.update({ where: { id: routeId }, data: { mlEta } });

      return {
        routeId,
        staticEta: route.estimatedTime,
        mlEta,
        confidence: res.data?.confidence ?? 0.7,
        factors: res.data?.factors ?? {},
      };
    } catch {
      return {
        routeId,
        staticEta: route.estimatedTime,
        mlEta: route.estimatedTime,
        confidence: 0.5,
        factors: { fallback: true },
      };
    }
  }

  async getDigitalTwin(routeId: number) {
    const route = await this.prisma.route.findUnique({
      where: { id: routeId },
      include: {
        startPoint: true,
        endPoint: true,
        gpsLogs: { orderBy: { timestamp: 'asc' }, take: 500 },
      },
    });
    if (!route) throw new NotFoundException('Маршрут не найден');

    const waypoints = Array.isArray(route.waypoints) ? route.waypoints : [];

    return {
      routeId,
      name: route.name,
      status: route.status,
      startPoint: route.startPoint,
      endPoint: route.endPoint,
      waypoints,
      track: route.gpsLogs,
      estimatedTime: route.estimatedTime,
      mlEta: route.mlEta,
      distance: route.distance,
      riskScore: route.riskScore,
    };
  }

  // ── Capacity helpers ─────────────────────────────────────────────────────

  private async getVehicleCurrentLoad(vehicleId: number): Promise<{ weightKg: number; volumeCbm: number }> {
    const active = await this.prisma.route.findMany({
      where: { vehicleId, status: { in: ['ACTIVE', 'PLANNED'] } },
      select: { cargoWeightKg: true, cargoVolumeCbm: true },
    });
    return {
      weightKg: active.reduce((s, r) => s + ((r as any).cargoWeightKg ?? 0), 0),
      volumeCbm: active.reduce((s, r) => s + ((r as any).cargoVolumeCbm ?? 0), 0),
    };
  }

  // ── En-route pickup detection ────────────────────────────────────────────

  async findEnRouteDrivers(routeId: number) {
    const target = await this.prisma.route.findUnique({
      where: { id: routeId },
      include: { startPoint: true },
    });
    if (!target || !target.startPoint) throw new NotFoundException('Маршрут не найден');

    const pickup = { lat: target.startPoint.lat, lon: target.startPoint.lon };

    const activeRoutes = await this.prisma.route.findMany({
      where: { status: 'ACTIVE', id: { not: routeId } },
      include: {
        vehicle: true,
        driver: {
          include: {
            user: { select: { name: true } },
            vehicle: { include: { gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 } } },
          },
        },
      },
    });

    const candidates: Array<{
      driverId: number;
      driverName: string;
      routeId: number;
      routeName: string;
      vehiclePlate: string;
      distanceToPickup: number;
      remainingWeightKg: number;
      remainingVolumeCbm: number;
      fits: boolean;
      detourRequired: boolean;
    }> = [];

    for (const route of activeRoutes) {
      if (!route.driver || !route.vehicle) continue;

      // Find minimum distance from any waypoint (or GPS position) to pickup point
      const waypoints: Array<{ lat: number; lon: number }> = Array.isArray(route.waypoints)
        ? (route.waypoints as any[]).filter((w) => w?.lat != null && w?.lon != null)
        : [];

      let minDist = Infinity;
      for (const wp of waypoints) {
        const d = calculateDistanceKm(wp, pickup);
        if (d < minDist) minDist = d;
      }

      // Also consider driver's current GPS position
      const gps = route.driver.vehicle?.gpsLogs?.[0];
      if (gps) {
        const d = calculateDistanceKm({ lat: gps.lat, lon: gps.lon }, pickup);
        if (d < minDist) minDist = d;
      }

      // Check start/end points of active route as fallback
      if (route.startLat && route.startLon) {
        const d = calculateDistanceKm({ lat: route.startLat, lon: route.startLon }, pickup);
        if (d < minDist) minDist = d;
      }

      // Only consider if pickup is within 80km of the route path
      if (minDist > 80) continue;

      // Capacity check
      const load = await this.getVehicleCurrentLoad(route.vehicleId!);
      const veh = await this.prisma.vehicle.findUnique({ where: { id: route.vehicleId! } });
      if (!veh) continue;
      const maxW = (veh as any).maxWeightKg ?? 3500;
      const maxV = (veh as any).maxVolumeCbm ?? 20;
      const remainW = maxW - load.weightKg;
      const remainV = maxV - load.volumeCbm;

      const needW = (target as any).cargoWeightKg ?? 0;
      const needV = (target as any).cargoVolumeCbm ?? 0;
      const fits = remainW >= needW && remainV >= needV;

      candidates.push({
        driverId: route.driver.id,
        driverName: route.driver.user.name,
        routeId: route.id,
        routeName: route.name,
        vehiclePlate: veh.plateNumber,
        distanceToPickup: Number(minDist.toFixed(1)),
        remainingWeightKg: Number(remainW.toFixed(0)),
        remainingVolumeCbm: Number(remainV.toFixed(1)),
        fits,
        detourRequired: minDist > 5,
      });
    }

    return candidates.sort((a, b) => a.distanceToPickup - b.distanceToPickup);
  }

  // ── Feature 2: Hub-and-spoke ────────────────────────────────────────────────
  async suggestHub(startLat: number, startLon: number, endLat: number, endLon: number) {
    const HUBS = [
      { name: 'Москва', lat: 55.7558, lon: 37.6173 },
      { name: 'Санкт-Петербург', lat: 59.9311, lon: 30.3609 },
      { name: 'Екатеринбург', lat: 56.8519, lon: 60.6122 },
      { name: 'Новосибирск', lat: 54.9885, lon: 82.9207 },
      { name: 'Казань', lat: 55.7887, lon: 49.1222 },
      { name: 'Нижний Новгород', lat: 56.3269, lon: 44.0059 },
      { name: 'Самара', lat: 53.1959, lon: 50.1525 },
      { name: 'Омск', lat: 54.9885, lon: 73.3242 },
      { name: 'Красноярск', lat: 56.0153, lon: 92.8932 },
      { name: 'Иркутск', lat: 52.2855, lon: 104.289 },
      { name: 'Хабаровск', lat: 48.4802, lon: 135.0719 },
      { name: 'Владивосток', lat: 43.1332, lon: 131.9113 },
      { name: 'Уфа', lat: 54.7388, lon: 55.9721 },
      { name: 'Ростов-на-Дону', lat: 47.2357, lon: 39.7015 },
      { name: 'Пермь', lat: 58.0105, lon: 56.2502 },
      { name: 'Тюмень', lat: 57.1553, lon: 65.5343 },
      { name: 'Челябинск', lat: 55.1644, lon: 61.4368 },
      { name: 'Краснодар', lat: 45.036, lon: 38.976 },
      { name: 'Барнаул', lat: 53.3547, lon: 83.7697 },
      { name: 'Чита', lat: 52.0336, lon: 113.4993 },
      { name: 'Воронеж', lat: 51.6755, lon: 39.2088 },
    ];

    const directDist = calculateDistanceKm({ lat: startLat, lon: startLon }, { lat: endLat, lon: endLon });
    if (directDist < 800) {
      return { needsHub: false, directDistanceKm: Math.round(directDist), candidates: [] };
    }

    const candidates = HUBS.map((hub) => {
      const d1 = calculateDistanceKm({ lat: startLat, lon: startLon }, hub);
      const d2 = calculateDistanceKm(hub, { lat: endLat, lon: endLon });
      if (d1 < 80 || d2 < 80) return null;
      const totalVia = d1 + d2;
      const deviation = totalVia - directDist;
      if (deviation / directDist > 0.55) return null;
      const score = 1 - (deviation / directDist) * 0.8;
      return {
        name: hub.name,
        lat: hub.lat,
        lon: hub.lon,
        distanceToHub: Math.round(d1),
        distanceFromHub: Math.round(d2),
        totalDistanceKm: Math.round(totalVia),
        deviationKm: Math.round(deviation),
        score: Number(score.toFixed(3)),
        shiftFeasible: d1 <= 720 && d2 <= 720,
      };
    }).filter(Boolean) as any[];

    candidates.sort((a, b) => b.score - a.score);

    return {
      needsHub: true,
      directDistanceKm: Math.round(directDist),
      candidates: candidates.slice(0, 3),
    };
  }

  // ── Feature 3: Cargo Consolidation ──────────────────────────────────────────
  async getConsolidationCandidates(params: {
    startLat: number;
    startLon: number;
    endLat: number;
    endLon: number;
    cargoWeightKg?: number;
    cargoVolumeCbm?: number;
  }) {
    const routes = await this.prisma.route.findMany({
      where: { status: 'PLANNED', vehicleId: { not: null } },
      include: { vehicle: true, startPoint: true, endPoint: true },
    });

    const dBearing = Math.atan2(
      params.endLon - params.startLon,
      params.endLat - params.startLat,
    ) * (180 / Math.PI);

    const candidates = routes.map((route) => {
      if (!route.vehicle || !route.startPoint || !route.endPoint) return null;

      const rBearing = Math.atan2(
        route.endLon - route.startLon,
        route.endLat - route.startLat,
      ) * (180 / Math.PI);
      const bearingDiff = Math.abs(((dBearing - rBearing + 180) % 360) - 180);
      if (bearingDiff > 50) return null;

      const departureDist = calculateDistanceKm(
        { lat: params.startLat, lon: params.startLon },
        { lat: route.startLat, lon: route.startLon },
      );
      if (departureDist > 350) return null;

      const maxW = (route.vehicle as any).maxWeightKg ?? 3500;
      const maxV = (route.vehicle as any).maxVolumeCbm ?? 20;
      const usedW = (route as any).cargoWeightKg ?? 0;
      const usedV = (route as any).cargoVolumeCbm ?? 0;
      const remW = maxW - usedW;
      const remV = maxV - usedV;
      const fits =
        (!params.cargoWeightKg || remW >= params.cargoWeightKg) &&
        (!params.cargoVolumeCbm || remV >= params.cargoVolumeCbm);

      return {
        routeId: route.id,
        routeName: route.name,
        vehiclePlate: route.vehicle.plateNumber,
        vehicleModel: route.vehicle.model,
        departureDist: Math.round(departureDist),
        bearingDiff: Math.round(bearingDiff),
        remainingWeightKg: Math.round(remW),
        remainingVolumeCbm: Number(remV.toFixed(1)),
        fits,
        startCity: route.startPoint.city,
        endCity: route.endPoint.city,
      };
    }).filter(Boolean) as any[];

    candidates.sort((a, b) => a.departureDist - b.departureDist);
    return candidates.slice(0, 10);
  }

  // ── Feature 4: Driver Zones (simplified Voronoi) ─────────────────────────────
  async getDriverZones() {
    const drivers = await this.prisma.driverProfile.findMany({
      where: { status: { in: ['ON_SHIFT', 'RESTING'] } },
      include: {
        user: { select: { name: true } },
        vehicle: {
          include: { gpsLogs: { orderBy: { timestamp: 'desc' }, take: 1 } },
        },
      },
    });

    const zones = drivers
      .map((d) => {
        const gps = d.vehicle?.gpsLogs?.[0];
        if (!gps) return null;
        return {
          driverId: d.id,
          driverName: d.user.name,
          status: d.status,
          center: { lat: gps.lat, lon: gps.lon },
          radiusKm: 200,
          vehiclePlate: d.vehicle?.plateNumber ?? null,
        };
      })
      .filter(Boolean);

    return { zones, total: zones.length };
  }

  // ── Feature 5: Historical Bottlenecks ────────────────────────────────────────
  async getBottlenecks() {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const slowPoints = await this.prisma.gpsLog.findMany({
      where: { timestamp: { gte: since }, speed: { not: null, lt: 35 } },
      select: { lat: true, lon: true, speed: true },
      take: 8000,
    });

    if (!slowPoints.length) return [];

    const grid: Record<string, { lat: number; lon: number; count: number; totalSpeed: number }> = {};
    for (const p of slowPoints) {
      const gLat = Math.round(p.lat * 25) / 25;
      const gLon = Math.round(p.lon * 25) / 25;
      const key = `${gLat},${gLon}`;
      if (!grid[key]) grid[key] = { lat: gLat, lon: gLon, count: 0, totalSpeed: 0 };
      grid[key].count++;
      grid[key].totalSpeed += p.speed ?? 0;
    }

    return Object.values(grid)
      .filter((c) => c.count >= 2)
      .map((c) => ({
        lat: c.lat,
        lon: c.lon,
        count: c.count,
        avgSpeedKmh: Math.round(c.totalSpeed / c.count),
        intensity: Math.min(1, c.count / 15),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 250);
  }

  // ── Feature 6: Predictive Departure Risk ─────────────────────────────────────
  async getDepartureRisk(startLat: number, startLon: number, endLat: number, endLon: number) {
    const now = new Date();
    const hour = now.getHours();
    const dow = now.getDay();

    const rushHours = [7, 8, 9, 17, 18, 19, 20];
    const todRisk = rushHours.includes(hour) ? 0.7 : hour < 6 || hour > 22 ? 0.4 : 0.2;
    const dowRisk = dow === 5 ? 0.7 : dow === 1 ? 0.6 : [0, 6].includes(dow) ? 0.2 : 0.35;
    const distKm = calculateDistanceKm({ lat: startLat, lon: startLon }, { lat: endLat, lon: endLon });
    const distRisk = Math.min(0.8, distKm / 5000);

    const bbox = 3;
    const historical = await this.prisma.route.findMany({
      where: {
        startLat: { gte: startLat - bbox, lte: startLat + bbox },
        startLon: { gte: startLon - bbox, lte: startLon + bbox },
        status: { in: ['COMPLETED', 'CANCELLED'] },
      },
      select: { status: true },
      take: 100,
    });
    const total = historical.length;
    const cancelled = historical.filter((r) => r.status === 'CANCELLED').length;
    const historicalRisk = total > 3 ? cancelled / total : 0.15;

    let weatherRisk = 0.15;
    try {
      weatherRisk = await this.fetchWeatherRisk({ lat: startLat, lon: startLon });
    } catch {}

    const combined = todRisk * 0.25 + dowRisk * 0.2 + distRisk * 0.15 + historicalRisk * 0.25 + weatherRisk * 0.15;
    const risk = Number(Math.min(1, combined).toFixed(3));

    return {
      risk,
      probability: Math.round(risk * 100),
      level: risk > 0.6 ? 'high' : risk > 0.35 ? 'medium' : 'low',
      distanceKm: Math.round(distKm),
      factors: {
        timeOfDay: { risk: Number(todRisk.toFixed(2)), label: rushHours.includes(hour) ? 'Час пик' : 'Нормальное время' },
        dayOfWeek: { risk: Number(dowRisk.toFixed(2)), label: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][dow] },
        distance: { risk: Number(distRisk.toFixed(2)), label: `${Math.round(distKm)} км` },
        historical: { risk: Number(historicalRisk.toFixed(2)), label: total > 3 ? `${cancelled}/${total} отменено` : 'Мало данных' },
        weather: { risk: Number(weatherRisk.toFixed(2)), label: 'Текущая погода' },
      },
    };
  }

  private normalizeDriverNewsSource(item: any) {
    const url = String(item?.url ?? '').toLowerCase();
    const channel = String(item?.channel ?? '').toLowerCase();
    const source = String(item?.source ?? '').toLowerCase();
    const sourceId = String(item?.source_id ?? item?.sourceId ?? '').toLowerCase();
    const haystack = `${url} ${channel} ${source} ${sourceId}`;

    if (haystack.includes('t.me')) return 'TELEGRAM' as const;
    if (haystack.includes('vk.com')) return 'VK' as const;
    if (haystack.includes('max.ru')) return 'MAX' as const;
    if (sourceId.includes('telegram')) return 'TELEGRAM' as const;
    if (sourceId.includes('vk')) return 'VK' as const;
    if (sourceId.includes('max')) return 'MAX' as const;

    const normalized = String(item?.source ?? '')
      .toUpperCase()
      .trim();

    if (normalized === 'TELEGRAM') return 'TELEGRAM' as const;
    if (normalized === 'VK') return 'VK' as const;
    if (normalized === 'MAX') return 'MAX' as const;
    return 'INTERNAL' as const;
  }
}
