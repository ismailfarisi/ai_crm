import { FindOperator } from 'typeorm';
import { CustomerLookupService } from './customer-lookup.service';

/**
 * One organization with two customers, and a second organization, each with
 * orders and quotes. Everything is asked as Al Noor (cust-a); nothing of
 * Gulf Print's (cust-b) or the other organization's may come back.
 */

const ORG = 'org-1';
const D = (iso: string) => new Date(`${iso}T08:00:00Z`);

type Row = Record<string, unknown>;

function meets(actual: unknown, expected: unknown): boolean {
  if (expected instanceof FindOperator) {
    if (expected.type === 'in')
      return (expected.value as unknown[]).includes(actual);
    if (expected.type === 'isNull') return actual == null;
    if (expected.type === 'not') return !meets(actual, expected.value);
    throw new Error(`Unhandled operator ${expected.type}`);
  }
  return actual === expected;
}

/** A repository over rows in memory that records every `where` it is given. */
function repo(rows: Row[]) {
  const wheres: Row[] = [];
  return {
    wheres,
    find: jest.fn(
      async (options: {
        where: Row;
        order?: Record<string, 'ASC' | 'DESC'>;
        take?: number;
      }) => {
        wheres.push(options.where);
        let out = rows.filter((row) =>
          Object.entries(options.where).every(([key, value]) =>
            meets(row[key], value),
          ),
        );
        const [by, direction] = Object.entries(options.order ?? {})[0] ?? [];
        if (by) {
          out = [...out].sort(
            (a, b) =>
              (Number(a[by]) - Number(b[by])) * (direction === 'DESC' ? -1 : 1),
          );
        }
        return options.take ? out.slice(0, options.take) : out;
      },
    ),
  };
}

function setup() {
  const order = (over: Row): Row => ({
    tenantId: ORG,
    customerId: 'cust-a',
    quoteId: 'q-a1',
    quoteNumber: 'Q-0001',
    status: 'IN_PRODUCTION',
    currency: 'AED',
    totalAmount: 5250,
    createdAt: D('2026-10-01'),
    notes: 'Margin is thin, do not discount',
    cancelReason: null,
    ...over,
  });
  const orders = repo([
    order({ id: 'o-a1', orderNumber: 'SO-0007' }),
    order({
      id: 'o-a2',
      orderNumber: 'SO-0009',
      quoteId: 'q-a2',
      quoteNumber: 'Q-0004',
      status: 'OPEN',
      createdAt: D('2026-11-01'),
    }),
    order({
      id: 'o-b1',
      orderNumber: 'SO-0042',
      customerId: 'cust-b',
      quoteId: 'q-b1',
      quoteNumber: 'Q-0010',
      totalAmount: 99000,
    }),
    order({
      id: 'o-x1',
      orderNumber: 'SO-0500',
      tenantId: 'org-2',
      customerId: 'cust-x',
      quoteId: 'q-x1',
      totalAmount: 77000,
    }),
    // An order with no customer on it belongs to nobody a sender can be.
    order({ id: 'o-n1', orderNumber: 'SO-0600', customerId: null }),
  ]);
  const lines = repo([
    {
      tenantId: ORG,
      salesOrderId: 'o-a1',
      sequence: 1,
      description: 'Rigid gift box 20x20',
      qtyOrdered: 500,
      qtyFulfilled: 200,
      unitPrice: 10,
    },
    {
      tenantId: ORG,
      salesOrderId: 'o-b1',
      sequence: 1,
      description: 'Gulf Print secret launch sleeve',
      qtyOrdered: 9000,
      qtyFulfilled: 0,
    },
  ]);
  const invoice = (over: Row): Row => ({
    tenantId: ORG,
    salesOrderId: 'o-a1',
    status: 'ISSUED',
    amount: 2625,
    paidAmount: null,
    creditedAmount: 0,
    refundedAmount: 0,
    dueDate: D('2026-11-30'),
    ...over,
  });
  const invoices = repo([
    invoice({ id: 'i-a1', status: 'PAID', paidAmount: 2625 }),
    invoice({ id: 'i-a2', paidAmount: 625, status: 'PARTIALLY_PAID' }),
    invoice({ id: 'i-a3', status: 'CANCELLED', amount: 9999 }),
    invoice({ id: 'i-b1', salesOrderId: 'o-b1', amount: 99000 }),
  ]);
  const workOrders = repo([
    {
      tenantId: ORG,
      salesOrderId: 'o-a1',
      status: 'IN_PROGRESS',
      dueDate: D('2026-12-05'),
    },
    {
      tenantId: ORG,
      salesOrderId: 'o-a1',
      status: 'CANCELLED',
      dueDate: D('2027-01-01'),
    },
    {
      tenantId: ORG,
      salesOrderId: 'o-b1',
      status: 'PLANNED',
      dueDate: D('2026-12-25'),
    },
  ]);
  const deliveries = repo([
    {
      tenantId: ORG,
      salesOrderId: 'o-a1',
      status: 'DISPATCHED',
      dispatchedAt: D('2026-11-10'),
      carrier: 'Aramex',
      trackingReference: 'AX123',
      shipTo: 'Warehouse 4',
    },
    { tenantId: ORG, salesOrderId: 'o-a1', status: 'DRAFT', carrier: 'Draft' },
    {
      tenantId: ORG,
      salesOrderId: 'o-b1',
      status: 'DISPATCHED',
      dispatchedAt: D('2026-11-11'),
      carrier: 'GulfPrintCarrier',
    },
  ]);
  const quote = (over: Row): Row => ({
    tenantId: ORG,
    customerId: 'cust-a',
    status: 'APPROVED',
    title: 'Gift boxes',
    currency: 'AED',
    totalAmount: 5250,
    validUntil: D('2099-01-01'),
    acceptedAt: null,
    customerResponse: null,
    supersededAt: null,
    createdAt: D('2026-09-01'),
    notes: 'internal note',
    ...over,
  });
  const quotes = repo([
    quote({ id: 'q-a1', quoteNumber: 'Q-0001', acceptedAt: D('2026-09-20') }),
    quote({
      id: 'q-a3',
      quoteNumber: 'Q-0005',
      status: 'DRAFT',
      title: 'Ramadan sleeves',
      totalAmount: 1234.5,
      createdAt: D('2026-11-05'),
    }),
    quote({
      id: 'q-a4',
      quoteNumber: 'Q-0002',
      supersededAt: D('2026-09-10'),
      title: 'Old revision',
    }),
    quote({
      id: 'q-a5',
      quoteNumber: 'Q-0006',
      validUntil: D('2026-01-01'),
      createdAt: D('2026-10-10'),
    }),
    quote({
      id: 'q-b1',
      quoteNumber: 'Q-0010',
      customerId: 'cust-b',
      title: 'Gulf Print secret launch',
      totalAmount: 99000,
    }),
    quote({
      id: 'q-x1',
      quoteNumber: 'Q-0500',
      tenantId: 'org-2',
      customerId: 'cust-x',
      title: 'Other organization',
    }),
  ]);
  const service = new CustomerLookupService(
    orders as never,
    lines as never,
    invoices as never,
    quotes as never,
    workOrders as never,
    deliveries as never,
  );
  return {
    service,
    repos: { orders, lines, invoices, workOrders, deliveries, quotes },
  };
}

