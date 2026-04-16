import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { RoutesModule } from './routes/routes.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { GpsModule } from './gps/gps.module';
import { AiModule } from './ai/ai.module';
import { DriversModule } from './drivers/drivers.module';
import { LocationsModule } from './locations/locations.module';
import { DemoDataService } from './demo/demo-data.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HttpModule,
    PrismaModule,
    AuthModule,
    RoutesModule,
    VehiclesModule,
    GpsModule,
    AiModule,
    DriversModule,
    LocationsModule,
  ],
  providers: [DemoDataService],
})
export class AppModule {}
