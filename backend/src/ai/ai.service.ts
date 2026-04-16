import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';

  constructor(
    private http: HttpService,
    private prisma: PrismaService,
  ) {}

  async analyzeRisk(startLat: number, startLon: number, endLat: number, endLon: number) {
    try {
      const res = await firstValueFrom(
        this.http.post(`${this.aiUrl}/analyze-risk`, { start_lat: startLat, start_lon: startLon, end_lat: endLat, end_lon: endLon }),
      );
      return res.data;
    } catch (err) {
      this.logger.warn('AI service unavailable, returning default risk');
      return { risk_score: 0, factors: {}, recommendation: 'AI service unavailable' };
    }
  }

  async getWeatherForRoute(lat: number, lon: number) {
    try {
      const res = await firstValueFrom(
        this.http.get(`${this.aiUrl}/weather?lat=${lat}&lon=${lon}`),
      );
      return res.data;
    } catch {
      return null;
    }
  }

  async getNewsRisks(lat: number, lon: number) {
    try {
      const res = await firstValueFrom(
        this.http.get(`${this.aiUrl}/news-risks?lat=${lat}&lon=${lon}`),
      );
      return res.data;
    } catch {
      return [];
    }
  }

  async getRiskEvents() {
    return this.prisma.riskEvent.findMany({
      where: { active: true },
      orderBy: { severity: 'desc' },
    });
  }
}
