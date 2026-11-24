import { BadRequestException } from '@nestjs/common';
import {
  isBalanced,
  type BillingStage,
  type QuoteLineItem,
} from '@saas/shared';
import {
  provisionOrderForQuote,
  provisionOrderForQuoteInTransaction,
  raiseStageInvoice,
} from './order-provisioning';

const tenantId = '11111111-1111-1111-1111-111111111111';

const ITEMS: QuoteLineItem[] = [
  {
    id: 'l1',
    type: 'product',
    description: 'Printed boxes',
    quantity: 1000,
    unitPrice: 1,
    taxRate: 20,
    subtotal: 1000,
    cost: { unitCost: 0.4, totalCost: 400, source: 'COMPUTED' },
  },
  { id: 's1', type: 'section', description: 'Delivery' },
];

/**
 * An in-memory stand-in for the parts of TypeORM the provisioning touches.
 * Rows live in arrays per entity name; ids are sequential so assertions can
 * name them.
 */
function makeWorld(quoteOverrides: Record<string, unknown> = {}) {
  const tables: Record<string, any[]> = {
    Quote: [
      {
        id: 'q1',
        tenantId,
        quoteNumber: 'QT-2026-0007',
        customerId: null,
        customerName: 'Acme',
        customerEmail: 'ap@acme.test',
        currency: 'GBP',
        paymentTerms: 'net_30',
        items: ITEMS,
        subtotalAmount: 1000,
        discountAmount: 0,
        taxAmount: 200,
        totalAmount: 1200,
        notes: null,
        billingSchedule: null,
        supersededAt: null,
        ...quoteOverrides,
      },
    ],
    Organization: [{ id: tenantId, baseCurrency: 'GBP' }],
    SalesOrder: [],
    SalesOrderLine: [],
    BillingScheduleLine: [],
    Invoice: [],
    JournalEntry: [],
  };
  const sequences: Record<string, number> = {};
  let nextId = 1;
  const locks: string[] = [];

  const matches = (row: any, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => row[k] === v);

  const repo = (name: string) => ({
    findOne: async ({ where }: any) =>
      tables[name].find((row) => matches(row, where)) ?? null,
    find: async ({ where }: any) =>
      tables[name].filter((row) => matches(row, where)),
    count: async ({ where }: any) =>
      tables[name].filter((row) => matches(row, where)).length,
    create: (dto: any) => ({ ...dto }),
    save: async (rows: any) => {
      const list = Array.isArray(rows) ? rows : [rows];
      for (const row of list) {
        if (!row.id) {
          row.id = `${name}-${nextId++}`;
          row.createdAt = new Date();
          if (name === 'Invoice') row.issuedAt = new Date();
          tables[name].push(row);
        }
      }
      return rows;
    },
    createQueryBuilder: () => {
      let params: any = {};
      const qb: any = {
        setLock: () => {
          locks.push(name);
          return qb;
        },
        where: (_sql: string, p: any) => {
          params = { ...params, ...p };
          return qb;
        },
        andWhere: (_sql: string, p: any) => {
          params = { ...params, ...p };
          return qb;
        },
        getOne: async () =>
          tables[name].find(
            (row) =>
              row.id === (params.quoteId ?? params.id) &&
              row.tenantId === params.tenantId,
          ) ?? null,
      };
      return qb;
    },
  });

  const manager: any = {
    getRepository: (entity: { name: string }) => repo(entity.name),
    query: async (_sql: string, [, name]: [string, string]) => {
      sequences[name] = (sequences[name] ?? 0) + 1;
      return [{ current_value: sequences[name] }];
    },
  };
  const dataSource: any = { transaction: (cb: any) => cb(manager) };
  const ledger = {
    resolveLines: jest.fn(async (_t: string, lines: any[]) =>
      lines.map((l) => ({
        ledgerAccountId: l.role,
        ledgerAccountCode: '0',
        ...l,
      })),
    ),
  };

  return { tables, sequences, locks, dataSource, ledger, manager };
}

