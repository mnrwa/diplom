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
import { IsInt, IsOptional, IsString } from 'class-validator';
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

  @Post()
  @ApiOperation({ summary: 'Создать маршрут от склада до ПВЗ' })
  create(
    @Body() dto: CreateRouteDto,
    @Req() req: { user: { id: number } },
  ) {
    return this.routes.create(dto, req.user.id);
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
