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
    opts: { casAffected?: number[] } = {},
  ) {
    const log: string[] = [];
    const casResults = [...(opts.casAffected ?? [])];
    /** Chainable enough for the update builders `setStatus` uses. */
    const updateBuilder = () => {
      let target = '';
      let values: Record<string, unknown> = {};
      const qb: any = {
        update: jest.fn((entity: { name: string }) => {
          target = entity.name;
          return qb;
        }),
        set: jest.fn((v: Record<string, unknown>) => {
          values = v;
          return qb;
        }),
        where: jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        execute: jest.fn(async () => {
          log.push(`update ${target} ${JSON.stringify(Object.keys(values))}`);
          if (target === 'SalesOrder') {
            log.push(`status -> ${String(values.status)}`);
            return { affected: casResults.length ? casResults.shift() : 1 };
          }
          return { affected: 1 };
        }),
      };
      return qb;
    };
    const repo = () => ({ createQueryBuilder: jest.fn(updateBuilder) });
    const manager = {
      getRepository: () => ({
        createQueryBuilder: jest.fn(() => {
          const qb: any = {
            setLock: jest.fn(() => {
              log.push('lock SalesOrder');
              return qb;
            }),
            where: jest.fn(() => qb),
            andWhere: jest.fn(() => qb),
            getOne: jest.fn(async () => ({ ...order })),
          };
          return qb;
        }),
        find: jest.fn().mockResolvedValue([]),
      }),
      createQueryBuilder: jest.fn(updateBuilder),
      query: jest.fn().mockResolvedValue([{ n: '0' }]),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
    };

    if (production.createFromSalesOrder) {
      const inner = production.createFromSalesOrder;
      production.createFromSalesOrder = jest.fn(async (...args: unknown[]) => {
        log.push('plan work orders');
        return inner(...args);
      });
    }

    const service = new OrdersService(
      repo() as never,
      repo() as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
      {} as never,
      dataSource as never,
      {} as never,
      production as never,
    );

    // The read either side of the write is not what these tests are about.
    jest.spyOn(service as never, 'findOrder').mockResolvedValue(order as never);
    jest
      .spyOn(service, 'get')
      .mockResolvedValue({ ...order, status: 'IN_PRODUCTION' } as never);

    return Object.assign(service, { log, planner: production });
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

    expect(service.planner.createFromSalesOrder).toHaveBeenCalledWith(
      tenantId,
      actorId,
      order.id,
      {
        salesOrderLineIds: null,
        dueDate: null,
      },
    );
  });

  it('refuses the move when nothing can be planned, and says why', async () => {
    const service = build({
      createFromSalesOrder: jest.fn().mockResolvedValue({
        created: [],
        skipped: [
          {
            salesOrderLineId: 'l1',
            description: 'Rigid gift boxes',
            reason:
              'Not priced from a product template, so there is no routing to follow',
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
        skipped: [
          {
            salesOrderLineId: 'l1',
            description: 'x',
            reason: 'Already has a work order',
          },
        ],
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
      .spyOn(service as never, 'countDeliveries')
      .mockResolvedValue(0 as never);

    await service.setStatus(tenantId, order.id, 'FULFILLED', actorId);

    expect(service.planner.createFromSalesOrder).not.toHaveBeenCalled();
  });

  /**
   * Two people pressing "start production" at once used to both plan work
   * orders before either flipped the status. The status is claimed first now,
   * so only the winner plans anything.
   */
  it('claims the status before planning, and plans nothing when the claim loses', async () => {
    const service = build(
      {
        createFromSalesOrder: jest
          .fn()
          .mockResolvedValue({ created: [{ id: 'wo-1' }], skipped: [] }),
        countLive: jest.fn().mockResolvedValue(0),
      },
      { casAffected: [0] },
    );

    await expect(
      service.setStatus(tenantId, order.id, 'IN_PRODUCTION', actorId),
    ).rejects.toThrow(/changed by someone else/);
    expect(service.planner.createFromSalesOrder).not.toHaveBeenCalled();
  });

  it('puts the status back when nothing could be planned', async () => {
    const service = build({
      createFromSalesOrder: jest.fn().mockResolvedValue({
        created: [],
        skipped: [
          { salesOrderLineId: 'l1', description: 'x', reason: 'No routing' },
        ],
      }),
      countLive: jest.fn().mockResolvedValue(0),
    });

    await expect(
      service.setStatus(tenantId, order.id, 'IN_PRODUCTION', actorId),
    ).rejects.toThrow(/No routing/);
    expect(service.log).toEqual([
      'update SalesOrder ["status"]',
      'status -> IN_PRODUCTION',
      'plan work orders',
      'update SalesOrder ["status"]',
      'status -> OPEN',
    ]);
  });
});

describe('OrdersService.setStatus — marking fulfilled', () => {
  const order = {
    id: 'so-1',
    tenantId,
    orderNumber: 'SO-2026-0001',
    status: 'OPEN' as const,
  };

  function build(casAffected: number) {
    const log: string[] = [];
    const updateBuilder = () => {
      let target = '';
      const qb: any = {
        update: (entity: { name: string }) => {
          target = entity.name;
          return qb;
        },
        set: () => qb,
        where: () => qb,
        andWhere: () => qb,
        execute: async () => {
          log.push(`update ${target}`);
          return { affected: target === 'SalesOrder' ? casAffected : 3 };
        },
      };
      return qb;
    };
    const manager = {
      getRepository: () => ({
        createQueryBuilder: () => {
          const qb: any = {
            setLock: () => {
              log.push('lock SalesOrder');
              return qb;
            },
            where: () => qb,
            andWhere: () => qb,
            getOne: async () => ({ ...order }),
          };
          return qb;
        },
        find: async () => [],
      }),
      createQueryBuilder: updateBuilder,
      query: async () => [{ n: '0' }],
    };
    const dataSource = {
      transaction: async (cb: (m: unknown) => unknown) => {
        log.push('begin');
        try {
          const result = await cb(manager);
          log.push('commit');
          return result;
        } catch (err) {
          log.push('rollback');
          throw err;
        }
      },
    };
    // Writes outside the transaction would escape its rollback.
    const outside = {
      createQueryBuilder: () => {
        log.push('write outside transaction');
        return updateBuilder();
      },
    };
    const service = new OrdersService(
      outside as never,
      outside as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      {} as never,
      {} as never,
      dataSource as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service as never, 'findOrder').mockResolvedValue(order as never);
    jest
      .spyOn(service, 'get')
      .mockResolvedValue({ ...order, status: 'FULFILLED' } as never);
    return { service, log };
  }

  it('locks the order, moves the status, then fulfils the lines, in one transaction', async () => {
    const { service, log } = build(1);

    await service.setStatus(tenantId, order.id, 'FULFILLED', actorId);

    expect(log).toEqual([
      'begin',
      'lock SalesOrder',
      'update SalesOrder',
      'update SalesOrderLine',
      'commit',
    ]);
  });

  it('touches no line when the status move loses a race', async () => {
    const { service, log } = build(0);

    await expect(
      service.setStatus(tenantId, order.id, 'FULFILLED', actorId),
    ).rejects.toThrow(/changed by someone else/);
    expect(log).not.toContain('update SalesOrderLine');
    expect(log).toContain('rollback');
  });
});
