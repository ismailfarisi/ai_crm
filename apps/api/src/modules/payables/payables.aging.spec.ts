import { fakeRepository } from '@/common/testing/fake-repository';
import { ExpenseClaim } from '../finance/entities/expense-claim.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { PayablesService } from './payables.service';

const tenantId = '11111111-1111-1111-1111-111111111111';
const AP = 'ledger-ap';
const CLAIM = '22222222-2222-2222-2222-222222222222';
const day = (d: string) => new Date(`${d}T23:59:59.999Z`);

interface World {
  bills?: any[];
  payments?: any[];
  claims?: any[];
  journal?: any[];
}

/**
 * The ledger here is real arithmetic over the same journal rows the service
 * reads, so "agrees with the ledger" is tested, not assumed.
 */
function makeService(world: World) {
  const journal = world.journal ?? [];
  const ledger = {
    byRole: jest.fn(async () => ({ id: AP })),
    trialBalance: jest.fn(async (_t: string, asOf: Date) => {
      let cents = 0;
      for (const entry of journal) {
        if (entry.entryDate.getTime() > asOf.getTime()) continue;
        for (const line of entry.lines) {
          if (line.ledgerAccountId !== AP) continue;
          cents += Math.round(line.credit * 100) - Math.round(line.debit * 100);
        }
      }
      return { rows: [{ ledgerAccountId: AP, balance: cents / 100 }] };
    }),
  };
  const repos = new Map<unknown, unknown>([
    [JournalEntry, fakeRepository(journal)],
    [ExpenseClaim, fakeRepository(world.claims ?? [])],
  ]);
  return new PayablesService(
    fakeRepository(world.bills ?? []) as any,
    fakeRepository(world.payments ?? []) as any,
    ledger as any,
    { getRepository: (entity: unknown) => repos.get(entity) } as any,
    {} as any,
    {} as any,
  );
}

const bill = (overrides: any = {}) => ({
  id: 'bill-1',
  tenantId,
  billNumber: 'BILL-2026-0001',
  supplierName: 'Papertree Ltd',
  status: 'APPROVED',
  deletedAt: null,
  currency: 'AED',
  fxRate: 1,
  billDate: new Date('2026-03-01T00:00:00Z'),
  dueDate: new Date('2026-03-31T00:00:00Z'),
  totalAmount: 1000,
  paidAmount: 0,
  ...overrides,
});

const billEntry = (b: any) => ({
  tenantId,
  referenceType: 'BILL',
  referenceId: b.id,
  entryDate: b.billDate,
  lines: [
    { ledgerAccountId: 'ledger-expense', debit: b.totalAmount * b.fxRate, credit: 0 },
    { ledgerAccountId: AP, debit: 0, credit: b.totalAmount * b.fxRate },
  ],
});

const paymentEntry = (billId: string, at: Date, base: number, reversal = false) => ({
  tenantId,
  referenceType: 'BILL',
  referenceId: billId,
  entryDate: at,
  lines: [
    { ledgerAccountId: AP, debit: reversal ? 0 : base, credit: reversal ? base : 0 },
    { ledgerAccountId: 'ledger-bank', debit: reversal ? base : 0, credit: reversal ? 0 : base },
  ],
});

describe('PayablesService.aging: approved expense claims', () => {
  const supplierBill = bill({ id: 'bill-1', totalAmount: 3175 });
  const claim = {
    id: CLAIM,
    tenantId,
    claimNumber: 'EXP-2026-0004',
    employeeName: 'Layla Haddad',
    status: 'APPROVED',
  };
  const accrual = {
    tenantId,
    referenceType: 'EXPENSE',
    referenceId: CLAIM,
    entryDate: new Date('2026-03-10T00:00:00Z'),
    lines: [
      { ledgerAccountId: 'ledger-travel', debit: 315, credit: 0 },
      { ledgerAccountId: AP, debit: 0, credit: 315 },
    ],
  };
  const reimbursement = {
    tenantId,
    referenceType: 'EXPENSE',
    referenceId: `${CLAIM}:reimbursement`,
    entryDate: new Date('2026-03-20T10:00:00Z'),
    lines: [
      { ledgerAccountId: AP, debit: 315, credit: 0 },
      { ledgerAccountId: 'ledger-bank', debit: 0, credit: 315 },
    ],
  };

  it('counts a claim awaiting reimbursement, so the account is explained', async () => {
    const service = makeService({
      bills: [supplierBill],
      claims: [claim],
      journal: [billEntry(supplierBill), accrual],
    });

    const report = await service.aging(tenantId, day('2026-03-15'));

    expect(report.total).toBe(3175);
    expect(report.staffClaimsTotal).toBe(315);
    expect(report.staffClaims).toEqual([
      {
        id: CLAIM,
        claimNumber: 'EXP-2026-0004',
        employeeName: 'Layla Haddad',
        outstanding: 315,
      },
    ]);
    expect(report.ledgerBalance).toBe(3490);
    expect(report.difference).toBe(0);
  });

  it('drops the claim once it is reimbursed, and still shows it for a day before that', async () => {
    const service = makeService({
      bills: [supplierBill],
      claims: [{ ...claim, status: 'PAID' }],
      journal: [billEntry(supplierBill), accrual, reimbursement],
    });

    const after = await service.aging(tenantId, day('2026-03-20'));
    expect(after.staffClaims).toEqual([]);
    expect(after.staffClaimsTotal).toBe(0);
    expect(after.difference).toBe(0);

    const before = await service.aging(tenantId, day('2026-03-19'));
    expect(before.staffClaimsTotal).toBe(315);
    expect(before.difference).toBe(0);

    const beforeApproval = await service.aging(tenantId, day('2026-03-09'));
    expect(beforeApproval.staffClaimsTotal).toBe(0);
    expect(beforeApproval.difference).toBe(0);
  });

  it('still reports a real mismatch: something in the account that is neither a bill nor a claim', async () => {
    const stray = {
      tenantId,
      referenceType: 'MANUAL',
      referenceId: 'adjustment',
      entryDate: new Date('2026-03-12T00:00:00Z'),
      lines: [
        { ledgerAccountId: 'ledger-expense', debit: 40, credit: 0 },
        { ledgerAccountId: AP, debit: 0, credit: 40 },
      ],
    };
    const service = makeService({
      bills: [supplierBill],
      claims: [claim],
      journal: [billEntry(supplierBill), accrual, stray],
    });

    const report = await service.aging(tenantId, day('2026-03-15'));

    expect(report.ledgerBalance).toBe(3530);
    expect(report.difference).toBe(-40);
  });
});

