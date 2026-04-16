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

export function geometryToWaypoints(
  geometry: [number, number][],
  maxPoints = 72,
): RouteWaypoint[] {
  if (geometry.length <= 2) {
    return [];
  }

  const interior = geometry.slice(1, -1);
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

export function calculateTrafficPenalty(avgSpeedKph: number) {
  if (avgSpeedKph >= 72) return 0.08;
  if (avgSpeedKph >= 58) return 0.18;
  if (avgSpeedKph >= 46) return 0.34;
  if (avgSpeedKph >= 34) return 0.52;
  return 0.72;
}

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
    const distanceWeight =
      match.distanceKm <= 6 ? 1 : match.distanceKm <= 15 ? 0.65 : 0.35;
    const typeWeight =
      match.type === 'ACCIDENT'
        ? 1
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
  },
): RouteAlternative[] {
  const minDuration = Math.min(...alternatives.map((item) => item.durationMin));
  const minDistance = Math.min(...alternatives.map((item) => item.distanceKm));

  return alternatives
    .map((alternative, index) => {
      const trafficPenalty = calculateTrafficPenalty(alternative.avgSpeedKph);
      const normalizedDuration =
        minDuration > 0 ? alternative.durationMin / minDuration : 1;
      const normalizedDistance =
        minDistance > 0 ? alternative.distanceKm / minDistance : 1;
      const routeWeight =
        normalizedDuration * 0.5 +
        normalizedDistance * 0.14 +
        alternative.eventExposure * 0.2 +
        trafficPenalty * 0.1 +
        context.weatherRisk * 0.03 +
        context.newsRisk * 0.03 +
        context.aiRiskBase * 0.12;

      return {
        rank: index + 1,
        geometry: alternative.geometry,
        distanceKm: alternative.distanceKm,
        durationMin: alternative.durationMin,
        avgSpeedKph: alternative.avgSpeedKph,
        trafficPenalty: Number(trafficPenalty.toFixed(3)),
        eventExposure: alternative.eventExposure,
        eventMatches: alternative.eventMatches,
        routeWeight: Number(routeWeight.toFixed(4)),
      };
    })
    .sort((left, right) => left.routeWeight - right.routeWeight);
}
