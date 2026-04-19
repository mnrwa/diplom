import { Controller, Get, Post, Body, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GpsService } from './gps.service';
import { GpsGateway } from './gps.gateway';

@ApiTags('gps')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('gps')
export class GpsController {
  constructor(
    private gps: GpsService,
    private gateway: GpsGateway,
  ) {}

  @Get('positions')
  @ApiOperation({ summary: 'Последние позиции всех ТС' })
  getPositions() { return this.gps.getLatestPositions(); }

  @Get('history/:vehicleId')
  @ApiOperation({ summary: 'История GPS для ТС' })
  getHistory(@Param('vehicleId', ParseIntPipe) vehicleId: number) {
    return this.gps.getHistory(vehicleId);
  }

  @Get('heatmap')
  @ApiOperation({ summary: 'Тепловая карта GPS (агрегация по ячейкам)' })
  getHeatmap(@Query('limit') limit?: string) {
    return this.gps.getHeatmap(limit ? parseInt(limit) : 5000);
  }

  @Get('geofence-events')
  @ApiOperation({ summary: 'События геофенсинга' })
  getGeofenceEvents(@Query('routeId') routeId?: string) {
    return this.gps.getGeofenceEvents(routeId ? parseInt(routeId) : undefined);
  }

  @Post('location')
  @ApiOperation({ summary: 'Сохранить GPS координату (реальное время)' })
  async saveLocation(@Body() body: { vehicleId: number; lat: number; lon: number; speed?: number; routeId?: number }) {
    const log = await this.gps.saveLocation(body.vehicleId, body.lat, body.lon, body.speed, body.routeId);
    this.gateway.broadcastLocation({ ...log, vehicleId: body.vehicleId });
    return log;
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Загрузить оффлайн-буфер координат' })
  saveBulk(@Body() body: { vehicleId: number; locations: any[] }) {
    return this.gps.saveBulk(body.vehicleId, body.locations);
  }
}
