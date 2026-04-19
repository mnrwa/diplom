import { calculateDistanceKm } from '../demo/demo.utils';

export type Coordinates = {
  lat: number;
  lon: number;
};

export type RouteWaypoint = {
  lat: number;
  lon: number;
};

export type TrackPoint = {
  lat: number;
  lon: number;
  speed: number;
  timestamp: Date;
};

export type RiskEventLike = {
  id: number;
  type: string;
  title: string;
  severity: number;
  source?: string;
  lat?: number | null;
  lon?: number | null;
};

export type RouteAlternative = {
  rank: number;
  geometry: [number, number][];
  distanceKm: number;
  durationMin: number;
  avgSpeedKph: number;
  trafficPenalty: number;
  eventExposure: number;
  eventMatches: Array<{
    id: number;
    title: string;
    type: string;
    severity: number;
    distanceKm: number;
  }>;
  routeWeight: number;
};

export function serializeRouteGeometry(
  geometry: [number, number][],
  maxPoints = 320,
): RouteWaypoint[] {
  return simplifyGeometry(geometry, maxPoints).map(([lon, lat]) => ({
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
  }));
}

export function geometryToWaypoints(
  geometry: [number, number][],
  maxPoints = 72,
): RouteWaypoint[] {
  const simplified = simplifyGeometry(geometry, maxPoints + 2);

  if (simplified.length <= 2) {
    return [];
  }

  const interior = simplified.slice(1, -1);
  if (interior.length <= maxPoints) {
    return interior.map(([lon, lat]) => ({ lat, lon }));
  }

  const sampled: RouteWaypoint[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const ratio = maxPoints === 1 ? 0 : index / (maxPoints - 1);
    const sourceIndex = Math.round(ratio * (interior.length - 1));
    const [lon, lat] = interior[sourceIndex];
    sampled.push({ lat, lon });
  }

  return sampled;
}

export function buildTrackFromGeometry(
  geometry: [number, number][],
  speedSamples: number[] = [],
  steps = 9,
): TrackPoint[] {
  if (!geometry.length) {
    return [];
  }

  const length = geometry.length;

  return Array.from({ length: Math.max(steps, 2) }).map((_, index) => {
    const progress = steps <= 1 ? 1 : index / (steps - 1);
    const coordinateIndex = Math.min(
      length - 1,
      Math.round(progress * (length - 1)),
    );
    const [lon, lat] = geometry[coordinateIndex];
    const speedIndex = Math.min(
      Math.max(speedSamples.length - 1, 0),
      Math.round(progress * Math.max(speedSamples.length - 1, 0)),
    );
    const sourceSpeed = speedSamples[speedIndex];
    const speed =
      typeof sourceSpeed === 'number' && Number.isFinite(sourceSpeed)
        ? Math.max(18, Math.round(sourceSpeed * 3.6))
        : 44 + ((index + 2) % 4) * 8;

    return {
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      speed,
      timestamp: new Date(Date.now() - (steps - index) * 12 * 60 * 1000),
    };
  });
}

