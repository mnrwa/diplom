import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MarketplaceService } from './marketplace.service';

@ApiTags('marketplace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('marketplace')
export class MarketplaceController {
  constructor(private marketplace: MarketplaceService) {}

  @Get()
  @ApiOperation({ summary: 'Список заявок биржи' })
  listOrders(@Query('status') status?: string) {
    return this.marketplace.listOrders(status);
  }

  @Get('my-bids')
  @ApiOperation({ summary: 'Мои ставки (для водителя)' })
  myBids(@Req() req: { user: { driverProfileId?: number } }) {
    const driverId = req.user.driverProfileId;
    if (!driverId) return [];
    return this.marketplace.getMyBids(driverId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Заявка по ID' })
  getOrder(@Param('id', ParseIntPipe) id: number) {
    return this.marketplace.getOrder(id);
  }

  @Post()
  @ApiOperation({ summary: 'Создать заявку на бирже' })
  createOrder(
    @Body() body: { title: string; description?: string; startAddress: string; endAddress: string; startLat: number; startLon: number; endLat: number; endLon: number; startCity: string; endCity: string; budget?: number },
    @Req() req: { user: { id: number } },
  ) {
    return this.marketplace.createOrder(body, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Удалить заявку' })
  deleteOrder(@Param('id', ParseIntPipe) id: number, @Req() req: { user: { id: number } }) {
    return this.marketplace.deleteOrder(id, req.user.id);
  }

  @Post(':id/bid')
  @ApiOperation({ summary: 'Подать ставку на заявку (водитель)' })
  submitBid(
    @Param('id', ParseIntPipe) orderId: number,
    @Body() body: { proposedPrice?: number; estimatedTime?: number; message?: string },
    @Req() req: { user: { driverProfileId?: number } },
  ) {
    const driverId = req.user.driverProfileId;
    if (!driverId) throw new Error('Только водители могут подавать ставки');
    return this.marketplace.submitBid(orderId, driverId, body);
  }

  @Post(':id/accept/:bidId')
  @ApiOperation({ summary: 'Принять ставку (диспетчер/заказчик)' })
  acceptBid(
    @Param('id', ParseIntPipe) orderId: number,
    @Param('bidId', ParseIntPipe) bidId: number,
    @Req() req: { user: { id: number } },
  ) {
    return this.marketplace.acceptBid(orderId, bidId, req.user.id);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Завершить заявку' })
  complete(@Param('id', ParseIntPipe) id: number) {
    return this.marketplace.completeOrder(id);
  }
}
