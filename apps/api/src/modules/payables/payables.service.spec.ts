import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PERMISSIONS } from '@saas/shared';
import { PayablesService } from './payables.service';

const tenantId = '11111111-1111-1111-1111-111111111111';
const APPROVER = [PERMISSIONS.BILL_APPROVE];
const ALL = [
  PERMISSIONS.BILL_APPROVE,
  PERMISSIONS.BILL_APPROVE_VARIANCE,
  PERMISSIONS.BILL_PAY,
];

interface Seed {
  bill?: any;
  orderLine?: any;
  billedElsewhere?: number;
  tolerance?: number;
  existingBills?: any[];
}

function makeService(seed: Seed = {}) {
  const orderLine = seed.orderLine ?? {
    id: 'pol-1',
    tenantId,
    purchaseOrderId: 'po-1',
    description: 'Board',
    unitCost: 0.42,
    qtyReceived: 500,
    qtyOrdered: 500,
  };

  const bill: any = seed.bill ?? {
    id: 'bill-1',
    tenantId,
    billNumber: 'BILL-2026-0001',
    currency: 'GBP',
    fxRate: 1,
    supplierName: 'Papertree Ltd',
    purchaseOrderId: 'po-1',
    status: 'DRAFT',
    billDate: new Date('2026-09-01'),
    totalAmount: 210,
    paidAmount: 0,
    taxAmount: 0,
    deletedAt: null,
    lines: [
      {
        purchaseOrderLineId: 'pol-1',
        description: 'Board',
        qty: 500,
        unitCost: 0.42,
        orderUnitCost: 0.42,
      },
    ],
  };

  const saved: Record<string, any[]> = {
    journal: [],
    payments: [],
    queries: [],
  };

  const qb = () => {
    const b: any = {
      innerJoin: () => b,
      select: () => b,
      addSelect: () => b,
      where: () => b,
      andWhere: () => b,
      groupBy: () => b,
      setLock: () => b,
      getRawMany: async () =>
        seed.billedElsewhere
          ? [{ orderLineId: 'pol-1', qty: String(seed.billedElsewhere) }]
          : [],
      getOne: async () => bill,
      getMany: async () => [orderLine],
    };
    return b;
  };

  const repo = (name: string) => ({
    findOne: jest.fn(async ({ where }: any) => {
      if (name === 'Organization') return { id: tenantId, baseCurrency: 'GBP' };
      if (name === 'Supplier')
        return {
          id: 'sup-1',
          companyName: 'Papertree Ltd',
          currency: 'GBP',
          paymentTermsDays: 30,
        };
      if (name === 'PurchaseOrder')
        return {
          id: 'po-1',
          poNumber: 'PO-1',
          supplierId: 'sup-1',
          supplierName: 'Papertree Ltd',
        };
      if (name === 'PurchasePolicyEntity')
        return seed.tolerance == null
          ? null
          : { varianceTolerancePct: seed.tolerance };
      if (name === 'FinanceAccount')
        return { id: 'acc-1', name: 'Operating Bank', tenantId };
      if (name === 'SupplierBill') {
        if (where.supplierInvoiceNumber) {
          return (
            (seed.existingBills ?? []).find(
              (b) => b.supplierInvoiceNumber === where.supplierInvoiceNumber,
            ) ?? null
          );
        }
        return where.id === bill.id ? bill : null;
      }
      return null;
    }),
    find: jest.fn(async () =>
      name === 'PurchaseOrderLine'
        ? [orderLine]
        : name === 'SupplierBillLine'
          ? bill.lines
          : [],
    ),
    create: jest.fn((dto: any) => ({ id: `${name}-new`, ...dto })),
    save: jest.fn(async (row: any) => {
      if (name === 'JournalEntry') saved.journal.push(row);
      if (name === 'BillPayment') saved.payments.push(row);
      return row;
    }),
    createQueryBuilder: jest.fn(qb),
  });

  const manager: any = {
    getRepository: jest.fn((entity: any) => repo(entity?.name ?? entity)),
    query: jest.fn(async (sql: string, params: any[]) => {
      saved.queries.push({ sql, params });
      if (sql.includes('tenant_sequences')) return [{ current_value: 1 }];
      return [];
    }),
  };

  const ledger = {
    resolveLines: jest.fn(async (_t: string, lines: any[]) =>
      lines.map((l) => ({
        ledgerAccountId: `l-${l.role ?? l.financeAccountId}`,
        ledgerAccountCode: '0',
        ...l,
      })),
    ),
  };

  const service = new PayablesService(
    repo('SupplierBill') as any,
    repo('BillPayment') as any,
    ledger as any,
    { manager, transaction: jest.fn(async (cb: any) => cb(manager)) } as any,
    {
      findCode: jest.fn(async (_t: string, id: string) => ({ id })),
      purchaseCodeForSupplier: jest.fn(async () => null),
    } as any,
    { notifyHolders: jest.fn(async () => 0), resolve: jest.fn(async () => undefined) } as any,
  );

  return { service, bill, saved, ledger };
}

