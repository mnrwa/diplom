import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService } from './ai.service';

@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private ai: AiService) {}

  @Post('analyze-risk')
  @ApiOperation({ summary: 'Анализ риска маршрута (проксирует к AI сервису)' })
  analyzeRisk(@Body() body: { startLat: number; startLon: number; endLat: number; endLon: number }) {
    return this.ai.analyzeRisk(body.startLat, body.startLon, body.endLat, body.endLon);
  }

  @Get('weather')
  @ApiOperation({ summary: 'Погода для координат' })
  weather(@Query('lat') lat: string, @Query('lon') lon: string) {
    return this.ai.getWeatherForRoute(parseFloat(lat), parseFloat(lon));
  }

  @Get('news-risks')
  @ApiOperation({ summary: 'Новостные риски по координатам' })
  newsRisks(@Query('lat') lat: string, @Query('lon') lon: string) {
    return this.ai.getNewsRisks(parseFloat(lat), parseFloat(lon));
  }

  @Get('risk-events')
  @ApiOperation({ summary: 'Активные события риска' })
  riskEvents() { return this.ai.getRiskEvents(); }
}
