type Coordinates = {
  lat: number;
  lon: number;
};

type NewsSeedInput = {
  startName: string;
  startCity: string;
  endName: string;
  endCity: string;
  publishedAtBase?: Date;
};

export function calculateDistanceKm(start: Coordinates, end: Coordinates) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(end.lat - start.lat);
  const dLon = toRadians(end.lon - start.lon);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(start.lat)) *
      Math.cos(toRadians(end.lat)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusKm * c * 10) / 10;
}

export function buildRouteWaypoints(start: Coordinates, end: Coordinates) {
  const latShift = start.lat <= end.lat ? 0.16 : -0.16;
  const lonShift = start.lon <= end.lon ? 0.22 : -0.22;

  return [
    {
      lat: start.lat + (end.lat - start.lat) * 0.32 + latShift,
      lon: start.lon + (end.lon - start.lon) * 0.24,
    },
    {
      lat: start.lat + (end.lat - start.lat) * 0.68,
      lon: start.lon + (end.lon - start.lon) * 0.72 + lonShift,
    },
  ];
}

export function buildMockTrack(
  start: Coordinates,
  end: Coordinates,
  steps = 9,
) {
  return Array.from({ length: steps }).map((_, index) => {
    const progress = steps === 1 ? 1 : index / (steps - 1);
    const bend = Math.sin(progress * Math.PI) * 0.18;
    const lat = start.lat + (end.lat - start.lat) * progress + bend;
    const lon = start.lon + (end.lon - start.lon) * progress - bend * 0.65;

    return {
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      speed: 48 + ((index + 3) % 4) * 7,
      timestamp: new Date(Date.now() - (steps - index) * 12 * 60 * 1000),
    };
  });
}

export function buildDriverNewsSeed(input: NewsSeedInput) {
  const base = input.publishedAtBase ?? new Date();

  return [
    {
      source: 'TELEGRAM' as const,
      channel: '@logistics_alerts',
      title: `Дорожные работы около ${input.endCity}`,
      summary: `Telegram-паблик сообщил о сужении полосы на подъезде к точке ${input.endName}. ETA стоит пересматривать с запасом 15-20 минут.`,
      severity: 0.56,
      city: input.endCity,
      publishedAt: new Date(base.getTime() - 35 * 60 * 1000),
      url: 'https://t.me/logistics_alerts',
    },
    {
      source: 'VK' as const,
      channel: 'vk.com/route_watch',
      title: `Пробка на участке ${input.startCity} -> ${input.endCity}`,
      summary: `VK-сообщество перевозчиков обсуждает плотный поток на магистрали между ${input.startName} и ${input.endName}.`,
      severity: 0.48,
      city: input.endCity,
      publishedAt: new Date(base.getTime() - 75 * 60 * 1000),
      url: 'https://vk.com/route_watch',
    },
    {
      source: 'MAX' as const,
      channel: 'MAX / Логистика',
      title: `Погрузка на точке ${input.endName} идёт по усиленному регламенту`,
      summary: `В MAX-канале опубликовано сообщение о дополнительной проверке документов и возможной очереди у разгрузки.`,
      severity: 0.36,
      city: input.endCity,
      publishedAt: new Date(base.getTime() - 120 * 60 * 1000),
      url: 'https://max.ru',
    },
  ];
}
