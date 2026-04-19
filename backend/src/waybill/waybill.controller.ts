import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WaybillService } from './waybill.service';

@ApiTags('waybill')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('waybill')
export class WaybillController {
  constructor(private waybill: WaybillService) {}

  @Get('route/:routeId')
  @ApiOperation({ summary: 'Получить или создать путевой лист для маршрута' })
  getOrCreate(@Param('routeId', ParseIntPipe) routeId: number) {
    return this.waybill.getOrCreate(routeId);
  }

  @Post('route/:routeId/sign')
  @ApiOperation({ summary: 'Подписать путевой лист (base64 подпись)' })
  sign(
    @Param('routeId', ParseIntPipe) routeId: number,
    @Body('signatureData') signatureData: string,
  ) {
    return this.waybill.sign(routeId, signatureData);
  }

  @Post('route/:routeId/checkpoints')
  @ApiOperation({ summary: 'Обновить контрольные точки путевого листа' })
  updateCheckpoints(
    @Param('routeId', ParseIntPipe) routeId: number,
    @Body('checkpoints') checkpoints: any[],
  ) {
    return this.waybill.updateCheckpoints(routeId, checkpoints);
  }
}