describe('PayablesService.aging: as of a past date', () => {
  // Today the bill is fully paid. On the days in between it was not.
  const paid = bill({ status: 'PAID', paidAmount: 1000 });
  const payments = [
    { id: 'p1', tenantId, billId: 'bill-1', amount: 400, paidAt: new Date('2026-03-10T00:00:00Z'), reversedAt: new Date('2026-03-12T08:00:00Z') },
    { id: 'p2', tenantId, billId: 'bill-1', amount: 1000, paidAt: new Date('2026-04-20T00:00:00Z'), reversedAt: null },
  ];
  const journal = [
    billEntry(paid),
    paymentEntry('bill-1', payments[0].paidAt, 400),
    paymentEntry('bill-1', payments[0].reversedAt as Date, 400, true),
    paymentEntry('bill-1', payments[1].paidAt, 1000),
  ];
  const service = () => makeService({ bills: [paid], payments, journal });

  it.each([
    ['2026-02-28', 0, 'before the bill'],
    ['2026-03-05', 1000, 'billed, nothing paid'],
    ['2026-03-10', 600, 'part paid'],
    ['2026-03-12', 1000, 'that payment reversed'],
    ['2026-04-19', 1000, 'the day before it was settled'],
    ['2026-04-20', 0, 'settled'],
  ])('on %s owes %d (%s) and agrees with the ledger', async (date, owed) => {
    const report = await service().aging(tenantId, day(date));
    expect(report.total).toBe(owed);
    expect(report.ledgerBalance).toBe(owed);
    expect(report.difference).toBe(0);
    expect(report.bills.map((b) => b.outstanding)).toEqual(owed ? [owed] : []);
  });

  it('ages by the date asked about, not by today', async () => {
    const onTime = await service().aging(tenantId, day('2026-03-31'));
    expect(onTime.buckets.CURRENT).toBe(1000);
    const late = await service().aging(tenantId, day('2026-04-19'));
    expect(late.buckets.CURRENT).toBe(0);
    expect(late.buckets.DAYS_1_30).toBe(1000);
  });

  it('converts each bill at its own booked rate', async () => {
    const foreign = bill({ id: 'bill-2', billNumber: 'BILL-2026-0002', currency: 'USD', fxRate: 3.6725, totalAmount: 200 });
    const part = { id: 'p3', tenantId, billId: 'bill-2', amount: 50, paidAt: new Date('2026-03-15T00:00:00Z'), reversedAt: null };
    const world = makeService({
      bills: [foreign],
      payments: [part],
      journal: [
        { ...billEntry(foreign), lines: [{ ledgerAccountId: AP, debit: 0, credit: 734.5 }] },
        paymentEntry('bill-2', part.paidAt, 183.63),
      ],
    });

    const before = await world.aging(tenantId, day('2026-03-14'));
    expect(before.bills[0]).toMatchObject({ outstanding: 200, currency: 'USD', outstandingBase: 734.5 });
    expect(before.difference).toBe(0);

    const after = await world.aging(tenantId, day('2026-03-15'));
    expect(after.bills[0]).toMatchObject({ outstanding: 150, outstandingBase: 550.88 });
    // 734.50 - 183.63 = 550.87 in the ledger; the cent is rounding, not a lost entry.
    expect(Math.abs(after.difference)).toBeLessThanOrEqual(0.01);
  });
});
