import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoutesService } from './routes.service';

export class CreateRouteDto {
  @IsString()
  name: string;

  @IsInt()
  startPointId: number;

  @IsInt()
  endPointId: number;

  @IsOptional()
  @IsInt()
  vehicleId?: number;

  @IsOptional()
  @IsInt()
  driverId?: number;

  @IsOptional()
  @IsString()
  telegramChatId?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  cargoWeightKg?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  cargoVolumeCbm?: number;
}

export class CreateQuickRouteDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsNumber()
  startLat: number;

  @IsNumber()
  startLon: number;

  @IsString()
  startName: string;

  @IsString()
  startCity: string;

  @IsString()
  startAddress: string;

  @IsNumber()
  endLat: number;

  @IsNumber()
  endLon: number;

  @IsString()
  endName: string;

  @IsString()
  endCity: string;

  @IsString()
  endAddress: string;

  @IsOptional()
  @IsInt()
  vehicleId?: number;

  @IsOptional()
  @IsInt()
  driverId?: number;

  @IsOptional()
  @IsString()
  telegramChatId?: string;
}

@ApiTags('routes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('routes')
export class RoutesController {
  constructor(private routes: RoutesService) {}

  @Get()
  @ApiOperation({ summary: 'Все маршруты' })
  findAll() {
    return this.routes.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Маршрут по ID' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.routes.findOne(id);
  }

  @Get(':id/geometry')
  @ApiOperation({ summary: 'OSRM геометрия маршрута как [[lon, lat], ...]' })
  getGeometry(@Param('id', ParseIntPipe) id: number) {
    return this.routes.getGeometry(id);
  }

  @Post()
  @ApiOperation({ summary: 'Создать маршрут от склада до ПВЗ' })
  create(
    @Body() dto: CreateRouteDto,
    @Req() req: { user: { id: number } },
  ) {
    return this.routes.create(dto, req.user.id);
  }

  @Post('quick')
  @ApiOperation({ summary: 'Создать маршрут по координатам' })
  createQuick(
    @Body() dto: CreateQuickRouteDto,
    @Req() req: { user: { id: number } },
  ) {
    return this.routes.createQuick(dto, req.user.id);
  }

  @Post('multistop')
  @ApiOperation({ summary: 'Мультистоп маршрут (TSP оптимизация)' })
  createMultistop(
    @Body() body: { name: string; startPointId: number; stopIds: number[]; vehicleId?: number; driverId?: number },
    @Req() req: { user: { id: number } },
  ) {
    return this.routes.createMultistop(body, req.user.id);
  }

  @Get('multistop/list')
  @ApiOperation({ summary: 'Список мультистоп маршрутов' })
  listMultistop() {
    return this.routes.listMultistop();
  }

  @Post(':id/auto-assign')
  @ApiOperation({ summary: 'Авто-назначение лучшего водителя на маршрут' })
  autoAssign(@Param('id', ParseIntPipe) id: number) {
    return this.routes.autoAssign(id);
  }

  @Get(':id/enroute-drivers')
  @ApiOperation({ summary: 'Активные водители, способные забрать груз попутно' })
  findEnRouteDrivers(@Param('id', ParseIntPipe) id: number) {
    return this.routes.findEnRouteDrivers(id);
  }

  @Post('analytics/hub-suggest')
  @ApiOperation({ summary: 'Предложить промежуточный хаб для дальнего рейса' })
  suggestHub(
    @Body() body: { startLat: number; startLon: number; endLat: number; endLon: number },
  ) {
    return this.routes.suggestHub(body.startLat, body.startLon, body.endLat, body.endLon);
  }

  @Post('analytics/consolidation')
  @ApiOperation({ summary: 'Кандидаты для консолидации груза' })
  getConsolidation(
    @Body() body: { startLat: number; startLon: number; endLat: number; endLon: number; cargoWeightKg?: number; cargoVolumeCbm?: number },
  ) {
    return this.routes.getConsolidationCandidates(body);
  }

  @Get('analytics/zones')
  @ApiOperation({ summary: 'Зоны водителей' })
  getDriverZones() {
    return this.routes.getDriverZones();
  }

  @Get('analytics/bottlenecks')
  @ApiOperation({ summary: 'Исторические узкие места' })
  getBottlenecks() {
    return this.routes.getBottlenecks();
  }

  @Post('analytics/departure-risk')
  @ApiOperation({ summary: 'Предиктивный риск отправки' })
  getDepartureRisk(
    @Body() body: { startLat: number; startLon: number; endLat: number; endLon: number },
  ) {
    return this.routes.getDepartureRisk(body.startLat, body.startLon, body.endLat, body.endLon);
  }

  @Get(':id/eta')
  @ApiOperation({ summary: 'ML-предсказание ETA маршрута' })
  getMlEta(@Param('id', ParseIntPipe) id: number) {
    return this.routes.getMlEta(id);
  }

  @Get(':id/twin')
  @ApiOperation({ summary: 'Digital Twin — данные для воспроизведения маршрута' })
  getDigitalTwin(@Param('id', ParseIntPipe) id: number) {
    return this.routes.getDigitalTwin(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Обновить статус маршрута' })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body('status') status: string,
  ) {
    return this.routes.updateStatus(id, status);
  }

  @Post(':id/recalculate')
  @ApiOperation({ summary: 'Пересчитать маршрут с новым AI-анализом' })
  recalculate(@Param('id', ParseIntPipe) id: number) {
    return this.routes.recalculate(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить маршрут' })
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.routes.delete(id);
  }
}
