import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RoutesService } from './routes.service';
import { RoutesController } from './routes.controller';
import { RouteNewsRefresherService } from './route-news-refresher.service';
import { LocationsModule } from '../locations/locations.module';

@Module({
  imports: [HttpModule, LocationsModule],
  providers: [RoutesService, RouteNewsRefresherService],
  controllers: [RoutesController],
  exports: [RoutesService],
})
export class RoutesModule {}
