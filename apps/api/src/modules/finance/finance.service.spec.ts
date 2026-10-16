import {
  createRecurringExpenseSchema,
  PERMISSIONS,
  type JournalLineInput,
} from '@saas/shared';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { FinanceService } from './finance.service';
import { LedgerService } from './ledger.service';
import { FinanceAccount } from './entities/finance-account.entity';
import { CategoryBudget } from './entities/category-budget.entity';
import { RecurringExpense } from './entities/recurring-expense.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { ExpenseClaim } from './entities/expense-claim.entity';
import { SupplierBill } from '../payables/entities/supplier-bill.entity';
import { Invoice } from '../quotes/entities/invoice.entity';
import { RecurringExpenseOccurrence } from './entities/recurring-expense-occurrence.entity';
import { Supplier } from '../purchasing/entities/supplier.entity';
import { PensionRemittance } from '../payroll/entities/pension-remittance.entity';
import { Settlement } from '../payroll/entities/settlement.entity';
import { TaxService } from '../tax/tax.service';
import { Employee } from '../payroll/entities/employee.entity';
import { SalaryPackage } from '../payroll/entities/salary-package.entity';
import { PayrollRun, PayrollRunLine } from '../payroll/entities/payroll-run.entity';
import {
  CreateFinanceAccountDto,
  CreateCategoryBudgetDto,
  TransferFundsDto,
} from './dto';