describe('PayablesService.approve', () => {
  it('posts a matched bill: Dr GRNI, Cr payables', async () => {
    const { service, bill, saved } = makeService();

    await service.approve(tenantId, 'bill-1', {
      userId: 'u',
      permissions: APPROVER,
    });

    expect(bill.status).toBe('APPROVED');
    expect(bill.matchStatus).toBe('MATCHED');
    expect(bill.varianceApproved).toBe(false);
    expect(saved.journal[0].referenceType).toBe('BILL');
    expect(saved.journal[0].lines.map((l: any) => l.role)).toEqual([
      'GRNI',
      'ACCOUNTS_PAYABLE',
    ]);
  });

  it('refuses a price variance without the variance permission, naming the prices', async () => {
    const { service, bill } = makeService({ tolerance: 0.05 });
    bill.lines[0].unitCost = 0.4536; // 8% over
    bill.totalAmount = 226.8;

    await expect(
      service.approve(tenantId, 'bill-1', {
        userId: 'u',
        permissions: APPROVER,
      }),
    ).rejects.toThrow(/8\.0% above the ordered 0\.4200/);
    expect(bill.status).toBe('DRAFT');
  });

  it('approves the same variance for someone allowed to accept it, and records that it was a decision', async () => {
    const { service, bill, saved } = makeService({ tolerance: 0.05 });
    bill.lines[0].unitCost = 0.4536;
    bill.totalAmount = 226.8;

    await service.approve(tenantId, 'bill-1', {
      userId: 'u',
      permissions: ALL,
    });

    expect(bill.status).toBe('APPROVED');
    expect(bill.varianceApproved).toBe(true);
    // The difference lands in price variance so GRNI still clears at 210.
    expect(
      saved.journal[0].lines.find((l: any) => l.role === 'GRNI').debit,
    ).toBe(210);
    expect(
      saved.journal[0].lines.find((l: any) => l.role === 'COGS').debit,
    ).toBe(16.8);
  });

  it('refuses goods already billed elsewhere even for someone allowed to accept variances', async () => {
    // The case staging caught: the variance permission must not turn a second
    // bill for the same goods into an approved liability.
    const { service, bill, saved } = makeService({ billedElsewhere: 500 });

    await expect(
      service.approve(tenantId, 'bill-1', { userId: 'u', permissions: ALL }),
    ).rejects.toThrow(/nothing left to bill/);
    expect(bill.status).toBe('DRAFT');
    expect(saved.journal).toHaveLength(0);
  });

  it('refuses a bill for goods already billed and approved elsewhere', async () => {
    const { service } = makeService({ billedElsewhere: 500 });

    await expect(
      service.approve(tenantId, 'bill-1', {
        userId: 'u',
        permissions: APPROVER,
      }),
    ).rejects.toThrow(/nothing left to bill/);
  });

  it('refuses without the approve permission before touching anything', async () => {
    const { service, saved } = makeService();

    await expect(
      service.approve(tenantId, 'bill-1', { userId: 'u', permissions: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(saved.journal).toHaveLength(0);
  });

  it('will not approve a bill twice', async () => {
    const { service, bill } = makeService();
    bill.status = 'APPROVED';

    await expect(
      service.approve(tenantId, 'bill-1', { userId: 'u', permissions: ALL }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PayablesService.recordPayment', () => {
  const approved = () => {
    const ctx = makeService();
    ctx.bill.status = 'APPROVED';
    return ctx;
  };

  it('pays the remaining balance by default, moves cash atomically, and posts Dr payables / Cr cash', async () => {
    const { service, bill, saved } = approved();

    await service.recordPayment(tenantId, 'bill-1', 'u', {
      financeAccountId: 'acc-1',
      reference: null,
    });

    expect(bill.status).toBe('PAID');
    expect(bill.paidAmount).toBe(210);
    // A relative UPDATE, never a read-modify-write that loses a concurrent payment.
    const update = saved.queries.find((q) =>
      q.sql.includes('UPDATE "finance_accounts"'),
    );
    expect(update.sql).toContain('"balance" = "balance" - $1');
    expect(update.params[0]).toBe(210);
    expect(
      saved.journal[0].lines.map((l: any) => (l.debit > 0 ? 'Dr' : 'Cr')),
    ).toEqual(['Dr', 'Cr']);
  });

  it('marks a part payment PARTIALLY_PAID', async () => {
    const { service, bill } = approved();

    await service.recordPayment(tenantId, 'bill-1', 'u', {
      financeAccountId: 'acc-1',
      amount: 100,
      reference: null,
    });

    expect(bill.status).toBe('PARTIALLY_PAID');
    expect(bill.paidAmount).toBe(100);
  });

  it('refuses to overpay, and says what is outstanding', async () => {
    const { service } = approved();

    await expect(
      service.recordPayment(tenantId, 'bill-1', 'u', {
        financeAccountId: 'acc-1',
        amount: 250,
        reference: null,
      }),
    ).rejects.toThrow(/210\.00 outstanding/);
  });

  it('refuses to pay a bill that has not been approved', async () => {
    const { service } = makeService();

    await expect(
      service.recordPayment(tenantId, 'bill-1', 'u', {
        financeAccountId: 'acc-1',
        reference: null,
      }),
    ).rejects.toThrow(/draft and cannot be paid/);
  });
});

describe('PayablesService.create', () => {
  it('refuses the same supplier invoice entered twice', async () => {
    // The commonest way to pay a supplier twice.
    const { service } = makeService({
      existingBills: [
        { supplierInvoiceNumber: 'INV-9001', billNumber: 'BILL-2026-0007' },
      ],
    });

    await expect(
      service.create(tenantId, 'u', {
        supplierId: 'sup-1',
        purchaseOrderId: null,
        supplierInvoiceNumber: 'INV-9001',
        billDate: new Date('2026-09-01'),
        dueDate: null,
        taxAmount: 0,
        notes: null,
        lines: [
          {
            purchaseOrderLineId: null,
            description: 'Rent',
            qty: 1,
            unitCost: 1500,
          },
        ],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('defaults the due date from the supplier’s payment terms', async () => {
    const { service } = makeService();

    const bill = await service.create(tenantId, 'u', {
      supplierId: 'sup-1',
      purchaseOrderId: null,
      supplierInvoiceNumber: 'INV-1',
      billDate: new Date('2026-09-01T00:00:00Z'),
      dueDate: null,
      taxAmount: 0,
      notes: null,
      lines: [
        {
          purchaseOrderLineId: null,
          description: 'Rent',
          qty: 1,
          unitCost: 1500,
        },
      ],
    });

    expect(bill.dueDate?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(bill.matchStatus).toBe('UNMATCHED');
    expect(bill.status).toBe('DRAFT');
  });
});

describe('PayablesService transitions', () => {
  it('will not cancel an approved bill, which has already posted', async () => {
    const { service, bill } = makeService();
    bill.status = 'APPROVED';
    await expect(service.cancel(tenantId, 'bill-1')).rejects.toThrow(
      /approved and cannot be cancelled/,
    );
  });

  it('disputes a draft and records why', async () => {
    const { service, bill } = makeService();
    await service.dispute(tenantId, 'bill-1', 'Price does not match quote');
    expect(bill.status).toBe('DISPUTED');
    expect(bill.disputeReason).toBe('Price does not match quote');
  });
});
