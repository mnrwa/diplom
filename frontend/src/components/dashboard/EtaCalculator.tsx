"use client";

import { useState } from "react";
import { Clock, Gauge, MapPin, Navigation, CloudRain, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { geocodeAddress, getAiEta, getAiWeather, type AiEtaResult } from "@/lib/api";

const OSRM = "https://router.project-osrm.org";

async function osrmDistance(fromLat: number, fromLon: number, toLat: number, toLon: number): Promise<number> {
  const url = `${OSRM}/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=false`;
  const r = await fetch(url);
  const data = await r.json();
  const meters = data.routes?.[0]?.distance ?? 0;
  return meters / 1000;
}

type Result = {
  from: string;
  to: string;
  distanceKm: number;
  eta: AiEtaResult;
  weather: { description: string; temperature: number; wind_speed: number; risk_score: number; demo?: boolean };
};

const factorLabel: Record<string, string> = {
  tod_factor: "Время суток",
  dow_factor: "День недели",
  weather_factor: "Погода",
  news_factor: "Дорожные события",
  risk_factor: "Общий риск",
};

function factorColor(val: number) {
  if (val >= 1.0) return "text-emerald-600";
  if (val >= 0.85) return "text-amber-500";
  return "text-rose-500";
}

function fmtMinutes(min: number) {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

export function EtaCalculator() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const calculate = async () => {
    if (!from.trim() || !to.trim()) {
      setError("Введите оба города");
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);

    try {
      const [fromGeos, toGeos] = await Promise.all([
        geocodeAddress(from),
        geocodeAddress(to),
      ]);

      if (!fromGeos.length) throw new Error(`Не найдено: "${from}"`);
      if (!toGeos.length) throw new Error(`Не найдено: "${to}"`);

      const origin = fromGeos[0];
      const dest = toGeos[0];

      const [distanceKm, weather] = await Promise.all([
        osrmDistance(origin.lat, origin.lon, dest.lat, dest.lon),
        getAiWeather(origin.lat, origin.lon),
      ]);

      const eta = await getAiEta({
        distance_km: distanceKm,
        weather_score: weather.risk_score ?? 0.1,
        risk_score: 0.2,
      });

      setResult({
        from: origin.displayName.split(",")[0],
        to: dest.displayName.split(",")[0],
        distanceKm: Math.round(distanceKm),
        eta,
        weather,
      });
    } catch (e: any) {
      setError(e.message ?? "Ошибка расчёта");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-[28px] border border-sand bg-white p-6">
      <p className="text-xs uppercase tracking-[0.32em] text-warmsilver">OSRM · Погода · Дороги</p>
      <h2 className="mt-2 text-2xl font-semibold text-plum">Расчёт времени доставки</h2>
      <p className="mt-1 text-sm text-olive">Учитываются: дорожная сеть, время суток, погода и дорожные события</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs uppercase tracking-widest text-warmsilver">Откуда</Label>
          <Input
            className="mt-1.5"
            placeholder="Москва"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && calculate()}
          />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-widest text-warmsilver">Куда</Label>
          <Input
            className="mt-1.5"
            placeholder="Казань"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && calculate()}
          />
        </div>
      </div>

      <Button
        className="mt-4 w-full gap-2 bg-plum text-white hover:bg-plum/90"
        onClick={calculate}
        disabled={loading}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
        {loading ? "Рассчитываем..." : "Рассчитать"}
      </Button>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className="mt-5 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-plum to-purple-700 px-5 py-4 text-white">
            <div>
              <p className="text-xs uppercase tracking-widest opacity-70">Маршрут</p>
              <p className="mt-0.5 font-semibold">{result.from} → {result.to}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-widest opacity-70">Расстояние</p>
              <p className="mt-0.5 font-bold text-xl">{result.distanceKm} км</p>
            </div>
          </div>

          {/* ETA main */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-center">
              <Clock className="mx-auto h-5 w-5 text-emerald-600" />
              <p className="mt-2 text-2xl font-bold text-emerald-700">{fmtMinutes(result.eta.predicted_minutes)}</p>
              <p className="mt-0.5 text-xs text-emerald-600">Расчётное время</p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-4 text-center">
              <Gauge className="mx-auto h-5 w-5 text-sky-600" />
              <p className="mt-2 text-2xl font-bold text-sky-700">{result.eta.factors.adjusted_speed_kmh} км/ч</p>
              <p className="mt-0.5 text-xs text-sky-600">Средняя скорость</p>
            </div>
          </div>

          {/* Weather */}
          <div className="flex items-center gap-3 rounded-2xl border border-sand bg-fog px-4 py-3 text-sm">
            <CloudRain className="h-4 w-4 shrink-0 text-sky-500" />
            <div className="flex-1">
              <span className="font-medium text-plum">{result.weather.description}</span>
              <span className="ml-2 text-olive">
                {result.weather.temperature != null ? `${Math.round(result.weather.temperature)}°C` : ""}
                {result.weather.wind_speed != null ? ` · ветер ${result.weather.wind_speed} м/с` : ""}
              </span>
            </div>
            {result.weather.demo && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">демо</span>
            )}
          </div>

          {/* Factors */}
          <div className="rounded-2xl border border-sand p-4">
            <p className="mb-3 text-xs uppercase tracking-widest text-warmsilver">Факторы влияния</p>
            <div className="space-y-2">
              {Object.entries(result.eta.factors)
                .filter(([k]) => k.endsWith("_factor"))
                .map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="text-olive">{factorLabel[key] ?? key}</span>
                    <span className={`font-semibold ${factorColor(val as number)}`}>
                      {((val as number) * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
            </div>
          </div>

          {/* Confidence */}
          <div className="flex items-center gap-2 rounded-2xl border border-sand bg-fog px-4 py-3 text-sm">
            <MapPin className="h-4 w-4 text-warmsilver" />
            <span className="text-olive">Уверенность модели:</span>
            <span className="font-semibold text-plum">{Math.round(result.eta.confidence * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
