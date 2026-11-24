import { fakeRepository } from '@/common/testing/fake-repository';
import { CreditNoteRefund } from '../credits/entities/credit-note.entity';
import { InvoicePayment } from '../quotes/entities/invoice-payment.entity';
import { ReportsService } from './reports.service';

const tenantId = 't1';
const AR = 'ledger-ar';
const day = (d: string) => new Date(`${d}T23:59:59.999Z`);
const at = (d: string) => new Date(`${d}T09:00:00Z`);

interface World {
  invoices: any[];
  payments?: any[];
  credits?: any[];
  refunds?: any[];
  /** Receivables movements as [date, debit - credit], in base currency. */
  ledger: [Date, number][];
}

/** The ledger is real arithmetic over dated movements, so agreement with it is tested. */
function makeService(world: World) {
  const repos = new Map<unknown, unknown>([
    [InvoicePayment, fakeRepository(world.payments ?? [])],
    [CreditNoteRefund, fakeRepository(world.refunds ?? [])],
  ]);
  const manager = {
    getRepository: (entity: unknown) =>
      repos.get(entity) ?? {
        findOne: () => Promise.resolve({ baseCurrency: 'AED' }),
      },
  };
  const ledger = {
    byRole: jest.fn(async () => ({ id: AR })),
    trialBalance: jest.fn(async (_t: string, asOf: Date) => ({
      rows: [
        {
          ledgerAccountId: AR,
          balance:
            world.ledger
              .filter(([date]) => date.getTime() <= asOf.getTime())
              .reduce((s, [, amount]) => s + Math.round(amount * 100), 0) / 100,
        },
      ],
    })),
  };
  return new ReportsService(
    { manager } as never,
    {} as never,
    { ...fakeRepository(world.invoices), manager } as never,
    fakeRepository(world.credits ?? []) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    ledger as never,
  );
}

const invoice = (overrides: any = {}) => ({
  id: 'inv-1',
  tenantId,
  invoiceNumber: 'INV-2026-0001',
  customerName: 'Al Noor Trading',
  currency: 'AED',
  fxRate: 1,
  status: 'ISSUED',
  amount: 1050,
  paidAmount: 0,
  paidAt: null,
  creditedAmount: 0,
  refundedAmount: 0,
  issuedAt: at('2026-03-01'),
  dueDate: at('2026-03-31'),
  voidedAt: null,
  ...overrides,
});

describe('ReportsService.receivablesAging as of a past date', () => {
  // Today: paid in full, then credited 105 with 50 of that refunded.
  const world: World = {
    invoices: [invoice({ status: 'PAID', paidAmount: 1050, creditedAmount: 105, refundedAmount: 50 })],
    payments: [
      { tenantId, invoiceId: 'inv-1', amount: 400, paidAt: at('2026-03-10') },
      { tenantId, invoiceId: 'inv-1', amount: 650, paidAt: at('2026-04-20') },
    ],
    credits: [{ tenantId, invoiceId: 'inv-1', status: 'ISSUED', totalAmount: 105, issuedAt: at('2026-04-25') }],
    refunds: [{ tenantId, invoiceId: 'inv-1', amount: 50, refundedAt: at('2026-04-28') }],
    ledger: [
      [at('2026-03-01'), 1050],
      [at('2026-03-10'), -400],
      [at('2026-04-20'), -650],
      [at('2026-04-25'), -105],
      [at('2026-04-28'), 50],
    ],
  };

  it.each([
    ['2026-02-28', 0, 'not yet issued'],
    ['2026-03-05', 1050, 'issued, nothing paid'],
    ['2026-03-10', 650, 'part paid'],
    ['2026-04-19', 650, 'the day before it was settled'],
    ['2026-04-20', 0, 'settled'],
    ['2026-04-25', -105, 'credited after payment'],
    ['2026-04-28', -55, 'part of the credit refunded'],
  ])('on %s the customer owes %d (%s), as the ledger says', async (date, owed) => {
    const report = await makeService(world).receivablesAging(tenantId, day(date));
    expect(report.total).toBe(owed);
    expect(report.ledgerBalance).toBe(owed);
    expect(report.difference).toBe(0);
    expect(report.rows.map((r) => r.outstanding)).toEqual(owed ? [owed] : []);
  });

  it('ages by the date asked about, not by today', async () => {
    const service = makeService(world);
    expect((await service.receivablesAging(tenantId, day('2026-03-31'))).buckets.CURRENT).toBe(650);
    const late = await service.receivablesAging(tenantId, day('2026-04-19'));
    expect(late.buckets.DAYS_1_30).toBe(650);
    expect(late.rows[0].daysOverdue).toBe(19);
  });

  it('shows money owed back to a customer as a credit, outside the overdue columns', async () => {
    const report = await makeService(world).receivablesAging(tenantId, day('2026-06-30'));
    expect(report.rows[0]).toMatchObject({ outstanding: -55, bucket: 'CURRENT', daysOverdue: 0 });
    expect(report.customerCredits).toBe(55);
    expect(Object.values(report.buckets).every((v) => v === 0)).toBe(true);
    expect(report.total).toBe(-55);
    expect(report.difference).toBe(0);
  });

  it('counts a voided invoice until the day it was voided', async () => {
    const voided: World = {
      invoices: [invoice({ status: 'CANCELLED', voidedAt: at('2026-03-15') })],
      ledger: [
        [at('2026-03-01'), 1050],
        [at('2026-03-15'), -1050],
      ],
    };
    const before = await makeService(voided).receivablesAging(tenantId, day('2026-03-14'));
    expect(before.total).toBe(1050);
    expect(before.difference).toBe(0);
    const after = await makeService(voided).receivablesAging(tenantId, day('2026-03-15'));
    expect(after.rows).toEqual([]);
    expect(after.difference).toBe(0);
  });

  // Recorded before payment dates were checked: paid 40 days before the invoice.
  it('agrees with the ledger for a payment already stored with a date before its invoice', async () => {
    const early: World = {
      invoices: [invoice({ status: 'PAID', amount: 50, paidAmount: 50, issuedAt: at('2026-03-01') })],
      payments: [{ tenantId, invoiceId: 'inv-1', amount: 50, paidAt: at('2026-01-20') }],
      ledger: [
        [at('2026-01-20'), -50],
        [at('2026-03-01'), 50],
      ],
    };
    const between = await makeService(early).receivablesAging(tenantId, day('2026-02-19'));
    expect(between.total).toBe(-50);
    expect(between.ledgerBalance).toBe(-50);
    expect(between.difference).toBe(0);
    expect(between.customerCredits).toBe(50);
  });

  it('converts each invoice at its own booked rate', async () => {
    const foreign: World = {
      invoices: [invoice({ currency: 'USD', fxRate: 3.6725, amount: 200 })],
      payments: [{ tenantId, invoiceId: 'inv-1', amount: 200, paidAt: at('2026-03-20') }],
      ledger: [
        [at('2026-03-01'), 734.5],
        [at('2026-03-20'), -734.5],
      ],
    };
    const open = await makeService(foreign).receivablesAging(tenantId, day('2026-03-19'));
    expect(open.rows[0]).toMatchObject({ outstanding: 200, currency: 'USD', outstandingBase: 734.5 });
    expect(open.difference).toBe(0);
    const paid = await makeService(foreign).receivablesAging(tenantId, day('2026-03-20'));
    expect(paid.rows).toEqual([]);
    expect(paid.difference).toBe(0);
  });
});
