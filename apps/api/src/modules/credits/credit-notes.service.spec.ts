import { BadRequestException, ConflictException } from '@nestjs/common';
import { isBalanced } from '@saas/shared';
import { CreditNotesService } from './credit-notes.service';

const tenantId = '11111111-1111-1111-1111-111111111111';

function makeWorld(invoiceOverrides: Record<string, unknown> = {}) {
  const tables: Record<string, any[]> = {
    Invoice: [
      {
        id: 'inv-1',
        tenantId,
        invoiceNumber: 'INV-2026-0001',
        customerId: null,
        customerName: 'Acme',
        currency: 'GBP',
        status: 'PAID',
        items: [],
        subtotalAmount: 1000,
        taxAmount: 200,
        amount: 1200,
        paidAmount: 1200,
        creditedAmount: 0,
        refundedAmount: 0,
        taxBreakdown: [
          {
            taxCodeId: 'std',
            code: 'STD',
            rate: 20,
            reverseCharge: false,
            net: 1000,
            tax: 200,
          },
        ],
        ...invoiceOverrides,
      },
    ],
    Organization: [{ id: tenantId, baseCurrency: 'GBP' }],
    CreditNote: [],
    CreditNoteLine: [],
    CreditNoteRefund: [],
    JournalEntry: [],
    FinanceAccount: [
      { id: 'bank', tenantId, name: 'Operating bank', balance: 5000 },
    ],
    TaxCode: [
      {
        id: 'std',
        tenantId,
        kind: 'SALES',
        code: 'STD',
        rate: 20,
        isReverseCharge: false,
        ledgerAccountId: null,
      },
    ],
  };
  let nextId = 1;
  let seq = 0;
  const queries: { sql: string; params: unknown[] }[] = [];

  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && '_type' in v
        ? v._type === 'in'
          ? (v._value as unknown[]).includes(row[k])
          : true
        : row[k] === v,
    );

  const repo = (name: string) => ({
    findOne: async ({ where }: any) =>
      tables[name].find((r) => matches(r, where)) ?? null,
    find: async ({ where }: any = {}) =>
      tables[name].filter((r) => matches(r, where)),
    create: (dto: any) => ({ ...dto }),
    save: async (rows: any) => {
      for (const row of Array.isArray(rows) ? rows : [rows]) {
        if (!row.id) {
          row.id = `${name}-${nextId++}`;
          row.createdAt = new Date();
          row.refundedAmount ??= 0;
          tables[name].push(row);
        }
      }
      return rows;
    },
    createQueryBuilder: () => {
      const params: Record<string, any> = {};
      const qb: any = {
        setLock: () => qb,
        where: (_: string, p: any = {}) => (Object.assign(params, p), qb),
        andWhere: (_: string, p: any = {}) => (Object.assign(params, p), qb),
        getOne: async () =>
          tables[name].find(
            (r) => r.id === params.id && r.tenantId === params.tenantId,
          ) ?? null,
      };
      return qb;
    },
  });

  const manager: any = {
    getRepository: (entity: { name: string }) => repo(entity.name),
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('tenant_sequences')) return [{ current_value: ++seq }];
      return [];
    },
  };
  const dataSource: any = {
    transaction: (cb: any) => cb(manager),
    getRepository: (entity: { name: string }) => repo(entity.name),
  };
  const ledger = {
    resolveLines: jest.fn(async (_t: string, lines: any[]) =>
      lines.map((l) => ({
        ledgerAccountId: l.role ?? l.financeAccountId,
        ledgerAccountCode: '0',
        ...l,
      })),
    ),
  };

  const service = new CreditNotesService(
    repo('CreditNote') as any,
    repo('CreditNoteLine') as any,
    repo('CreditNoteRefund') as any,
    repo('Invoice') as any,
    ledger as any,
    dataSource,
    {
      notifyHolders: jest.fn(async () => 0),
      resolve: jest.fn(async () => undefined),
    } as any,
  );
  return { service, tables, queries, invoice: tables.Invoice[0] };
}

const roles = (entry: any) =>
  entry.lines.map((l: any) => [
    l.role ?? l.financeAccountId,
    l.debit,
    l.credit,
  ]);

