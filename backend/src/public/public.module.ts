import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RoutesModule } from '../routes/routes.module';
import { LocationsModule } from '../locations/locations.module';

@Module({
  imports: [PrismaModule, RoutesModule, LocationsModule],
  controllers: [PublicController],
})
export class PublicModule {}

