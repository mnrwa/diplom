import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RoutesService } from './routes.service';
import { RoutesController } from './routes.controller';
import { RouteNewsRefresherService } from './route-news-refresher.service';
import { PublicTrackingController } from './public-tracking.controller';
import { LocationsModule } from '../locations/locations.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [HttpModule, LocationsModule, PrismaModule],
  providers: [RoutesService, RouteNewsRefresherService],
  controllers: [RoutesController, PublicTrackingController],
  exports: [RoutesService],
})
export class RoutesModule {}