export function extractSpeedSamples(route: any): number[] {
  const rawSamples =
    route?.legs?.flatMap((leg: any) => leg?.annotation?.speed ?? []) ?? [];

  return rawSamples.filter(
    (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value > 0,
  );
}

export function getRouteMidpoint(
  geometry: [number, number][],
  fallbackStart: Coordinates,
  fallbackEnd: Coordinates,
): Coordinates {
  if (!geometry.length) {
    return {
      lat: Number(((fallbackStart.lat + fallbackEnd.lat) / 2).toFixed(5)),
      lon: Number(((fallbackStart.lon + fallbackEnd.lon) / 2).toFixed(5)),
    };
  }

  const midpoint = geometry[Math.floor(geometry.length / 2)];
  return {
    lat: Number(midpoint[1].toFixed(5)),
    lon: Number(midpoint[0].toFixed(5)),
  };
}

export function pickShortestRoadAlternative(
  alternatives: RouteAlternative[],
): RouteAlternative | null {
  if (!alternatives.length) {
    return null;
  }

  return [...alternatives].sort((left, right) => {
    if (left.distanceKm !== right.distanceKm) {
      return left.distanceKm - right.distanceKm;
    }

    if (left.durationMin !== right.durationMin) {
      return left.durationMin - right.durationMin;
    }

    return left.routeWeight - right.routeWeight;
  })[0];
}

/**
 * Базовый штраф за плохую скорость потока.
 * Чем ниже средняя скорость — тем выше вес пробок.
 */
export function calculateTrafficPenalty(avgSpeedKph: number) {
  if (avgSpeedKph >= 72) return 0.08;
  if (avgSpeedKph >= 58) return 0.18;
  if (avgSpeedKph >= 46) return 0.34;
  if (avgSpeedKph >= 34) return 0.52;
  return 0.72;
}

/**
 * Мультипликатор пробок в зависимости от времени суток.
 * Пиковые часы: 07-10 и 17-20 (типичная городская нагрузка РФ).
 * Вечерний час-пик обычно хуже утреннего.
 */
export function getTimeOfDayTrafficMultiplier(hourUtc?: number): number {
  const hour = hourUtc ?? new Date().getHours(); // local server hour
  // Morning rush: 07:00-10:00
  if (hour >= 7 && hour < 10) return 1.45;
  // Evening rush: 17:00-20:00
  if (hour >= 17 && hour < 20) return 1.65;
  // Late evening / night — lighter traffic
  if (hour >= 22 || hour < 6) return 0.70;
  // Business hours — moderate
  return 1.0;
}

/**
 * Рассчитывает подверженность маршрута дорожным инцидентам.
 * Возвращает нормализованный score [0..1] и список совпадений.
 */
export function calculateRouteEventExposure(
  geometry: [number, number][],
  events: RiskEventLike[],
) {
  const consideredGeometry =
    geometry.length > 120
      ? geometry.filter((_, index) => index % Math.ceil(geometry.length / 120) === 0)
      : geometry;

  const matches = events
    .filter((event) => event.lat != null && event.lon != null)
    .map((event) => {
      const nearestDistanceKm = consideredGeometry.reduce((minDistance, [lon, lat]) => {
        const distance = calculateDistanceKm(
          { lat, lon },
          { lat: Number(event.lat), lon: Number(event.lon) },
        );
        return Math.min(minDistance, distance);
      }, Number.POSITIVE_INFINITY);

      return {
        id: event.id,
        title: event.title,
        type: event.type,
        severity: event.severity,
        distanceKm: Number(nearestDistanceKm.toFixed(1)),
      };
    })
    .filter((event) => event.distanceKm <= 40)
    .sort((left, right) => left.distanceKm - right.distanceKm);

  const exposure = matches.reduce((total, match) => {
    // Closer incidents have much higher impact
    const distanceWeight =
      match.distanceKm <= 3 ? 1.0
      : match.distanceKm <= 8 ? 0.85
      : match.distanceKm <= 15 ? 0.65
      : 0.35;

    const typeWeight =
      match.type === 'ACCIDENT'
        ? 1.0
        : match.type === 'ROAD_WORK'
          ? 0.88
          : match.type === 'TRAFFIC'
            ? 0.72
            : match.type === 'WEATHER'
              ? 0.66
              : 0.5;

    return total + match.severity * distanceWeight * typeWeight;
  }, 0);

  return {
    score: Number(Math.min(1, exposure).toFixed(3)),
    matches: matches.slice(0, 5),
  };
}

/**
 * Ранжирует альтернативные маршруты от OSRM.
 * Метрика: взвешенная комбинация времени, дистанции, пробок,
 * дорожных событий, новостного риска и времени суток.
 *
 * Весовые коэффициенты (сумма = 1):
 *   duration      0.40  — основной критерий эффективности
 *   eventExposure 0.22  — безопасность (инциденты рядом)
 *   traffic       0.14  — пробочный штраф (время суток учтён)
 *   distance      0.10  — дистанция (небольшой вес — короче ≠ лучше)
 *   aiRisk        0.08  — базовый AI-риск маршрута
 *   news          0.04  — новостные риски
 *   weather       0.02  — погодные условия
 */
export function rankAlternatives(
  alternatives: Array<{
    geometry: [number, number][];
    distanceKm: number;
    durationMin: number;
    avgSpeedKph: number;
    eventExposure: number;
    eventMatches: RouteAlternative['eventMatches'];
  }>,
  context: {
    weatherRisk: number;
    newsRisk: number;
    aiRiskBase: number;
    hourOfDay?: number;
  },
): RouteAlternative[] {
  const minDuration = Math.min(...alternatives.map((item) => item.durationMin));
  const minDistance = Math.min(...alternatives.map((item) => item.distanceKm));
  const todMultiplier = getTimeOfDayTrafficMultiplier(context.hourOfDay);

  return alternatives
    .map((alternative, index) => {
      const baseTrafficPenalty = calculateTrafficPenalty(alternative.avgSpeedKph);
      // Apply time-of-day multiplier — cap at 1.0
      const trafficPenalty = Number(Math.min(1, baseTrafficPenalty * todMultiplier).toFixed(3));

      const normalizedDuration =
        minDuration > 0 ? alternative.durationMin / minDuration : 1;
      const normalizedDistance =
        minDistance > 0 ? alternative.distanceKm / minDistance : 1;

      const routeWeight =
        normalizedDuration * 0.40 +
        normalizedDistance * 0.10 +
        alternative.eventExposure * 0.22 +
        trafficPenalty * 0.14 +
        context.aiRiskBase * 0.08 +
        context.newsRisk * 0.04 +
        context.weatherRisk * 0.02;

      return {
        rank: index + 1,
        geometry: alternative.geometry,
        distanceKm: alternative.distanceKm,
        durationMin: alternative.durationMin,
        avgSpeedKph: alternative.avgSpeedKph,
        trafficPenalty,
        eventExposure: alternative.eventExposure,
        eventMatches: alternative.eventMatches,
        routeWeight: Number(routeWeight.toFixed(4)),
      };
    })
    .sort((left, right) => left.routeWeight - right.routeWeight);
}

function simplifyGeometry(
  geometry: [number, number][],
  maxPoints: number,
): [number, number][] {
  if (geometry.length <= maxPoints) {
    return geometry;
  }

  let toleranceKm = 0.15;
  let simplified = douglasPeucker(geometry, toleranceKm);

  while (simplified.length > maxPoints && toleranceKm < 12) {
    toleranceKm *= 1.6;
    simplified = douglasPeucker(geometry, toleranceKm);
  }

  if (simplified.length <= maxPoints) {
    return simplified;
  }

  const sampled: [number, number][] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const ratio = maxPoints === 1 ? 0 : index / (maxPoints - 1);
    const sourceIndex = Math.round(ratio * (simplified.length - 1));
    sampled.push(simplified[sourceIndex]);
  }

  return sampled;
}

