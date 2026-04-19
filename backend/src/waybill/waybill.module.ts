import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WaybillService } from './waybill.service';
import { WaybillController } from './waybill.controller';

@Module({
  imports: [PrismaModule],
  providers: [WaybillService],
  controllers: [WaybillController],
  exports: [WaybillService],
})
export class WaybillModule {}