describe('provisionOrderForQuote', () => {
  it('bills a quote without a schedule exactly as before: one order, one invoice for everything', async () => {
    const w = makeWorld();

    const result = await provisionOrderForQuote(
      w.dataSource,
      w.ledger,
      tenantId,
      'q1',
    );

    expect(result.isNew).toBe(true);
    expect(result.order.orderNumber).toMatch(/^SO-\d{4}-0001$/);
    expect(w.tables.SalesOrderLine).toHaveLength(1); // the section line is not something to fulfil
    expect(w.tables.Invoice).toHaveLength(1);

    const [invoice] = w.tables.Invoice;
    expect(invoice.amount).toBe(1200);
    expect(invoice.stageLabel).toBeNull();
    expect(invoice.items).toHaveLength(2);
    // Cost is internal and must not ride along onto a customer document.
    expect(invoice.items[0].cost).toBeUndefined();
    expect(invoice.salesOrderId).toBe(result.order.id);
    expect(w.tables.BillingScheduleLine[0].invoiceId).toBe(invoice.id);
  });

  it('posts the receivable when the invoice is issued, and the entry balances', async () => {
    const w = makeWorld();
    await provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1');

    const [entry] = w.tables.JournalEntry;
    expect(entry.referenceType).toBe('INVOICE');
    expect(entry.lines.map((l: any) => [l.role, l.debit, l.credit])).toEqual([
      ['ACCOUNTS_RECEIVABLE', 1200, 0],
      ['SALES', 0, 1000],
      ['TAX_PAYABLE', 0, 200],
    ]);
    expect(isBalanced(entry.lines)).toBe(true);
  });

  it('raises only the deposit on approval, as a single descriptive line', async () => {
    const schedule: BillingStage[] = [
      {
        kind: 'DEPOSIT',
        label: '30% deposit',
        percent: 30,
        trigger: 'ON_APPROVAL',
      },
      { kind: 'FINAL', label: 'Balance', percent: 70, trigger: 'MANUAL' },
    ];
    const w = makeWorld({ billingSchedule: schedule });

    const result = await provisionOrderForQuote(
      w.dataSource,
      w.ledger,
      tenantId,
      'q1',
    );

    expect(result.invoicesRaised).toHaveLength(1);
    const [deposit] = w.tables.Invoice;
    expect(deposit.amount).toBe(360);
    expect(deposit.taxAmount).toBe(60);
    expect(deposit.stageLabel).toBe('30% deposit');
    expect(deposit.items).toEqual([
      expect.objectContaining({
        description: '30% deposit (30% of QT-2026-0007)',
        unitPrice: 300,
        taxRate: 20,
        subtotal: 300,
      }),
    ]);
    const [, balance] = w.tables.BillingScheduleLine;
    expect(balance.totalAmount).toBe(840);
    expect(balance.invoiceId).toBeNull();
  });

  it('takes a fixed deposit as a tax invoice for that amount, and bills the rest net of it', async () => {
    const schedule: BillingStage[] = [
      {
        kind: 'DEPOSIT',
        label: 'Deposit',
        percent: 41.67,
        amount: 500,
        trigger: 'ON_APPROVAL',
      },
      { kind: 'FINAL', label: 'Balance', percent: 58.33, trigger: 'MANUAL' },
    ];
    const w = makeWorld({ billingSchedule: schedule });

    await provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1');
    const [deposit] = w.tables.Invoice;
    expect(deposit.amount).toBe(500);
    expect(deposit.taxAmount).toBeCloseTo(83.33, 2);
    expect(deposit.subtotalAmount).toBe(416.67);
    expect(deposit.subtotalAmount + deposit.taxAmount).toBeCloseTo(500, 9);

    const { invoice: final } = await raiseStageInvoice(
      w.dataSource,
      w.ledger,
      tenantId,
      w.tables.BillingScheduleLine[1].id,
    );
    expect(final.amount).toBe(700);
    expect(deposit.taxAmount + final.taxAmount).toBeCloseTo(200, 2);
  });

  /**
   * Every stage invoice has to agree with itself and with the books: its net
   * plus its VAT is its total, the net is what the journal credits to sales,
   * and the tax breakdown the VAT return reads carries the same net and tax.
   */
  const expectInvoiceAgrees = (
    w: ReturnType<typeof makeWorld>,
    invoice: any,
  ) => {
    const c = (n: number) => Math.round(n * 100);
    expect(c(invoice.subtotalAmount) + c(invoice.taxAmount)).toBe(
      c(invoice.amount),
    );
    const sum = (key: 'net' | 'tax') =>
      invoice.taxBreakdown.reduce((s: number, b: any) => s + c(b[key]), 0);
    expect(sum('net')).toBe(c(invoice.subtotalAmount));
    expect(sum('tax')).toBe(c(invoice.taxAmount));
    const entry = w.tables.JournalEntry.find(
      (e) => e.referenceId === invoice.id,
    );
    expect(entry.lines.map((l: any) => [l.role, l.debit, l.credit])).toEqual([
      ['ACCOUNTS_RECEIVABLE', invoice.amount, 0],
      ['SALES', 0, invoice.subtotalAmount],
      ['TAX_PAYABLE', 0, invoice.taxAmount],
    ]);
  };

  const DISCOUNTED = {
    items: [
      {
        id: 'l1',
        type: 'product',
        description: 'Fascia sign',
        quantity: 10,
        unitPrice: 1000,
        discount: 20,
        taxRate: 5,
        subtotal: 8000,
      },
    ] as QuoteLineItem[],
    subtotalAmount: 8000,
    discountAmount: 2000,
    taxAmount: 400,
    totalAmount: 8400,
  };
  const fixedDeposit: BillingStage[] = [
    {
      kind: 'DEPOSIT',
      label: 'Deposit',
      percent: 50,
      amount: 4200,
      trigger: 'ON_APPROVAL',
    },
    { kind: 'FINAL', label: 'Balance', percent: 50, trigger: 'MANUAL' },
  ];

  // A quote's subtotal is already after its discount. Adding the discount
  // back gave this deposit a net of 5,000 against the 4,000 the journal put
  // to sales, and the VAT return read the 5,000.
  it('gives a fixed deposit on a discounted quote the net its total and tax leave', async () => {
    const w = makeWorld({ ...DISCOUNTED, billingSchedule: fixedDeposit });

    await provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1');
    const [deposit] = w.tables.Invoice;
    expect([
      deposit.subtotalAmount,
      deposit.discountAmount,
      deposit.taxAmount,
      deposit.amount,
    ]).toEqual([4000, 1000, 200, 4200]);
    expect(deposit.items[0]).toEqual(
      expect.objectContaining({ unitPrice: 4000, subtotal: 4000, taxRate: 5 }),
    );
    expectInvoiceAgrees(w, deposit);

    const { invoice: final } = await raiseStageInvoice(
      w.dataSource,
      w.ledger,
      tenantId,
      w.tables.BillingScheduleLine[1].id,
    );
    expect([
      final.subtotalAmount,
      final.discountAmount,
      final.taxAmount,
      final.amount,
    ]).toEqual([4000, 1000, 200, 4200]);
    expectInvoiceAgrees(w, final);
  });

  // 2,416.67 + 120.84 was printed over a total of 2,537.50.
  it('keeps net + VAT equal to the total on each half of an odd amount', async () => {
    const w = makeWorld({
      items: [{ ...ITEMS[0], quantity: 1, unitPrice: 4833.33, taxRate: 5 }],
      subtotalAmount: 4833.33,
      taxAmount: 241.67,
      totalAmount: 5075,
      billingSchedule: [
        { kind: 'DEPOSIT', label: '50%', percent: 50, trigger: 'ON_APPROVAL' },
        { kind: 'FINAL', label: 'Balance', percent: 50, trigger: 'MANUAL' },
      ],
    });

    await provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1');
    const { invoice: final } = await raiseStageInvoice(
      w.dataSource,
      w.ledger,
      tenantId,
      w.tables.BillingScheduleLine[1].id,
    );
    const [deposit] = w.tables.Invoice;

    expect([deposit.subtotalAmount, deposit.taxAmount, deposit.amount]).toEqual(
      [2416.66, 120.84, 2537.5],
    );
    expect([final.subtotalAmount, final.taxAmount, final.amount]).toEqual([
      2416.67, 120.83, 2537.5,
    ]);
    expectInvoiceAgrees(w, deposit);
    expectInvoiceAgrees(w, final);
  });

  // An order accepted before the split was put right still has its unbilled
  // stages stored the old way. Its invoice is raised right all the same.
  it('bills a stage stored by the old split with the net its total and tax leave', async () => {
    const w = makeWorld({ ...DISCOUNTED, billingSchedule: fixedDeposit });
    await provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1');
    const balance = w.tables.BillingScheduleLine[1];
    balance.subtotalAmount = 3000;

    const { invoice } = await raiseStageInvoice(
      w.dataSource,
      w.ledger,
      tenantId,
      balance.id,
    );

    expect(invoice.subtotalAmount).toBe(4000);
    expect(invoice.items[0]).toEqual(
      expect.objectContaining({ unitPrice: 4000, subtotal: 4000 }),
    );
    expect(balance.subtotalAmount).toBe(4000);
    expectInvoiceAgrees(w, invoice);
  });

  // The margin report shares an order's revenue across its lines by line
  // total. A quote saved without line subtotals gave lines worth nothing.
  it('works out each order line total itself, whatever subtotal the quote line carries', async () => {
    const line = (id: string, subtotal?: number): QuoteLineItem => ({
      id,
      type: 'product',
      description: 'Lightbox',
      quantity: 4,
      unitPrice: 250,
      discount: 10,
      taxRate: 5,
      ...(subtotal === undefined ? {} : { subtotal }),
    });
    const w = makeWorld({
      items: [line('none'), line('wrong', 1), line('right', 900)],
      subtotalAmount: 2700,
      discountAmount: 300,
      taxAmount: 135,
      totalAmount: 2835,
    });

    await provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1');

    expect(w.tables.SalesOrderLine.map((l) => l.lineTotal)).toEqual([
      900, 900, 900,
    ]);
    const [invoice] = w.tables.Invoice;
    expect(invoice.items.map((i: QuoteLineItem) => i.subtotal)).toEqual([
      900, 900, 900,
    ]);
    expectInvoiceAgrees(w, invoice);
  });

  it('raises nothing when every stage waits for a milestone', async () => {
    const w = makeWorld({
      billingSchedule: [
        {
          kind: 'MILESTONE',
          label: 'Proofs signed off',
          percent: 50,
          trigger: 'MANUAL',
        },
        { kind: 'FINAL', label: 'Delivery', percent: 50, trigger: 'MANUAL' },
      ],
    });

    const result = await provisionOrderForQuote(
      w.dataSource,
      w.ledger,
      tenantId,
      'q1',
    );

    expect(result.invoices).toEqual([]);
    expect(w.sequences.invoice_number).toBeUndefined();
  });

  it('is idempotent: the second caller finds the order and bills nothing, without burning numbers', async () => {
    // The sync approval and the Temporal activity both run this.
    const w = makeWorld();
    await provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1');
    const again = await provisionOrderForQuote(
      w.dataSource,
      w.ledger,
      tenantId,
      'q1',
    );

    expect(again.isNew).toBe(false);
    expect(again.invoicesRaised).toEqual([]);
    expect(again.invoices).toHaveLength(1);
    expect(w.tables.SalesOrder).toHaveLength(1);
    expect(w.tables.Invoice).toHaveLength(1);
    expect(w.sequences).toEqual({ sales_order_number: 1, invoice_number: 1 });
  });

  it('locks the quote before anything else', async () => {
    const w = makeWorld();
    await provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1');
    expect(w.locks[0]).toBe('Quote');
  });

  it('refuses a superseded quote', async () => {
    const w = makeWorld({ supersededAt: new Date() });
    await expect(
      provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(w.tables.SalesOrder).toHaveLength(0);
  });

  it('refuses a schedule that does not bill 100%', async () => {
    const w = makeWorld({
      billingSchedule: [
        {
          kind: 'FINAL',
          label: 'Most of it',
          percent: 90,
          trigger: 'ON_APPROVAL',
        },
      ],
    });
    await expect(
      provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1'),
    ).rejects.toThrow(/add up to 90%/);
  });

  // Approval marks the quote approved and provisions in one transaction, so
  // a quote is never left approved with no order behind it.
  it('can run inside a caller’s transaction instead of opening its own', async () => {
    const w = makeWorld();
    const transaction = jest.fn();
    w.dataSource.transaction = transaction;

    const result = await provisionOrderForQuoteInTransaction(
      w.manager,
      w.ledger,
      tenantId,
      'q1',
    );

    expect(transaction).not.toHaveBeenCalled();
    expect(result.isNew).toBe(true);
    expect(w.tables.SalesOrder).toHaveLength(1);
  });

  it('does not let one tenant provision another tenant’s quote', async () => {
    const w = makeWorld();
    await expect(
      provisionOrderForQuote(
        w.dataSource,
        w.ledger,
        '99999999-9999-9999-9999-999999999999',
        'q1',
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe('raiseStageInvoice', () => {
  const staged = () =>
    makeWorld({
      billingSchedule: [
        {
          kind: 'DEPOSIT',
          label: 'Deposit',
          percent: 30,
          trigger: 'ON_APPROVAL',
        },
        { kind: 'FINAL', label: 'Balance', percent: 70, trigger: 'MANUAL' },
      ],
    });

  it('bills the balance so the two invoices add up to the quote to the cent', async () => {
    const w = staged();
    await provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1');
    const balance = w.tables.BillingScheduleLine[1];

    const { invoice, isNew } = await raiseStageInvoice(
      w.dataSource,
      w.ledger,
      tenantId,
      balance.id,
    );

    expect(isNew).toBe(true);
    expect(invoice.amount).toBe(840);
    const total =
      w.tables.Invoice.reduce((sum, i) => sum + i.amount * 100, 0) / 100;
    expect(total).toBe(1200);
  });

  it('returns the existing invoice for a stage already billed, and allocates no number', async () => {
    const w = staged();
    await provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1');
    const deposit = w.tables.BillingScheduleLine[0];

    const { isNew } = await raiseStageInvoice(
      w.dataSource,
      w.ledger,
      tenantId,
      deposit.id,
    );

    expect(isNew).toBe(false);
    expect(w.tables.Invoice).toHaveLength(1);
    expect(w.sequences.invoice_number).toBe(1);
  });

  /**
   * `OrdersService.cancel` locks the order and then checks for invoices. If
   * this path billed a stage off an unlocked read of the order, a cancel and
   * an invoice could each pass their check and both commit: a cancelled
   * order carrying a live invoice. Order first, then stage — the same order
   * cancel takes them in, so the two serialise instead of deadlocking.
   */
  it('locks the order before the stage, so it serialises with cancel', async () => {
    const w = staged();
    await provisionOrderForQuote(w.dataSource, w.ledger, tenantId, 'q1');
    w.locks.length = 0;

    await raiseStageInvoice(
      w.dataSource,
      w.ledger,
      tenantId,
      w.tables.BillingScheduleLine[1].id,
    );

    expect(w.locks).toEqual(['SalesOrder', 'BillingScheduleLine']);
  });

  it('refuses to invoice a cancelled order', async () => {
    const w = staged();
    const { order } = await provisionOrderForQuote(
      w.dataSource,
      w.ledger,
      tenantId,
      'q1',
    );
    order.status = 'CANCELLED';

    await expect(
      raiseStageInvoice(
        w.dataSource,
        w.ledger,
        tenantId,
        w.tables.BillingScheduleLine[1].id,
      ),
    ).rejects.toThrow(/cancelled/);
  });
});
