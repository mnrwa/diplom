import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LocationsService } from './locations.service';

export class CreateLocationDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsIn(['WAREHOUSE', 'PICKUP_POINT'])
  type: 'WAREHOUSE' | 'PICKUP_POINT';

  @IsString()
  city: string;

  @IsString()
  address: string;

  @IsNumber()
  lat: number;

  @IsNumber()
  lon: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

@ApiTags('locations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @ApiOperation({ summary: 'Список складов и ПВЗ' })
  findAll(@Query('type') type?: 'WAREHOUSE' | 'PICKUP_POINT') {
    return this.locations.findAll(type);
  }

  @Get('geocode')
  @ApiOperation({ summary: 'Геокодирование адреса через Nominatim' })
  geocode(@Query('q') query: string) {
    return this.locations.geocode(query || '');
  }

  @Post()
  @ApiOperation({ summary: 'Добавить склад или ПВЗ' })
  create(@Body() dto: CreateLocationDto) {
    return this.locations.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить склад или ПВЗ' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateLocationDto>,
  ) {
    return this.locations.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить склад или ПВЗ' })
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.locations.delete(id);
  }
}
