import { Injectable, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
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

    let driverId = data.driverId;
    if (!driverId && vehicle?.driverProfile?.id) {
      driverId = vehicle.driverProfile.id;
    }

    const optimized = await this.buildOptimizedRoutePlan(startPoint, endPoint);
    const shouldActivate = Boolean(driverId || data.vehicleId);

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

  async delete(id: number) {
    await this.prisma.driverNews.deleteMany({ where: { routeId: id } });
    await this.prisma.gpsLog.deleteMany({ where: { routeId: id } });
    return this.prisma.route.delete({ where: { id } });
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
        return { totalRisk: 0.2, risks: [] };
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

    const available = candidates.filter((d) => d.routes.length === 0 && d.vehicle);

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