describe('CreditNotesService', () => {
  it('partially credits a paid invoice: sales and tax come down, receivables credited, invoice untouched otherwise', async () => {
    const w = makeWorld();
    const draft = await w.service.create(tenantId, 'u1', 'inv-1', {
      reason: 'Damaged carton',
      netAmount: 100,
      lines: null,
      full: false,
    });

    expect(draft.status).toBe('DRAFT');
    expect(draft.creditNoteNumber).toBe('Draft');
    expect([draft.subtotalAmount, draft.taxAmount, draft.totalAmount]).toEqual([
      100, 20, 120,
    ]);
    // Drafting changes nothing.
    expect(w.invoice.creditedAmount).toBe(0);
    expect(w.tables.JournalEntry).toHaveLength(0);

    const issued = await w.service.issue(tenantId, draft.id, 'u2');
    expect(issued.creditNoteNumber).toMatch(/^CN-\d{4}-0001$/);
    expect(w.invoice.creditedAmount).toBe(120);

    const [entry] = w.tables.JournalEntry;
    expect(entry.referenceType).toBe('CREDIT_NOTE');
    expect(roles(entry)).toEqual([
      ['SALES', 100, 0],
      ['TAX_PAYABLE', 20, 0],
      ['ACCOUNTS_RECEIVABLE', 0, 120],
    ]);
    expect(isBalanced(entry.lines)).toBe(true);
  });

  it('refunds only money actually received beyond what is owed, and moves the bank balance relatively', async () => {
    const w = makeWorld();
    const draft = await w.service.create(tenantId, 'u1', 'inv-1', {
      reason: 'Price agreed down',
      netAmount: 100,
      lines: null,
      full: false,
    });
    await w.service.issue(tenantId, draft.id, 'u2');

    await expect(
      w.service.refund(tenantId, draft.id, 'u3', {
        financeAccountId: 'bank',
        amount: 121,
        reference: null,
      }),
    ).rejects.toThrow(/At most 120.00/);

    const refunded = await w.service.refund(tenantId, draft.id, 'u3', {
      financeAccountId: 'bank',
      amount: null,
      reference: 'BACS',
    });
    expect(refunded.refundedAmount).toBe(120);
    expect(w.invoice.refundedAmount).toBe(120);
    const update = w.queries.find((q) =>
      q.sql.includes('UPDATE "finance_accounts"'),
    )!;
    expect(update.sql).toContain('"balance" = "balance" - $1');
    expect(update.params[0]).toBe(120);
    expect(roles(w.tables.JournalEntry[1])).toEqual([
      ['ACCOUNTS_RECEIVABLE', 120, 0],
      ['bank', 0, 120],
    ]);

    await expect(
      w.service.refund(tenantId, draft.id, 'u3', {
        financeAccountId: 'bank',
        amount: null,
        reference: null,
      }),
    ).rejects.toThrow(/refunded in full|not paid more/);
  });

  it('will not refund a credit on an unpaid invoice — the credit reduced the balance instead', async () => {
    const w = makeWorld({ paidAmount: 0, status: 'ISSUED' });
    const draft = await w.service.create(tenantId, 'u1', 'inv-1', {
      reason: 'Discount',
      netAmount: 100,
      lines: null,
      full: false,
    });
    await w.service.issue(tenantId, draft.id, 'u2');
    await expect(
      w.service.refund(tenantId, draft.id, 'u3', {
        financeAccountId: 'bank',
        amount: null,
        reference: null,
      }),
    ).rejects.toThrow(/has not paid more/);
  });

  it('refuses to credit more than was invoiced, and re-checks at issue against credits issued since', async () => {
    const w = makeWorld();
    await expect(
      w.service.create(tenantId, 'u1', 'inv-1', {
        reason: 'Too much',
        netAmount: 1001,
        lines: null,
        full: false,
      }),
    ).rejects.toThrow(/left to credit/);

    const a = await w.service.create(tenantId, 'u1', 'inv-1', {
      reason: 'First',
      netAmount: 600,
      lines: null,
      full: false,
    });
    const b = await w.service.create(tenantId, 'u1', 'inv-1', {
      reason: 'Second',
      netAmount: 600,
      lines: null,
      full: false,
    });
    await w.service.issue(tenantId, a.id, 'u2');
    await expect(w.service.issue(tenantId, b.id, 'u2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(w.invoice.creditedAmount).toBe(720);
  });

  it('credits the rest in full to the cent after a partial credit', async () => {
    const w = makeWorld({
      amount: 100,
      subtotalAmount: 83.33,
      taxAmount: 16.67,
      paidAmount: 0,
      status: 'ISSUED',
      taxBreakdown: [
        {
          taxCodeId: 'std',
          code: 'STD',
          rate: 20,
          reverseCharge: false,
          net: 83.33,
          tax: 16.67,
        },
      ],
    });
    const first = await w.service.create(tenantId, 'u1', 'inv-1', {
      reason: 'Part',
      netAmount: 33.33,
      lines: null,
      full: false,
    });
    await w.service.issue(tenantId, first.id, 'u2');
    const rest = await w.service.create(tenantId, 'u1', 'inv-1', {
      reason: 'Rest',
      netAmount: null,
      lines: null,
      full: true,
    });
    await w.service.issue(tenantId, rest.id, 'u2');

    expect(w.invoice.creditedAmount).toBe(100);
    expect(w.invoice.status).toBe('PAID');
    await expect(
      w.service.create(tenantId, 'u1', 'inv-1', {
        reason: 'Again',
        netAmount: null,
        lines: null,
        full: true,
      }),
    ).rejects.toThrow(/credited in full/);
  });

  it('credits itemised lines at the invoice rate when it has only one', async () => {
    const w = makeWorld();
    const draft = await w.service.create(tenantId, 'u1', 'inv-1', {
      reason: 'Two boxes crushed',
      netAmount: null,
      full: false,
      lines: [
        {
          description: 'Rigid box',
          qty: 2,
          unitPrice: 12.5,
          taxRate: null,
          taxCodeId: null,
        },
      ],
    });
    expect([draft.subtotalAmount, draft.taxAmount]).toEqual([25, 5]);
    expect(draft.lines[0].taxCode).toBe('STD');
  });

  it('will not cancel an issued credit note', async () => {
    const w = makeWorld();
    const draft = await w.service.create(tenantId, 'u1', 'inv-1', {
      reason: 'x',
      netAmount: 10,
      lines: null,
      full: false,
    });
    await w.service.issue(tenantId, draft.id, 'u2');
    await expect(w.service.cancel(tenantId, draft.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
