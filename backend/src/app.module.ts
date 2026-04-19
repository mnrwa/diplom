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
import { PublicModule } from './public/public.module';
import { WaybillModule } from './waybill/waybill.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { TelegramModule } from './telegram/telegram.module';

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
    PublicModule,
    WaybillModule,
    MarketplaceModule,
    TelegramModule,
  ],
  providers: [DemoDataService],
})
export class AppModule {}
