import { Controller, Get, Post, Patch, Delete, Body, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { VehiclesService } from './vehicles.service';
import { IsString, IsOptional } from 'class-validator';

export class CreateVehicleDto {
  @IsString() plateNumber: string;
  @IsString() model: string;
  @IsOptional() @IsString() driverName?: string;
}

@ApiTags('vehicles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private vehicles: VehiclesService) {}

  @Get()
  @ApiOperation({ summary: 'Все транспортные средства' })
  findAll() { return this.vehicles.findAll(); }

  @Post()
  @ApiOperation({ summary: 'Добавить ТС' })
  create(@Body() dto: CreateVehicleDto) { return this.vehicles.create(dto); }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить ТС' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<CreateVehicleDto>) {
    return this.vehicles.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить ТС' })
  delete(@Param('id', ParseIntPipe) id: number) { return this.vehicles.delete(id); }
}