describe('FinanceService', () => {
  let service: FinanceService;
  let ledger: { resolveLines: jest.Mock; provisionChartOfAccounts: jest.Mock };
  let txManager: { getRepository: jest.Mock; query: jest.Mock };
  let accountRepo: jest.Mocked<Partial<Repository<FinanceAccount>>>;
  let budgetRepo: jest.Mocked<Partial<Repository<CategoryBudget>>>;
  let recurringRepo: jest.Mocked<Partial<Repository<RecurringExpense>>>;
  let journalRepo: jest.Mocked<Partial<Repository<JournalEntry>>>;
  let expenseRepo: jest.Mocked<Partial<Repository<ExpenseClaim>>>;
  let occurrences: { count: jest.Mock; find: jest.Mock; findOne: jest.Mock };
  let recurringRows: any[];
  let billRepo: { find: jest.Mock };
  let invoiceRepo: { find: jest.Mock };
  let supplierRepo: { findOne: jest.Mock };
  let tax: { purchaseTaxFor: jest.Mock; findCode: jest.Mock };
  let employeeRepo: { find: jest.Mock };
  let packageRepo: { find: jest.Mock };
  let runRepo: { find: jest.Mock };
  let lineRepo: { find: jest.Mock };
  let remittanceRepo: { find: jest.Mock };
  let settlementRepo: { find: jest.Mock };

  const tenantId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    accountRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      // How many accounts the tenant already has — `createAccount` makes the
      // first one the default whether or not the box was ticked. Each test
      // that cares sets its own count.
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn().mockImplementation((dto) => ({ id: 'acc-1', ...dto })),
      save: jest
        .fn()
        .mockImplementation(async (acc) => ({ id: 'acc-1', ...acc })),
      update: jest.fn().mockResolvedValue({} as any),
    };
    // Balances move with a relative UPDATE through the manager. The fake
    // applies it to whatever `findOne` returns for that account id, so the
    // balance assertions still read the effect. Anything else (an advisory
    // lock) is accepted and ignored.
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
      if (!sql.includes('"balance" = "balance"')) return [];
      const account = await accountRepo.findOne!({
        where: { id: params[1] as string },
      });
      if (account && sql.includes('"balance" = "balance" +')) {
        account.balance = Number(account.balance) + Number(params[0]);
      } else if (account && sql.includes('"balance" = "balance" -')) {
        account.balance = Number(account.balance) - Number(params[0]);
      }
      return [];
    });
    const getRepository = (entity: { name: string }) =>
      entity.name === 'JournalEntry' ? journalRepo : accountRepo;
    // The manager a transaction hands its callback. Distinct from the
    // repository's own manager so a test can tell work done inside the
    // transaction from work done outside it.
    txManager = { getRepository: jest.fn(getRepository), query };
    (accountRepo as any).manager = {
      getRepository,
      query,
      transaction: jest.fn(async (work: (m: unknown) => unknown) =>
        work(txManager),
      ),
    };

    budgetRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => ({ id: 'bud-1', ...dto })),
      save: jest
        .fn()
        .mockImplementation(async (bud) => ({ id: 'bud-1', ...bud })),
    };

    recurringRows = [];
    recurringRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(
        async ({ where }: any) =>
          recurringRows.find(
            (r) => r.id === where.id && r.tenantId === where.tenantId,
          ) ?? null,
      ),
      create: jest.fn().mockImplementation((dto) => ({ id: 'rec-1', ...dto })),
      save: jest.fn().mockImplementation(async (rec) => {
        const row = {
          id: 'rec-1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          ...rec,
        };
        if (!recurringRows.includes(rec)) {
          recurringRows = recurringRows.filter((r) => r.id !== row.id);
          recurringRows.push(row);
        }
        return row;
      }),
    };
    occurrences = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    journalRepo = {
      find: jest.fn().mockResolvedValue([]),
      // An opening balance posts an entry; nothing is posted yet, so the
      // idempotency check finds nothing.
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => ({ id: 'je-1', ...dto })),
      save: jest.fn().mockImplementation(async (je) => ({ id: 'je-1', ...je })),
    };

    expenseRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    // Resolution is LedgerService's job and has its own spec; here it just has
    // to stamp each line with an account so the assertions below can read the
    // debits and credits the service actually produced.
    ledger = {
      resolveLines: jest.fn(
        async (_tenantId: string, lines: JournalLineInput[]) =>
          lines.map((line) => ({
            ledgerAccountId: `ledger-${line.role ?? line.financeAccountId ?? 'unknown'}`,
            ledgerAccountCode:
              line.role === 'ACCOUNTS_RECEIVABLE' ? '1100' : '1001',
            financeAccountId: line.financeAccountId ?? null,
            accountName: line.accountName,
            debit: line.debit,
            credit: line.credit,
            description: line.description,
          })),
      ),
      // Called before an opening balance posts, so 3100 exists on charts
      // created before opening balance equity was introduced.
      provisionChartOfAccounts: jest.fn().mockResolvedValue([]),
    };

    billRepo = { find: jest.fn().mockResolvedValue([]) };
    invoiceRepo = { find: jest.fn().mockResolvedValue([]) };
    // Every referenced supplier and tax code exists unless a test says not.
    supplierRepo = { findOne: jest.fn(async ({ where }: any) => ({ id: where.id })) };
    tax = {
      purchaseTaxFor: jest.fn().mockResolvedValue({ code: null, rate: 0 }),
      findCode: jest.fn(async (_t: string, id: string) => ({ id, kind: 'PURCHASE' })),
    };

    employeeRepo = { find: jest.fn().mockResolvedValue([]) };
    packageRepo = { find: jest.fn().mockResolvedValue([]) };
    runRepo = { find: jest.fn().mockResolvedValue([]) };
    lineRepo = { find: jest.fn().mockResolvedValue([]) };
    remittanceRepo = { find: jest.fn().mockResolvedValue([]) };
    settlementRepo = { find: jest.fn().mockResolvedValue([]) };

    service = new FinanceService(
      accountRepo as unknown as Repository<FinanceAccount>,
      budgetRepo as unknown as Repository<CategoryBudget>,
      recurringRepo as unknown as Repository<RecurringExpense>,
      journalRepo as unknown as Repository<JournalEntry>,
      expenseRepo as unknown as Repository<ExpenseClaim>,
      ledger as unknown as LedgerService,
      occurrences as unknown as Repository<RecurringExpenseOccurrence>,
      billRepo as unknown as Repository<SupplierBill>,
      invoiceRepo as unknown as Repository<Invoice>,
      supplierRepo as unknown as Repository<Supplier>,
      tax as unknown as TaxService,
      employeeRepo as unknown as Repository<Employee>,
      packageRepo as unknown as Repository<SalaryPackage>,
      runRepo as unknown as Repository<PayrollRun>,
      lineRepo as unknown as Repository<PayrollRunLine>,
      remittanceRepo as unknown as Repository<PensionRemittance>,
      settlementRepo as unknown as Repository<Settlement>,
    );
  });

  describe('getOverview', () => {
    it('calculates total cash, monthly burn rate, runway months, and cashflow series', async () => {
      const mockAccounts = [
        {
          id: 'acc-1',
          tenantId,
          name: 'Operating Bank',
          accountType: 'BANK',
          currency: 'USD',
          balance: 50000,
          isDefault: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'acc-2',
          tenantId,
          name: 'Petty Cash',
          accountType: 'CASH',
          currency: 'USD',
          balance: 20000,
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as FinanceAccount[];

      const mockRecurring = [
        {
          id: 'rec-1',
          tenantId,
          vendorName: 'AWS',
          category: 'Infrastructure',
          amount: 2000,
          billingInterval: 'MONTHLY',
          status: 'ACTIVE',
        },
        {
          id: 'rec-2',
          tenantId,
          vendorName: 'GitHub',
          category: 'Software',
          amount: 500,
          billingInterval: 'MONTHLY',
          status: 'ACTIVE',
        },
      ] as RecurringExpense[];

      const mockExpenses = [
        {
          id: 'exp-1',
          tenantId,
          amount: 1500,
          status: 'APPROVED',
          createdAt: new Date(),
        },
        {
          id: 'exp-2',
          tenantId,
          amount: 1500,
          status: 'PAID',
          createdAt: new Date(),
        },
      ] as ExpenseClaim[];

      accountRepo.find = jest.fn().mockResolvedValue(mockAccounts);
      recurringRepo.find = jest.fn().mockResolvedValue(mockRecurring);
      expenseRepo.find = jest.fn().mockResolvedValue(mockExpenses);

      const overview = await service.getOverview(tenantId);

      expect(overview.totalCash).toBe(70000);
      expect(overview.currency).toBe('USD');
      expect(overview.accounts).toHaveLength(2);
      expect(overview.monthlyOutflow).toBe(3500); // 2000 + 500 + (1500 + 1500) / 3 over the 90-day window
      expect(overview.monthlyBurnRate).toBe(3500);
      expect(overview.runwayMonths).toBe(20); // 70000 / 3500 = 20
      expect(overview.recentCashflowSeries).toHaveLength(30);
    });

    it('handles zero burn rate with infinite runway', async () => {
      accountRepo.find = jest.fn().mockResolvedValue([
        {
          id: 'acc-1',
          tenantId,
          name: 'Bank',
          balance: 10000,
          currency: 'USD',
        } as FinanceAccount,
      ]);
      recurringRepo.find = jest.fn().mockResolvedValue([]);
      expenseRepo.find = jest.fn().mockResolvedValue([]);

      const overview = await service.getOverview(tenantId);

      expect(overview.totalCash).toBe(10000);
      expect(overview.monthlyBurnRate).toBe(0);
      expect(overview.runwayMonths).toBe(Infinity);
    });
  });

  const seedAccounts = (rows: any[]) => {
    accountRepo.find = jest.fn().mockResolvedValue(rows);
  };
  const seedRecurringRows = (rows: any[]) => {
    // Honours the status filter, as the query would.
    recurringRepo.find = jest.fn(async (opts?: any) =>
      rows.filter((r) => !opts?.where?.status || r.status === opts.where.status),
    );
  };
  const seedClaims = (rows: any[]) => {
    expenseRepo.find = jest.fn().mockResolvedValue(rows);
  };
  const seedBills = (rows: any[]) => {
    billRepo.find.mockResolvedValue(rows);
  };
  const seedInvoices = (rows: any[]) => {
    invoiceRepo.find.mockResolvedValue(rows);
  };

  describe('runway', () => {
    afterEach(() => jest.useRealTimers());

    it('counts quarterly recurring at a third and only the last 90 days of claims', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T00:00:00Z'));
      seedAccounts([{ balance: 100000 }]);
      seedRecurringRows([
        { amount: 3000, billingInterval: 'QUARTERLY', status: 'ACTIVE' },
      ]);
      seedClaims([
        { amount: 900, status: 'APPROVED', expenseDate: '2026-09-01' },
        { amount: 50000, status: 'PAID', expenseDate: '2025-01-01' },
      ]);
      const o = await service.getOverview(tenantId);
      expect(o.monthlyOutflow).toBe(1000 + 300);
    });
  });

  describe('getOverview payroll', () => {
    it('adds the current gross of active employees to the committed burn', async () => {
      seedAccounts([{ balance: 100000 }]);
      employeeRepo.find.mockResolvedValue([
        { id: 'a', status: 'ACTIVE' },
        { id: 'b', status: 'ACTIVE' },
      ]);
      packageRepo.find.mockResolvedValue([
        { employeeId: 'a', effectiveFrom: '2020-01-01', basic: 1000, housing: 500, transport: 0, otherAllowances: [] },
        { employeeId: 'a', effectiveFrom: '2099-01-01', basic: 9999, housing: 0, transport: 0, otherAllowances: [] },
        { employeeId: 'b', effectiveFrom: '2020-01-01', basic: 2000, housing: 0, transport: 0, otherAllowances: [{ label: 'x', amount: 500 }] },
      ]);
      const o = await service.getOverview(tenantId);
      expect(o.monthlyBurnRate).toBe(4000);
      expect(o.runwayMonths).toBe(25);
    });
  });

  describe('cashForecast', () => {
    afterEach(() => jest.useRealTimers());

    it('buckets bills by due date, projects recurring, adds receivables, carries the balance', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T00:00:00Z'));
      seedAccounts([{ balance: 50000 }]);
      seedBills([
        { status: 'APPROVED', totalAmount: 8000, paidAmount: 0, dueDate: '2026-10-30', fxRate: 1 },
        { status: 'DRAFT', totalAmount: 2000, paidAmount: 0, dueDate: '2026-09-01', fxRate: 1 }, // overdue -> month 1
      ]);
      seedRecurringRows([
        { amount: 120000, billingInterval: 'ANNUAL', status: 'ACTIVE', startDate: '2026-01-01', nextBillingDate: new Date('2027-01-01T00:00:00Z'), endDate: null },
      ]);
      seedInvoices([
        { status: 'ISSUED', amount: 30000, paidAmount: 0, dueDate: '2026-11-10', fxRate: 1 },
      ]);
      const f = await service.cashForecast(tenantId, 4);
      expect(f.months.map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
      expect(f.months[0]).toMatchObject({ opening: 50000, billsOut: 10000, inflows: 0, closing: 40000 });
      expect(f.months[1]).toMatchObject({ opening: 40000, inflows: 30000, closing: 70000 });
      expect(f.months[3]).toMatchObject({ recurringOut: 120000, closing: -50000 });
    });
  });

  describe('cashForecast payroll', () => {
    afterEach(() => jest.useRealTimers());
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T00:00:00Z'));
      seedAccounts([{ balance: 100000 }]);
    });
    const emp = (id: string, o: any = {}) => ({
      id, tenantId, status: 'ACTIVE', joiningDate: '2020-01-01', leavingDate: null, ...o,
    });
    const pkg = (employeeId: string, effectiveFrom: string, basic: number, o: any = {}) => ({
      employeeId, effectiveFrom, basic, housing: 0, transport: 0, otherAllowances: [], ...o,
    });

    it('an approved run contributes only its unpaid net, on its pay date', async () => {
      runRepo.find.mockResolvedValue([
        { id: 'r1', period: '2026-10', status: 'PARTIALLY_PAID', payDate: '2026-10-28', totalNet: 9000 },
      ]);
      lineRepo.find.mockResolvedValue([{ runId: 'r1', netPay: 3000, paidAt: null }]);
      const f = await service.cashForecast(tenantId, 2);
      expect(f.months[0].payrollOut).toBe(3000);
      expect(f.months[0].closing).toBe(97000);
      expect(f.months[1].payrollOut).toBe(0);
    });

    it('an overdue unpaid run lands in month 1', async () => {
      runRepo.find.mockResolvedValue([
        { id: 'r0', period: '2026-09', status: 'APPROVED', payDate: '2026-09-28', totalNet: 5000 },
      ]);
      lineRepo.find.mockResolvedValue([{ runId: 'r0', netPay: 5000, paidAt: null }]);
      const f = await service.cashForecast(tenantId, 1);
      expect(f.months[0].payrollOut).toBe(5000);
    });

    it('projects months with no run from active gross, skipping LEFT and starting joiners in their month', async () => {
      employeeRepo.find.mockResolvedValue([
        emp('a'),
        emp('b', { status: 'LEFT', leavingDate: '2026-06-30' }),
        emp('c', { joiningDate: '2026-12-10' }),
      ]);
      packageRepo.find.mockResolvedValue([
        pkg('a', '2020-01-01', 1000),
        pkg('a', '2026-11-15', 1500, { housing: 500 }),
        pkg('b', '2020-01-01', 7000),
        pkg('c', '2026-12-01', 800, { otherAllowances: [{ label: 'x', amount: 200 }] }),
      ]);
      const f = await service.cashForecast(tenantId, 3);
      expect(f.months.map((m) => m.payrollOut)).toEqual([1000, 2000, 3000]);
    });

    it('a draft run uses its total net instead of the projection', async () => {
      employeeRepo.find.mockResolvedValue([emp('a')]);
      packageRepo.find.mockResolvedValue([pkg('a', '2020-01-01', 1000)]);
      runRepo.find.mockResolvedValue([
        { id: 'r2', period: '2026-11', status: 'DRAFT', payDate: '2026-11-27', totalNet: 4321 },
      ]);
      const f = await service.cashForecast(tenantId, 2);
      expect(f.months.map((m) => m.payrollOut)).toEqual([1000, 4321]);
    });

    it('a paid run adds nothing and suppresses the projection for its month', async () => {
      employeeRepo.find.mockResolvedValue([emp('a')]);
      packageRepo.find.mockResolvedValue([pkg('a', '2020-01-01', 1000)]);
      runRepo.find.mockResolvedValue([
        { id: 'r3', period: '2026-10', status: 'PAID', payDate: '2026-10-28', totalNet: 900 },
      ]);
      const f = await service.cashForecast(tenantId, 2);
      expect(f.months.map((m) => m.payrollOut)).toEqual([0, 1000]);
    });
  });

  describe('cashForecast pension and settlements', () => {
    afterEach(() => jest.useRealTimers());
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T00:00:00Z'));
      seedAccounts([{ balance: 10000 }]);
      lineRepo.find.mockImplementation(async ({ where }: any) =>
        where.paidAt
          ? []
          : [{ runId: 'r1', pensionEmployee: 100, pensionEmployer: 200.5 }],
      );
    });
    const run = (o: any = {}) => ({
      id: 'r1', period: '2026-10', status: 'APPROVED', payDate: '2026-10-28', totalNet: 0, ...o,
    });

    it('an unremitted posted run owes its pension on the 15th of the next month', async () => {
      runRepo.find.mockResolvedValue([run()]);
      const f = await service.cashForecast(tenantId, 3);
      expect(f.months.map((m) => m.pensionOut)).toEqual([0, 300.5, 0]);
      expect(f.months[1].closing).toBe(10000 - 300.5);
    });

    it('an overdue remittance lands in month 1', async () => {
      runRepo.find.mockResolvedValue([run({ period: '2026-08', status: 'PAID' })]);
      const f = await service.cashForecast(tenantId, 2);
      expect(f.months.map((m) => m.pensionOut)).toEqual([300.5, 0]);
    });

    it('a remitted period shows none; drafts are not posted', async () => {
      runRepo.find.mockResolvedValue([run(), run({ id: 'r2', period: '2026-09', status: 'DRAFT' })]);
      remittanceRepo.find.mockResolvedValue([{ period: '2026-10' }]);
      const f = await service.cashForecast(tenantId, 3);
      expect(f.months.map((m) => m.pensionOut)).toEqual([0, 0, 0]);
    });

    it('an approved settlement adds its net to month 1 payroll; a paid one does not', async () => {
      settlementRepo.find.mockResolvedValue([{ status: 'APPROVED', netPay: 2500 }]);
      const f = await service.cashForecast(tenantId, 2);
      expect(f.months[0].payrollOut).toBe(2500);
      expect(f.months[0].closing).toBe(7500);
      expect(settlementRepo.find).toHaveBeenCalledWith({
        where: { tenantId, status: 'APPROVED' },
      });
    });
  });

  describe('cashForecast recurring', () => {
    afterEach(() => jest.useRealTimers());
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T00:00:00Z'));
      seedAccounts([{ balance: 0 }]);
    });

    it('projects a never-billed (supplier-less) row from today, not from its old next date', async () => {
      seedRecurringRows([
        { amount: 1000, billingInterval: 'MONTHLY', status: 'ACTIVE', supplierId: null, taxCodeId: null, startDate: '2026-01-05', nextBillingDate: new Date('2026-01-05T00:00:00Z'), endDate: null },
      ]);
      const f = await service.cashForecast(tenantId, 3);
      // 5 Oct is already past: November and December only, nothing piled into October.
      expect(f.months.map((m) => m.recurringOut)).toEqual([0, 1000, 1000]);
    });

    it('a paused row contributes nothing', async () => {
      seedRecurringRows([
        { amount: 1000, billingInterval: 'MONTHLY', status: 'PAUSED', supplierId: null, taxCodeId: null, startDate: '2026-01-05', nextBillingDate: new Date('2026-01-05T00:00:00Z'), endDate: null },
      ]);
      const f = await service.cashForecast(tenantId, 3);
      expect(f.months.map((m) => m.recurringOut)).toEqual([0, 0, 0]);
    });

    it('adds the tax the generated bill will carry', async () => {
      tax.purchaseTaxFor.mockResolvedValue({ code: { id: 'tc-5' }, rate: 5 });
      seedRecurringRows([
        { amount: 120000, billingInterval: 'ANNUAL', status: 'ACTIVE', supplierId: 'sup-1', taxCodeId: null, startDate: '2026-11-01', nextBillingDate: new Date('2026-11-01T00:00:00Z'), endDate: null },
      ]);
      const f = await service.cashForecast(tenantId, 2);
      expect(f.months[1].recurringOut).toBe(126000);
      expect(tax.purchaseTaxFor).toHaveBeenCalledWith(tenantId, null, 'sup-1');
    });

    it('reports in the organization base currency, not the first cash account', async () => {
      seedAccounts([{ balance: 0, currency: 'USD' }]);
      const getRepository = (accountRepo as any).manager.getRepository;
      (accountRepo as any).manager.getRepository = (entity: { name: string }) =>
        entity.name === 'Organization'
          ? { findOne: jest.fn().mockResolvedValue({ id: tenantId, baseCurrency: 'aed' }) }
          : getRepository(entity);
      const f = await service.cashForecast(tenantId, 1);
      expect(f.baseCurrency).toBe('AED');
    });
  });

  describe('cashForecast receivables', () => {
    afterEach(() => jest.useRealTimers());

    it('nets credit notes off invoice inflows and drops fully credited invoices', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T00:00:00Z'));
      seedAccounts([{ balance: 0 }]);
      seedInvoices([
        { status: 'ISSUED', amount: 30000, paidAmount: 0, creditedAmount: 10000, refundedAmount: 0, dueDate: '2026-10-20', fxRate: 1 },
        { status: 'ISSUED', amount: 5000, paidAmount: 0, creditedAmount: 5000, refundedAmount: 0, dueDate: '2026-10-21', fxRate: 1 },
      ]);
      const f = await service.cashForecast(tenantId, 1);
      expect(f.months[0].inflows).toBe(20000);
    });
  });

  describe('accounts CRUD & transfers', () => {
    it('creates a new financial account and unsets prior default if isDefault is true', async () => {
      const dto: CreateFinanceAccountDto = {
        name: 'New Checking Account',
        accountType: 'BANK',
        currency: 'USD',
        balance: 5000,
        isDefault: true,
      };

      const result = await service.createAccount(tenantId, dto);

      expect(accountRepo.update).toHaveBeenCalledWith(
        { tenantId, isDefault: true },
        { isDefault: false },
      );
      expect(accountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          name: 'New Checking Account',
          accountType: 'BANK',
          currency: 'USD',
          balance: 5000,
          isDefault: true,
        }),
      );
      expect(result.name).toBe('New Checking Account');
    });

    // Opening balances used to live only on the account row, so treasury and
    // the balance sheet reported different figures for the same account and
    // nothing could be reconciled against a statement.
    it('posts a new account opening balance against opening balance equity', async () => {
      await service.createAccount(tenantId, {
        name: 'Operating Checking',
        accountType: 'BANK',
        currency: 'USD',
        balance: 15000,
      });

      expect(journalRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceType: 'MANUAL',
          totalAmount: 15000,
          lines: expect.arrayContaining([
            expect.objectContaining({ debit: 15000 }),
            expect.objectContaining({
              accountName: 'Opening balance equity',
              credit: 15000,
            }),
          ]),
        }),
      );
    });

    /*
     * "DEFAULT ACCOUNT: None set" beside a tenant's only account is never what
     * anyone wants, and it leaves expense reimbursement with no account to pay
     * from — which is the point at which it costs money rather than looking odd.
     */
    it('makes the first account the default even when the box was not ticked', async () => {
      (accountRepo.count as jest.Mock).mockResolvedValue(0);

      await service.createAccount(tenantId, {
        name: 'Only Account',
        accountType: 'BANK',
        currency: 'USD',
      });

      expect(accountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Only Account', isDefault: true }),
      );
    });

    it('leaves a later account undefaulted unless it asks to be', async () => {
      (accountRepo.count as jest.Mock).mockResolvedValue(2);

      await service.createAccount(tenantId, {
        name: 'Second Account',
        accountType: 'CASH',
        currency: 'USD',
      });

      expect(accountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Second Account', isDefault: false }),
      );
      expect(accountRepo.update).not.toHaveBeenCalled();
    });

    // There was no way to change the default after creation at all, so a
    // tenant who missed the checkbox had no route back to one.
    it('moves the default onto an existing account', async () => {
      (accountRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'acc-2',
        tenantId,
        name: 'Petty Cash',
        isDefault: false,
      });

      const result = await service.updateAccount(tenantId, 'acc-2', {
        isDefault: true,
      });

      expect(accountRepo.update).toHaveBeenCalledWith(
        { tenantId, isDefault: true },
        { isDefault: false },
      );
      expect(result.isDefault).toBe(true);
    });

    it('refuses to update an account belonging to another tenant', async () => {
      (accountRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateAccount(tenantId, 'acc-9', { name: 'Theirs' }),
      ).rejects.toThrow('not found');
    });

    /*
     * Clearing the old default, saving the account and posting its opening
     * balance were three separate writes. A failure in the posting left an
     * account whose balance the ledger never heard of, and two accounts
     * created at once could both end up the default.
     */
    it('creates the account, moves the default and posts the opening balance in one transaction', async () => {
      await service.createAccount(tenantId, {
        name: 'Operating Checking',
        accountType: 'BANK',
        currency: 'USD',
        balance: 15000,
        isDefault: true,
      });

      expect((accountRepo as any).manager.transaction).toHaveBeenCalledTimes(1);
      expect(txManager.getRepository).toHaveBeenCalledWith(FinanceAccount);
      expect(txManager.getRepository).toHaveBeenCalledWith(JournalEntry);
      // Serialises default changes for the tenant, including the first
      // account, where there is no existing row to lock.
      expect(txManager.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        [`finance_accounts:default:${tenantId}`],
      );
      // The ledger has to see the uncommitted account to give it a ledger
      // account, so it must be handed the transaction's manager.
      expect(ledger.provisionChartOfAccounts).toHaveBeenCalledWith(
        tenantId,
        txManager,
      );
      expect(ledger.resolveLines).toHaveBeenCalledWith(
        tenantId,
        expect.any(Array),
        txManager,
      );
    });

    it('fails the whole creation when the opening balance cannot post', async () => {
      ledger.resolveLines.mockRejectedValueOnce(new Error('chart missing'));

      await expect(
        service.createAccount(tenantId, {
          name: 'Operating Checking',
          accountType: 'BANK',
          currency: 'USD',
          balance: 15000,
        }),
      ).rejects.toThrow('chart missing');
      expect((accountRepo as any).manager.transaction).toHaveBeenCalled();
    });

    it('moves the default inside a transaction holding the default lock', async () => {
      (accountRepo.findOne as jest.Mock).mockResolvedValue({
        id: 'acc-2',
        tenantId,
        name: 'Petty Cash',
        isDefault: false,
      });

      await service.updateAccount(tenantId, 'acc-2', { isDefault: true });

      expect((accountRepo as any).manager.transaction).toHaveBeenCalledTimes(1);
      expect(txManager.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_xact_lock'),
        [`finance_accounts:default:${tenantId}`],
      );
      expect(accountRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
    });

    it('posts nothing when an account opens at zero', async () => {
      await service.createAccount(tenantId, {
        name: 'Empty Account',
        accountType: 'BANK',
        currency: 'USD',
        balance: 0,
      });

      expect(journalRepo.save).not.toHaveBeenCalled();
    });

    it('throws BadRequestException on transfer with same source and destination', async () => {
      const transferDto: TransferFundsDto = {
        fromAccountId: 'acc-1',
        toAccountId: 'acc-1',
        amount: 500,
      };

      await expect(
        service.transferFunds(tenantId, transferDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException on negative or zero transfer amount', async () => {
      const transferDto: TransferFundsDto = {
        fromAccountId: 'acc-1',
        toAccountId: 'acc-2',
        amount: 0,
      };

      await expect(
        service.transferFunds(tenantId, transferDto),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when account does not exist', async () => {
      accountRepo.findOne = jest.fn().mockResolvedValue(null);

      const transferDto: TransferFundsDto = {
        fromAccountId: 'non-existent',
        toAccountId: 'acc-2',
        amount: 100,
      };

      await expect(
        service.transferFunds(tenantId, transferDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /*
   * A transfer used to read both balances, subtract in JavaScript and save the
   * rows back, outside any transaction. Two transfers out of the same account
   * at once could both pass the balance check and one debit would simply
   * vanish; a failure between the two saves and the journal left money moved
   * with no entry for it.
   */
  describe('transferFunds', () => {
    let store: Record<string, FinanceAccount>;

    const transfer = (over: Partial<TransferFundsDto> = {}) =>
      service.transferFunds(tenantId, {
        fromAccountId: 'acc-1',
        toAccountId: 'acc-2',
        amount: 2000,
        description: 'Fund replenishment',
        ...over,
      });

    beforeEach(() => {
      store = {
        'acc-1': {
          id: 'acc-1',
          tenantId,
          name: 'Bank A',
          balance: 5000,
          currency: 'USD',
        } as FinanceAccount,
        'acc-2': {
          id: 'acc-2',
          tenantId,
          name: 'Bank B',
          balance: 1000,
          currency: 'USD',
        } as FinanceAccount,
      };
      accountRepo.findOne = jest.fn(
        async (options: { where: { id: string } }) =>
          store[options.where.id] ?? null,
      ) as any;
    });

    it('moves the money and posts the double entry inside one transaction', async () => {
      const res = await transfer();

      expect((accountRepo as any).manager.transaction).toHaveBeenCalledTimes(1);
      expect(txManager.getRepository).toHaveBeenCalledWith(JournalEntry);
      expect(ledger.resolveLines).toHaveBeenCalledWith(
        tenantId,
        expect.any(Array),
        txManager,
      );
      expect(journalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          referenceType: 'TRANSFER',
          totalAmount: 2000,
          lines: expect.arrayContaining([
            expect.objectContaining({
              financeAccountId: 'acc-1',
              ledgerAccountId: 'ledger-acc-1',
              credit: 2000,
              debit: 0,
            }),
            expect.objectContaining({
              financeAccountId: 'acc-2',
              ledgerAccountId: 'ledger-acc-2',
              debit: 2000,
              credit: 0,
            }),
          ]),
        }),
      );
      expect(journalRepo.save).toHaveBeenCalled();
      expect(res.fromAccount.balance).toBe(3000);
      expect(res.toAccount.balance).toBe(3000);
      expect(res.journalEntry).toBeDefined();
    });

    it('moves balances with relative UPDATEs, never by saving a computed figure', async () => {
      await transfer();

      expect(accountRepo.save).not.toHaveBeenCalled();
      expect(txManager.query).toHaveBeenCalledWith(
        expect.stringContaining('"balance" = "balance" - $1'),
        [2000, 'acc-1', tenantId],
      );
      expect(txManager.query).toHaveBeenCalledWith(
        expect.stringContaining('"balance" = "balance" + $1'),
        [2000, 'acc-2', tenantId],
      );
    });

    it('locks both accounts FOR UPDATE in id order, whichever way the money goes', async () => {
      await transfer({
        fromAccountId: 'acc-2',
        toAccountId: 'acc-1',
        amount: 500,
      });

      const lockedIds = (accountRepo.findOne as jest.Mock).mock.calls
        .filter(([options]) => options.lock)
        .map(([options]) => {
          expect(options.lock).toEqual({ mode: 'pessimistic_write' });
          return options.where.id;
        });
      // Sorted, so two opposite transfers cannot each hold one lock and wait
      // for the other's.
      expect(lockedIds.slice(0, 2)).toEqual(['acc-1', 'acc-2']);
    });

    it('checks the balance on the locked row and moves nothing when it is short', async () => {
      store['acc-1'].balance = 100;

      await expect(transfer({ amount: 500 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(txManager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('"balance" = "balance"'),
        expect.anything(),
      );
      expect(journalRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an account in another tenant', async () => {
      await expect(
        transfer({ toAccountId: 'acc-elsewhere' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(journalRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('recordInvoicePayment & reverseInvoicePayment', () => {
    it('records an invoice payment: bumps the balance and posts a debit-account/credit-AR journal entry', async () => {
      const account = {
        id: 'acc-1',
        tenantId,
        name: 'Operating Bank',
        balance: 1000,
        currency: 'USD',
      } as FinanceAccount;
      accountRepo.findOne = jest.fn().mockResolvedValue(account);

      const res = await service.recordInvoicePayment(tenantId, {
        invoiceId: 'inv-1',
        accountId: 'acc-1',
        amount: 400,
      });

      expect(account.balance).toBe(1400);
      expect(accountRepo.save).not.toHaveBeenCalled();
      expect((accountRepo as any).manager.query).toHaveBeenCalledWith(
        expect.stringContaining('"balance" = "balance" + $1'),
        [400, 'acc-1', tenantId],
      );
      expect(journalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          referenceType: 'INVOICE',
          referenceId: 'inv-1',
          totalAmount: 400,
          lines: expect.arrayContaining([
            expect.objectContaining({
              financeAccountId: 'acc-1',
              ledgerAccountId: 'ledger-acc-1',
              debit: 400,
              credit: 0,
            }),
            expect.objectContaining({
              accountName: 'Accounts Receivable',
              ledgerAccountCode: '1100',
              debit: 0,
              credit: 400,
            }),
          ]),
        }),
      );
      expect(res.account.balance).toBe(1400);
    });

    it('throws BadRequestException on a zero or negative payment amount', async () => {
      await expect(
        service.recordInvoicePayment(tenantId, {
          invoiceId: 'inv-1',
          accountId: 'acc-1',
          amount: 0,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException when the account does not exist', async () => {
      accountRepo.findOne = jest.fn().mockResolvedValue(null);
      await expect(
        service.recordInvoicePayment(tenantId, {
          invoiceId: 'inv-1',
          accountId: 'missing',
          amount: 100,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reverses an invoice payment: drops the balance and posts a debit-AR/credit-account journal entry', async () => {
      const account = {
        id: 'acc-1',
        tenantId,
        name: 'Operating Bank',
        balance: 1400,
        currency: 'USD',
      } as FinanceAccount;
      accountRepo.findOne = jest.fn().mockResolvedValue(account);

      const res = await service.reverseInvoicePayment(tenantId, {
        invoiceId: 'inv-1',
        paymentId: 'pay-1',
        accountId: 'acc-1',
        amount: 400,
      });

      expect(account.balance).toBe(1000);
      expect(accountRepo.save).not.toHaveBeenCalled();
      expect(journalRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          referenceType: 'INVOICE',
          referenceId: 'pay-1',
          totalAmount: 400,
          lines: expect.arrayContaining([
            expect.objectContaining({
              accountName: 'Accounts Receivable',
              ledgerAccountCode: '1100',
              debit: 400,
              credit: 0,
            }),
            expect.objectContaining({
              financeAccountId: 'acc-1',
              ledgerAccountId: 'ledger-acc-1',
              debit: 0,
              credit: 400,
            }),
          ]),
        }),
      );
      expect(res.account.balance).toBe(1000);
    });

    it('reverseInvoicePayment throws BadRequestException on a zero or negative amount', async () => {
      await expect(
        service.reverseInvoicePayment(tenantId, {
          invoiceId: 'inv-1',
          paymentId: 'pay-1',
          accountId: 'acc-1',
          amount: 0,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('budgets & subscriptions', () => {
    it('creates and lists category budgets', async () => {
      const budgetDto: CreateCategoryBudgetDto = {
        category: 'Marketing',
        period: 'MONTHLY',
        budgetAmount: 10000,
        alertThresholdPercent: 80,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      };

      const created = await service.createBudget(tenantId, budgetDto);
      expect(budgetRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          category: 'Marketing',
          budgetAmount: 10000,
        }),
      );
      expect(created.id).toBe('bud-1');

      budgetRepo.find = jest.fn().mockResolvedValue([created]);
      const list = await service.findAllBudgets(tenantId);
      expect(list).toHaveLength(1);
    });

    const SUPPLIER = '22222222-2222-4222-8222-222222222222';
    const manager = {
      userId: 'u-fin',
      permissions: [PERMISSIONS.FINANCE_MANAGE],
    };
    const managerApprover = {
      userId: 'u-boss',
      permissions: [PERMISSIONS.FINANCE_MANAGE, PERMISSIONS.BILL_APPROVE],
    };
    const input = createRecurringExpenseSchema.parse({
      supplierId: SUPPLIER,
      vendorName: 'Landlord',
      category: 'Rent & premises',
      amount: 120000,
      billingInterval: 'ANNUAL',
      startDate: '2026-01-01',
    });
    const seedRecurring = (over: Record<string, unknown>) => {
      recurringRows.push({
        tenantId,
        supplierId: SUPPLIER,
        vendorName: 'Landlord',
        category: 'Rent & premises',
        amount: 120000,
        billingInterval: 'ANNUAL',
        startDate: '2026-01-01',
        endDate: null,
        nextBillingDate: new Date('2026-01-01T00:00:00Z'),
        taxCodeId: null,
        autoApprove: false,
        autoApproveById: null,
        spreadOverPeriod: false,
        financeAccountId: null,
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...over,
      });
    };

    it('refuses auto-approve from someone who cannot approve bills', async () => {
      await expect(
        service.createSubscription(tenantId, manager, {
          ...input,
          autoApprove: true,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('records who switched auto-approve on', async () => {
      const row = await service.createSubscription(tenantId, managerApprover, {
        ...input,
        autoApprove: true,
      });
      expect(row).toMatchObject({
        autoApprove: true,
        createdAt: expect.any(String),
      });
      expect(recurringRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          autoApproveById: 'u-boss',
          createdById: 'u-boss',
          nextBillingDate: new Date('2026-01-01T00:00:00Z'),
        }),
      );
    });

    it('edit after first occurrence: amount changes, start date and interval are refused', async () => {
      seedRecurring({ id: 'r1' });
      occurrences.count.mockResolvedValue(1);
      const updated = await service.updateSubscription(tenantId, 'r1', manager, {
        amount: 126000,
      });
      expect(updated.amount).toBe(126000);
      await expect(
        service.updateSubscription(tenantId, 'r1', manager, {
          startDate: '2026-02-01',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateSubscription(tenantId, 'r1', manager, {
          billingInterval: 'QUARTERLY',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a PATCH whose end date is not after the stored start date', async () => {
      seedRecurring({ id: 'r1', startDate: '2026-06-01' });
      await expect(
        service.updateSubscription(tenantId, 'r1', manager, {
          endDate: '2026-05-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('changing supplierId saves the new id with no stale supplier object', async () => {
      const NEW = '33333333-3333-4333-8333-333333333333';
      seedRecurring({ id: 'r1', supplier: { id: SUPPLIER, companyName: 'Old' } });
      await service.updateSubscription(tenantId, 'r1', manager, { supplierId: NEW });
      const saved = (recurringRepo.save as jest.Mock).mock.calls[0][0];
      expect(saved.supplierId).toBe(NEW);
      expect(saved.supplier).toBeUndefined();
    });

    describe('auto-approve schedules', () => {
      beforeEach(() =>
        seedRecurring({ id: 'r1', autoApprove: true, autoApproveById: 'u-boss' }),
      );

      it('refuses an amount change from someone who cannot approve bills', async () => {
        await expect(
          service.updateSubscription(tenantId, 'r1', manager, { amount: 1 }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('allows a vendor name change from a non-approver', async () => {
        await expect(
          service.updateSubscription(tenantId, 'r1', manager, { vendorName: 'New name' }),
        ).resolves.toBeDefined();
      });

      it('ignores values sent but unchanged', async () => {
        await expect(
          service.updateSubscription(tenantId, 'r1', manager, { amount: 120000 }),
        ).resolves.toBeDefined();
      });

      it('allows an amount change from an approver', async () => {
        await expect(
          service.updateSubscription(tenantId, 'r1', managerApprover, { amount: 1 }),
        ).resolves.toBeDefined();
      });
    });

    describe('auto-approve schedules: when and how often it bills', () => {
      beforeEach(() =>
        seedRecurring({ id: 'r1', autoApprove: true, autoApproveById: 'u-boss', endDate: '2028-01-01' }),
      );

      it('refuses an interval change from someone who cannot approve bills', async () => {
        await expect(
          service.updateSubscription(tenantId, 'r1', manager, { billingInterval: 'QUARTERLY' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('refuses clearing the end date from someone who cannot approve bills', async () => {
        await expect(
          service.updateSubscription(tenantId, 'r1', manager, { endDate: null }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('refuses a start date change from someone who cannot approve bills', async () => {
        await expect(
          service.updateSubscription(tenantId, 'r1', manager, { startDate: '2026-02-01' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('allows unchanged dates, and an interval change that also turns auto-approve off', async () => {
        await expect(
          service.updateSubscription(tenantId, 'r1', manager, { endDate: '2028-01-01', startDate: '2026-01-01' }),
        ).resolves.toBeDefined();
        await expect(
          service.updateSubscription(tenantId, 'r1', manager, { autoApprove: false, billingInterval: 'QUARTERLY' }),
        ).resolves.toBeDefined();
      });
    });

    describe('references', () => {
      it('refuses a supplier that does not exist in the tenant', async () => {
        supplierRepo.findOne.mockResolvedValue(null);
        await expect(service.createSubscription(tenantId, manager, input)).rejects.toThrow(
          new BadRequestException('That supplier does not exist'),
        );
        expect(supplierRepo.findOne).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: SUPPLIER, tenantId } }),
        );
      });

      it('refuses a tax code that is not a purchase code of the tenant', async () => {
        tax.findCode.mockRejectedValue(new NotFoundException('nope'));
        await expect(
          service.createSubscription(tenantId, manager, { ...input, taxCodeId: '44444444-4444-4444-8444-444444444444' }),
        ).rejects.toThrow(new BadRequestException('That purchase tax code does not exist'));
        expect(tax.findCode).toHaveBeenCalledWith(tenantId, '44444444-4444-4444-8444-444444444444', 'PURCHASE');
      });

      it('checks a new supplier on update but not an unchanged one', async () => {
        seedRecurring({ id: 'r1' });
        await service.updateSubscription(tenantId, 'r1', manager, { supplierId: SUPPLIER, amount: 5 });
        expect(supplierRepo.findOne).not.toHaveBeenCalled();
        supplierRepo.findOne.mockResolvedValue(null);
        await expect(
          service.updateSubscription(tenantId, 'r1', manager, { supplierId: '33333333-3333-4333-8333-333333333333' }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    it('turning auto-approve off clears who it runs as', async () => {
      seedRecurring({ id: 'r1', autoApprove: true, autoApproveById: 'u-boss' });
      const updated = await service.updateSubscription(tenantId, 'r1', manager, {
        autoApprove: false,
      });
      expect(updated.autoApprove).toBe(false);
      expect(recurringRows[0].autoApproveById).toBeNull();
    });

    it('resume moves the next date to the first occurrence on or after today, no back-fill', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-16T08:00:00Z'));
      try {
        seedRecurring({
          id: 'r1',
          status: 'PAUSED',
          startDate: '2026-01-15',
          billingInterval: 'MONTHLY',
        });
        const row = await service.resumeSubscription(tenantId, 'r1');
        expect(row.status).toBe('ACTIVE');
        expect(row.nextBillingDate.slice(0, 10)).toBe('2026-11-15');
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
