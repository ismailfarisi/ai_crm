import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

const tenantId = '11111111-1111-1111-1111-111111111111';
const actorId = '22222222-2222-2222-2222-222222222222';

/**
 * "Start production" used to be decorative: it flipped the badge on the order
 * to *In production* while the Production page still read "No work orders" —
 * no job existed, nothing was scheduled and no material was committed. An
 * owner reading the order list believed work had started on the floor.
 */
describe('OrdersService.setStatus — starting production', () => {
  const order = {
    id: 'so-1',
    tenantId,
    orderNumber: 'SO-2026-0001',
    status: 'OPEN' as const,
  };

  function build(
    production: Partial<{
      createFromSalesOrder: jest.Mock;
      countLive: jest.Mock;
    }>,
  ) {
    /** Chainable enough for the two update builders `setStatus` uses. */
    const repo = () => ({
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
    });

    const service = new OrdersService(
      repo() as never,
      repo() as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      production as never,
    );

    // The read either side of the write is not what these tests are about.
    jest
      .spyOn(service as never as { findOrder: () => unknown }, 'findOrder')
      .mockResolvedValue(order as never);
    jest
      .spyOn(service, 'get')
      .mockResolvedValue({ ...order, status: 'IN_PRODUCTION' } as never);

    return service;
  }

  it('raises the work orders the status claims exist', async () => {
    const createFromSalesOrder = jest.fn().mockResolvedValue({
      created: [{ id: 'wo-1' }],
      skipped: [],
    });
    const service = build({
      createFromSalesOrder,
      countLive: jest.fn().mockResolvedValue(0),
    });

    await service.setStatus(tenantId, order.id, 'IN_PRODUCTION', actorId);

    expect(createFromSalesOrder).toHaveBeenCalledWith(tenantId, actorId, order.id, {
      salesOrderLineIds: null,
      dueDate: null,
    });
  });

  it('refuses the move when nothing can be planned, and says why', async () => {
    const service = build({
      createFromSalesOrder: jest.fn().mockResolvedValue({
        created: [],
        skipped: [
          {
            salesOrderLineId: 'l1',
            description: 'Rigid gift boxes',
            reason: 'Not priced from a product template, so there is no routing to follow',
          },
        ],
      }),
      countLive: jest.fn().mockResolvedValue(0),
    });

    await expect(
      service.setStatus(tenantId, order.id, 'IN_PRODUCTION', actorId),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.setStatus(tenantId, order.id, 'IN_PRODUCTION', actorId),
    ).rejects.toThrow(/no routing to follow/);
  });

  // Planning is idempotent and skips lines that already have one, so an order
  // that is genuinely being made must not be blocked by a second attempt.
  it('allows the move when work orders are already running', async () => {
    const service = build({
      createFromSalesOrder: jest.fn().mockResolvedValue({
        created: [],
        skipped: [{ salesOrderLineId: 'l1', description: 'x', reason: 'Already has a work order' }],
      }),
      countLive: jest.fn().mockResolvedValue(2),
    });

    await expect(
      service.setStatus(tenantId, order.id, 'IN_PRODUCTION', actorId),
    ).resolves.toBeDefined();
  });

  it('leaves other transitions alone', async () => {
    const createFromSalesOrder = jest.fn();
    const service = build({
      createFromSalesOrder,
      countLive: jest.fn().mockResolvedValue(0),
    });
    jest
      .spyOn(service as never as { countDeliveries: () => unknown }, 'countDeliveries')
      .mockResolvedValue(0 as never);

    await service.setStatus(tenantId, order.id, 'FULFILLED', actorId);

    expect(createFromSalesOrder).not.toHaveBeenCalled();
  });
});