function douglasPeucker(
  geometry: [number, number][],
  toleranceKm: number,
): [number, number][] {
  if (geometry.length <= 2) {
    return geometry;
  }

  const keep = new Array<boolean>(geometry.length).fill(false);
  keep[0] = true;
  keep[geometry.length - 1] = true;

  const stack: Array<[number, number]> = [[0, geometry.length - 1]];

  while (stack.length) {
    const [startIndex, endIndex] = stack.pop()!;
    let maxDistance = 0;
    let candidateIndex = -1;

    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = perpendicularDistanceKm(
        geometry[index],
        geometry[startIndex],
        geometry[endIndex],
      );

      if (distance > maxDistance) {
        maxDistance = distance;
        candidateIndex = index;
      }
    }

    if (candidateIndex !== -1 && maxDistance > toleranceKm) {
      keep[candidateIndex] = true;
      stack.push([startIndex, candidateIndex], [candidateIndex, endIndex]);
    }
  }

  return geometry.filter((_, index) => keep[index]);
}

function perpendicularDistanceKm(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): number {
  const anchorLat = (point[1] + start[1] + end[1]) / 3;
  const p = projectToKm(point, anchorLat);
  const a = projectToKm(start, anchorLat);
  const b = projectToKm(end, anchorLat);

  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const abLengthSquared = abX * abX + abY * abY;

  if (abLengthSquared === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * abX + (p.y - a.y) * abY) / abLengthSquared),
  );
  const projectionX = a.x + abX * t;
  const projectionY = a.y + abY * t;
  return Math.hypot(p.x - projectionX, p.y - projectionY);
}

function projectToKm(point: [number, number], anchorLat: number) {
  const latFactor = 110.574;
  const lonFactor = 111.32 * Math.cos((anchorLat * Math.PI) / 180);

  return {
    x: point[0] * lonFactor,
    y: point[1] * latFactor,
  };
}