/** Anything of Gulf Print's or the other organization's. */
const NOT_THEIRS = [
  'SO-0042',
  'SO-0500',
  'SO-0600',
  'Q-0010',
  'Q-0500',
  'Gulf Print',
  '99000',
  '77000',
  'GulfPrintCarrier',
  '2026-12-25',
  'Other organization',
];
const expectNothingOfAnyoneElse = (result: unknown) => {
  const said = JSON.stringify(result);
  for (const secret of NOT_THEIRS) expect(said).not.toContain(secret);
};

describe('CustomerLookupService', () => {
  describe('orders', () => {
    it('gives a customer their own order: status, delivered, due date and balance', async () => {
      const { service } = setup();
      const result = await service.orders(ORG, 'cust-a', 'so-0007');

      expect(result).toEqual({
        askedFor: 'so-0007',
        found: true,
        records: [
          {
            orderNumber: 'SO-0007',
            status: 'In production',
            placedOn: '2026-10-01',
            currency: 'AED',
            total: 5250,
            items: [
              {
                description: 'Rigid gift box 20x20',
                ordered: 500,
                delivered: 200,
              },
            ],
            productionDueOn: '2026-12-05',
            deliveries: [
              {
                dispatchedOn: '2026-11-10',
                carrier: 'Aramex',
                trackingReference: 'AX123',
              },
            ],
            paid: 3250,
            balanceDue: 2000,
            balanceDueOn: '2026-11-30',
          },
        ],
      });
    });

    it('leaves out what is for staff only', async () => {
      const { service } = setup();
      const said = JSON.stringify(await service.orders(ORG, 'cust-a'));
      expect(said).not.toContain('Margin is thin');
      expect(said).not.toContain('unitPrice');
      expect(said).not.toContain('Warehouse 4');
    });

    it('lists only their own orders, newest first, when no number is given', async () => {
      const { service } = setup();
      const result = await service.orders(ORG, 'cust-a');
      expect(result.records.map((o) => o.orderNumber)).toEqual([
        'SO-0009',
        'SO-0007',
      ]);
      expectNothingOfAnyoneElse(result);
    });

    it.each(['7', '0007', '#SO-0007', 'so 0007', 'Q-0001'])(
      'finds their order when they write %p',
      async (asked) => {
        const { service } = setup();
        const result = await service.orders(ORG, 'cust-a', asked);
        expect(result.found).toBe(true);
        expect(result.records.map((o) => o.orderNumber)).toEqual(['SO-0007']);
      },
    );

    it("answers another customer's order number exactly as a number that does not exist", async () => {
      const { service } = setup();
      const strip = (r: { askedFor: string | null }) => ({
        ...r,
        askedFor: null,
      });

      const invented = await service.orders(ORG, 'cust-a', 'SO-9999');
      for (const theirs of ['SO-0042', '42', 'Q-0010', 'SO-0500', 'SO-0600']) {
        const result = await service.orders(ORG, 'cust-a', theirs);
        expect(result.found).toBe(false);
        expect(strip(result)).toEqual(strip(invented));
        expectNothingOfAnyoneElse({ ...result, askedFor: null });
      }
    });

    it('never asks the database for a row outside the customer', async () => {
      const { service, repos } = setup();
      await service.orders(ORG, 'cust-a', 'SO-0042');
      await service.orders(ORG, 'cust-a');

      for (const where of repos.orders.wheres) {
        expect(where).toMatchObject({ tenantId: ORG, customerId: 'cust-a' });
        // The number typed is matched in code, inside those rows.
        expect(where).not.toHaveProperty('orderNumber');
      }
      for (const child of [
        repos.lines,
        repos.invoices,
        repos.workOrders,
        repos.deliveries,
      ]) {
        expect(child.wheres.length).toBeGreaterThan(0);
        for (const where of child.wheres) {
          expect(where.tenantId).toBe(ORG);
          const ids = (where.salesOrderId as FindOperator<string>).value;
          expect([...(ids as unknown as string[])].sort()).toEqual([
            'o-a1',
            'o-a2',
          ]);
        }
      }
    });

    it('gives a customer with no orders an empty answer', async () => {
      const { service, repos } = setup();
      await expect(
        service.orders(ORG, 'cust-none', 'SO-0042'),
      ).resolves.toEqual({
        askedFor: 'SO-0042',
        found: false,
        records: [],
      });
      expect(repos.lines.find).not.toHaveBeenCalled();
    });

    it("sees nothing of the customer's from another organization", async () => {
      const { service } = setup();
      const result = await service.orders('org-2', 'cust-a');
      expect(result.records).toEqual([]);
    });
  });

  describe('quotes', () => {
    it('gives their own quotes, without superseded revisions', async () => {
      const { service } = setup();
      const result = await service.quotes(ORG, 'cust-a');

      expect(result.records).toEqual([
        {
          quoteNumber: 'Q-0005',
          title: 'Ramadan sleeves',
          status: 'Being prepared, not sent yet',
        },
        {
          quoteNumber: 'Q-0006',
          title: 'Gift boxes',
          status: 'Expired on 2026-01-01',
          currency: 'AED',
          total: 5250,
          validUntil: '2026-01-01',
          orderNumber: null,
        },
        {
          quoteNumber: 'Q-0001',
          title: 'Gift boxes',
          status: 'Accepted on 2026-09-20',
          currency: 'AED',
          total: 5250,
          validUntil: '2099-01-01',
          orderNumber: 'SO-0007',
        },
      ]);
      expectNothingOfAnyoneElse(result);
    });

    it('says nothing of the figures on a quote that is not approved', async () => {
      const { service } = setup();
      const said = JSON.stringify(
        await service.quotes(ORG, 'cust-a', 'Q-0005'),
      );
      expect(said).not.toContain('1234.5');
      expect(said).not.toContain('internal note');
    });

    it("answers another customer's quote number exactly as a number that does not exist", async () => {
      const { service, repos } = setup();
      const strip = (r: { askedFor: string | null }) => ({
        ...r,
        askedFor: null,
      });

      const invented = await service.quotes(ORG, 'cust-a', 'Q-9999');
      for (const theirs of ['Q-0010', '10', 'Q-0500', 'Q-0002']) {
        const result = await service.quotes(ORG, 'cust-a', theirs);
        expect(result.found).toBe(false);
        expect(strip(result)).toEqual(strip(invented));
        expectNothingOfAnyoneElse({ ...result, askedFor: null });
      }
      for (const where of [...repos.quotes.wheres, ...repos.orders.wheres]) {
        expect(where).toMatchObject({ tenantId: ORG, customerId: 'cust-a' });
        expect(where).not.toHaveProperty('quoteNumber');
      }
    });
  });
});
