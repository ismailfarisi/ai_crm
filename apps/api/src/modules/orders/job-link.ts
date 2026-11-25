import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { SalesOrder } from './entities/sales-order.entity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks the customer order a purchase order, bill or expense claim is being
 * marked "for". Management costing only: the link never changes how the
 * document posts.
 */
export async function resolveJobOrder(
  manager: EntityManager,
  tenantId: string,
  salesOrderId: string | null | undefined,
): Promise<string | null> {
  if (!salesOrderId) return null;
  if (!UUID.test(salesOrderId)) {
    throw new BadRequestException('Choose the order from the list');
  }
  const order = await manager.getRepository(SalesOrder).findOne({
    where: { id: salesOrderId, tenantId },
    select: { id: true, orderNumber: true, status: true },
  });
  if (!order) throw new NotFoundException('That order was not found');
  if (order.status === 'CANCELLED') {
    throw new BadRequestException(
      `${order.orderNumber} is cancelled, so costs cannot be put on it`,
    );
  }
  return order.id;
}
