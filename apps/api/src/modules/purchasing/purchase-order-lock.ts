import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';

/**
 * Locks a purchase order and then its lines, `FOR UPDATE`, inside the
 * caller's transaction, and returns them as they stand under the lock.
 *
 * Everything that changes an order's status or its received quantities goes
 * through here, so they all take locks in the same order:
 *
 *   purchase order -> its lines (by id) -> stock rows (by material)
 *
 * The same order everywhere is what keeps two of these from deadlocking each
 * other. Reading the order without the lock is how two receipts both passed
 * the tolerance check against the same stale `qtyReceived`, and how two
 * approvals both added to `qty_on_order`.
 *
 * The order is locked with a query builder rather than `findOne`, because the
 * `lines` relation is eager and Postgres refuses `FOR UPDATE` on the nullable
 * side of the outer join that would bring in.
 */
export async function lockPurchaseOrder(
  manager: EntityManager,
  tenantId: string,
  orderId: string,
): Promise<PurchaseOrder> {
  const order = await manager
    .getRepository(PurchaseOrder)
    .createQueryBuilder('po')
    .setLock('pessimistic_write')
    .where('po.id = :id', { id: orderId })
    .andWhere('po.tenantId = :tenantId', { tenantId })
    .andWhere('po.deletedAt IS NULL')
    .getOne();
  if (!order) {
    throw new NotFoundException(`Purchase order ${orderId} not found`);
  }

  order.lines = await manager
    .getRepository(PurchaseOrderLine)
    .createQueryBuilder('line')
    .setLock('pessimistic_write')
    .where('line.purchaseOrderId = :purchaseOrderId', {
      purchaseOrderId: order.id,
    })
    .andWhere('line.tenantId = :tenantId', { tenantId })
    .orderBy('line.id', 'ASC')
    .getMany();

  return order;
}
