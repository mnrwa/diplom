import { Module } from '@nestjs/common';
import { GpsService } from './gps.service';
import { GpsController } from './gps.controller';
import { GpsGateway } from './gps.gateway';
import { MockGpsSimulatorService } from './mock-gps-simulator.service';
import { TelegramModule } from '../telegram/telegram.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [TelegramModule, PrismaModule],
  providers: [GpsService, GpsGateway, MockGpsSimulatorService],
  controllers: [GpsController],
})
export class GpsModule {}
