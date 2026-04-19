import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { LocationsService } from '../locations/locations.service';
import { RoutesService } from '../routes/routes.service';

export class PublicCreateOrderDto {
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
}

@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly routes: RoutesService,
    private readonly locations: LocationsService,
  ) {}

  @Get('track/:id')
  @ApiOperation({ summary: 'Публичный трекинг заказа (без авторизации)' })
  async track(@Param('id', ParseIntPipe) id: number) {
    const route = await this.prisma.route.findUnique({
      where: { id },
      include: {
        startPoint: true,
        endPoint: true,
        gpsLogs: { orderBy: { timestamp: 'desc' }, take: 100 },
      },
    });

    if (!route) {
      throw new NotFoundException('Заказ не найден');
    }

    return {
      id: route.id,
      name: route.name,
      status: route.status,
      startPoint: route.startPoint,
      endPoint: route.endPoint,
      distance: route.distance,
      estimatedTime: route.estimatedTime,
      gpsLogs: route.gpsLogs,
      updatedAt: route.updatedAt,
      createdAt: route.createdAt,
    };
  }

  @Get('geocode')
  @ApiOperation({ summary: 'Публичное геокодирование (без авторизации)' })
  geocode(@Query('q') query: string) {
    return this.locations.geocode(query || '');
  }

  @Post('order')
  @ApiOperation({ summary: 'Публичное создание заказа (без авторизации)' })
  createOrder(@Body() dto: PublicCreateOrderDto) {
    return this.routes.createQuick(dto as any, undefined);
  }
}

