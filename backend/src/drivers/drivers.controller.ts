import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DriversService } from './drivers.service';

export class CreateDriverDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  licenseCategory?: string;

  @IsOptional()
  @IsInt()
  experienceYears?: number;

  @IsOptional()
  @IsInt()
  vehicleId?: number;
}

@ApiTags('drivers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @ApiOperation({ summary: 'Список водителей с текущим статусом и GPS' })
  findAll() {
    return this.drivers.findAll();
  }

  @Get('me')
  @ApiOperation({ summary: 'Кабинет текущего водителя' })
  me(@Req() req: { user: { id: number } }) {
    return this.drivers.findMe(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Подробная карточка водителя для админки' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.drivers.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Создать логин и пароль для водителя' })
  create(@Body() dto: CreateDriverDto) {
    return this.drivers.create(dto);
  }

  @Get(':id/telematics')
  @ApiOperation({ summary: 'Телематический рейтинг водителя (анализ GPS)' })
  telematics(@Param('id', ParseIntPipe) id: number) {
    return this.drivers.getTelematics(id);
  }
}
