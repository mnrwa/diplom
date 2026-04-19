import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MarketplaceService {
  constructor(private prisma: PrismaService) {}

  async listOrders(status?: string) {
    return this.prisma.marketplaceOrder.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        bids: { include: { driver: { include: { user: true } } }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrder(id: number) {
    const order = await this.prisma.marketplaceOrder.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, name: true, email: true } },
        bids: { include: { driver: { include: { user: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('Заявка не найдена');
    return order;
  }

  async createOrder(data: {
    title: string;
    description?: string;
    startAddress: string;
    endAddress: string;
    startLat: number;
    startLon: number;
    endLat: number;
    endLon: number;
    startCity: string;
    endCity: string;
    budget?: number;
  }, userId: number) {
    return this.prisma.marketplaceOrder.create({
      data: { ...data, createdById: userId },
      include: { createdBy: { select: { id: true, name: true } }, bids: true },
    });
  }

  async deleteOrder(id: number, userId: number) {
    const order = await this.prisma.marketplaceOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Заявка не найдена');
    if (order.createdById !== userId) throw new ForbiddenException('Нет прав');
    return this.prisma.marketplaceOrder.delete({ where: { id } });
  }

  async submitBid(orderId: number, driverId: number, data: { proposedPrice?: number; estimatedTime?: number; message?: string }) {
    const order = await this.prisma.marketplaceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заявка не найдена');
    if (order.status !== 'OPEN') throw new ForbiddenException('Заявка закрыта');

    const existing = await this.prisma.marketplaceBid.findFirst({ where: { orderId, driverId } });
    if (existing) {
      return this.prisma.marketplaceBid.update({ where: { id: existing.id }, data });
    }

    return this.prisma.marketplaceBid.create({
      data: { orderId, driverId, ...data },
      include: { driver: { include: { user: true } } },
    });
  }

  async acceptBid(orderId: number, bidId: number, userId: number) {
    const order = await this.prisma.marketplaceOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Заявка не найдена');
    if (order.createdById !== userId) throw new ForbiddenException('Нет прав');

    await this.prisma.marketplaceBid.updateMany({ where: { orderId, id: { not: bidId } }, data: { status: 'REJECTED' } });
    await this.prisma.marketplaceBid.update({ where: { id: bidId }, data: { status: 'ACCEPTED' } });

    return this.prisma.marketplaceOrder.update({
      where: { id: orderId },
      data: { status: 'IN_PROGRESS', acceptedBidId: bidId },
      include: { bids: { include: { driver: { include: { user: true } } } } },
    });
  }

  async completeOrder(id: number) {
    return this.prisma.marketplaceOrder.update({ where: { id }, data: { status: 'COMPLETED' } });
  }

  async getMyBids(driverId: number) {
    return this.prisma.marketplaceBid.findMany({
      where: { driverId },
      include: { order: { include: { createdBy: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
