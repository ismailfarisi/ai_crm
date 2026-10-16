import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  In,
  IsNull,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import {
  addMonthsClamped,
  calculateRunwayMonths,
  daysEmployed,
  dueOccurrences,
  isoDate,
  LEDGER_ROLES,
  monthlyEquivalent,
  occurrenceDate,
  occurrenceIndexOnOrAfter,
  packageGross,
  periodBounds,
  PERMISSIONS,
  utcToday,
  TreasuryOverviewDto,
  type CashForecastDto,
  type CreateRecurringExpensePayload,
  type Permission,
  type RecurringExpenseDto,
  type RecurringOccurrenceDto,
  type UpdateRecurringExpensePayload,
} from '@saas/shared';
import { FinanceAccount } from './entities/finance-account.entity';
import { CategoryBudget } from './entities/category-budget.entity';
import { RecurringExpense } from './entities/recurring-expense.entity';
import { RecurringExpenseOccurrence } from './entities/recurring-expense-occurrence.entity';
import { SupplierBill } from '../payables/entities/supplier-bill.entity';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { ExpenseClaim } from './entities/expense-claim.entity';
import { LedgerService } from './ledger.service';
import { baseCurrencyFor, cashAccountAmount } from './fx';
import { Supplier } from '../purchasing/entities/supplier.entity';
import { TaxService } from '../tax/tax.service';
import { Employee } from '../payroll/entities/employee.entity';
import { SalaryPackage } from '../payroll/entities/salary-package.entity';
import {
  PayrollRun,
  PayrollRunLine,
} from '../payroll/entities/payroll-run.entity';
import { PensionRemittance } from '../payroll/entities/pension-remittance.entity';
import { Settlement } from '../payroll/entities/settlement.entity';
import {
  CreateFinanceAccountDto,
  UpdateFinanceAccountDto,
  CreateCategoryBudgetDto,
  TransferFundsDto,
} from './dto';

const round2 = (n: number) => Math.round(n * 100) / 100;
const toIso = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : isoDate(d);

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    @InjectRepository(FinanceAccount)
    private readonly accountRepository: Repository<FinanceAccount>,
    @InjectRepository(CategoryBudget)
    private readonly budgetRepository: Repository<CategoryBudget>,
    @InjectRepository(RecurringExpense)
    private readonly recurringRepository: Repository<RecurringExpense>,
    @InjectRepository(JournalEntry)
    private readonly journalRepository: Repository<JournalEntry>,
    @InjectRepository(ExpenseClaim)
    private readonly expenseRepository: Repository<ExpenseClaim>,
    private readonly ledger: LedgerService,
    @InjectRepository(RecurringExpenseOccurrence)
    private readonly occurrences: Repository<RecurringExpenseOccurrence>,
    @InjectRepository(SupplierBill)
    private readonly bills: Repository<SupplierBill>,
    @InjectRepository(Invoice)
    private readonly invoices: Repository<Invoice>,
    @InjectRepository(Supplier)
    private readonly suppliers: Repository<Supplier>,
    private readonly tax: TaxService,
    // Read-only: payroll owns these. Registered here as entities, never via
    // PayrollModule, which already imports this module.
    @InjectRepository(Employee)
    private readonly employees: Repository<Employee>,
    @InjectRepository(SalaryPackage)
    private readonly salaryPackages: Repository<SalaryPackage>,
    @InjectRepository(PayrollRun)
    private readonly payrollRuns: Repository<PayrollRun>,
    @InjectRepository(PayrollRunLine)
    private readonly payrollLines: Repository<PayrollRunLine>,
    @InjectRepository(PensionRemittance)
    private readonly pensionRemittances: Repository<PensionRemittance>,
    @InjectRepository(Settlement)
    private readonly settlements: Repository<Settlement>,
  ) {}

  /** The package in force on `date`: greatest effectiveFrom at or before it. */
  private packageAt(
    packages: SalaryPackage[],
    employeeId: string,
    date: string,
  ): SalaryPackage | null {
    let best: SalaryPackage | null = null;
    for (const p of packages) {
      if (p.employeeId !== employeeId) continue;
      const from = toIso(p.effectiveFrom);
      if (from > date) continue;
      if (!best || from > toIso(best.effectiveFrom)) best = p;
    }
    return best;
  }

  private gross(p: SalaryPackage): number {
    return packageGross({
      basic: Number(p.basic),
      housing: Number(p.housing),
      transport: Number(p.transport),
      otherAllowances: (p.otherAllowances ?? []).map((a) => ({
        label: a.label,
        amount: Number(a.amount),
      })),
    });
  }

  async cashForecast(
    tenantId: string,
    months: number,
  ): Promise<CashForecastDto> {
    const today = utcToday();
    const monthKeys = Array.from({ length: months }, (_, k) =>
      addMonthsClamped(`${today.slice(0, 7)}-01`, k).slice(0, 7),
    );
    const last = monthKeys[monthKeys.length - 1];
    const bucket = (iso: string): string | null => {
      const key = iso.slice(0, 7);
      if (key < monthKeys[0]) return monthKeys[0]; // overdue lands now
      return key <= last ? key : null;
    };

    const [
      accounts,
      bills,
      invoices,
      recurring,
      employees,
      packages,
      runs,
      remittances,
      approvedSettlements,
    ] =
      await Promise.all([
      this.accountRepository.find({ where: { tenantId } }),
      this.bills.find({
        where: {
          tenantId,
          status: In(['DRAFT', 'APPROVED', 'PARTIALLY_PAID']) as any,
        },
      }),
      this.invoices.find({
        where: {
          tenantId,
          status: In([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID]),
        },
      }),
      this.recurringRepository.find({ where: { tenantId, status: 'ACTIVE' } }),
      this.employees.find({ where: { tenantId, status: 'ACTIVE' as any } }),
      this.salaryPackages.find({ where: { tenantId } }),
      this.payrollRuns.find({
        where: { tenantId, status: Not('VOIDED') as any },
      }),
      this.pensionRemittances.find({
        where: { tenantId, voidedAt: IsNull() },
      }),
      this.settlements.find({ where: { tenantId, status: 'APPROVED' as any } }),
    ]);

    const rows = new Map(
      monthKeys.map((m) => [m, { inflows: 0, billsOut: 0, recurringOut: 0, payrollOut: 0, pensionOut: 0 }]),
    );
    for (const b of bills) {
      const key = bucket(toIso(b.dueDate ?? b.billDate));
      if (!key) continue;
      // Drafts have no posted rate yet, so the stored rate (default 1) is used.
      rows.get(key)!.billsOut +=
        (Number(b.totalAmount) - Number(b.paidAmount || 0)) *
        Number(b.fxRate || 1);
    }
    for (const inv of invoices) {
      const key = bucket(inv.dueDate ? toIso(inv.dueDate) : today);
      if (!key) continue;
      // Open balance as the customer statement defines it: credit notes
      // reduce what is owed, refunds of those credits put it back.
      const open = Math.max(
        0,
        Number(inv.amount) -
          Number(inv.paidAmount ?? 0) -
          Number(inv.creditedAmount || 0) +
          Number(inv.refundedAmount || 0),
      );
      rows.get(key)!.inflows += open * Number(inv.fxRate || 1);
    }
    // Projected with the tax the generated bill will carry (the amount is
    // net), looked up once per code/supplier pair.
    const rates = new Map<string, Promise<number>>();
    const rateFor = (r: RecurringExpense): Promise<number> => {
      const key = `${r.taxCodeId ?? ''}|${r.supplierId ?? ''}`;
      if (!rates.has(key)) {
        rates.set(
          key,
          this.tax
            .purchaseTaxFor(tenantId, r.taxCodeId, r.supplierId)
            .then((t) => t.rate)
            .catch(() => 0),
        );
      }
      return rates.get(key)!;
    };
    for (const r of recurring) {
      // Only periods not yet generated, and never the past: a row without a
      // supplier is never billed, so its nextBillingDate never moves, and its
      // old periods are not cash still to go out.
      const nextIso = toIso(r.nextBillingDate);
      const fromIndex = occurrenceIndexOnOrAfter(
        r.startDate,
        r.billingInterval,
        nextIso > today ? nextIso : today,
      );
      const gross = round2(Number(r.amount) * (1 + (await rateFor(r)) / 100));
      for (const n of dueOccurrences({
        startDate: r.startDate,
        endDate: r.endDate,
        interval: r.billingInterval,
        fromIndex,
        today: `${last}-31`,
      })) {
        const key = bucket(occurrenceDate(r.startDate, n, r.billingInterval));
        if (key) rows.get(key)!.recurringOut += gross;
      }
    }

    // Payroll. A run decides its own period: approved runs owe only their
    // unpaid lines, drafts their current total, paid ones nothing. Periods
    // with no run are projected from current packages.
    const runPeriods = new Set(runs.map((r) => r.period));
    const owing = runs.filter(
      (r) => r.status === 'APPROVED' || r.status === 'PARTIALLY_PAID',
    );
    const unpaid = new Map<string, number>();
    if (owing.length) {
      const lines = await this.payrollLines.find({
        where: {
          tenantId,
          runId: In(owing.map((r) => r.id)),
          paidAt: IsNull(),
        },
      });
      for (const l of lines) {
        unpaid.set(l.runId, (unpaid.get(l.runId) ?? 0) + Number(l.netPay));
      }
    }
    for (const r of runs) {
      let amount = 0;
      if (r.status === 'DRAFT') amount = Number(r.totalNet);
      else if (r.status === 'APPROVED' || r.status === 'PARTIALLY_PAID')
        amount = unpaid.get(r.id) ?? 0;
      if (!amount) continue;
      const key = bucket(toIso(r.payDate));
      if (key) rows.get(key)!.payrollOut += amount;
    }
    for (const month of monthKeys) {
      if (runPeriods.has(month)) continue;
      const { last: monthEnd } = periodBounds(month);
      let projected = 0;
      for (const e of employees) {
        if (
          daysEmployed({
            period: month,
            joiningDate: toIso(e.joiningDate),
            leavingDate: e.leavingDate ? toIso(e.leavingDate) : null,
          }) <= 0
        )
          continue;
        const pkg = this.packageAt(packages, e.id, monthEnd);
        if (pkg) projected += this.gross(pkg);
      }
      const key = bucket(`${month}-28`);
      if (key) rows.get(key)!.payrollOut += projected;
    }

    // Approved, unpaid final settlements are owed now.
    for (const st of approvedSettlements) {
      const key = bucket(today);
      if (key) rows.get(key)!.payrollOut += Number(st.netPay);
    }

    // Pension: a posted run's contributions are due to the fund on the 15th of
    // the following month, until a live remittance covers its period.
    const remitted = new Set(remittances.map((r) => r.period));
    const posted = runs.filter(
      (r) =>
        ['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(r.status) &&
        !remitted.has(r.period),
    );
    if (posted.length) {
      const pensionLines = await this.payrollLines.find({
        where: { tenantId, runId: In(posted.map((r) => r.id)) },
      });
      const byRun = new Map<string, number>();
      for (const l of pensionLines) {
        byRun.set(
          l.runId,
          (byRun.get(l.runId) ?? 0) +
            Number(l.pensionEmployee || 0) +
            Number(l.pensionEmployer || 0),
        );
      }
      for (const r of posted) {
        const amount = byRun.get(r.id) ?? 0;
        if (!amount) continue;
        const due = `${addMonthsClamped(`${r.period}-01`, 1).slice(0, 7)}-15`;
        const key = bucket(due);
        if (key) rows.get(key)!.pensionOut += amount;
      }
    }

    let opening = round2(
      accounts.reduce((s, a) => s + Number(a.balance || 0), 0),
    );
    const out = monthKeys.map((month) => {
      const r = rows.get(month)!;
      const closing = round2(
        opening + r.inflows -
          r.billsOut -
          r.recurringOut -
          r.payrollOut -
          r.pensionOut,
      );
      const row = {
        month,
        opening,
        inflows: round2(r.inflows),
        billsOut: round2(r.billsOut),
        recurringOut: round2(r.recurringOut),
        payrollOut: round2(r.payrollOut),
        pensionOut: round2(r.pensionOut),
        closing,
      };
      opening = closing;
      return row;
    });
    return {
      baseCurrency: await baseCurrencyFor(this.accountRepository.manager, tenantId),
      months: out,
    };
  }

  async getOverview(tenantId: string): Promise<TreasuryOverviewDto> {
    const accounts = await this.accountRepository.find({
      where: { tenantId },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });

    const recurringExpenses = await this.recurringRepository.find({
      where: { tenantId, status: 'ACTIVE' },
    });

    const expenseClaims = await this.expenseRepository.find({
      where: { tenantId },
    });

    const approvedExpenses = expenseClaims.filter(
      (e) => e.status === 'APPROVED' || e.status === 'PAID',
    );

    const totalCash = accounts.reduce(
      (sum, acc) => sum + Number(acc.balance || 0),
      0,
    );

    const recurringMonthly = recurringExpenses.reduce(
      (sum, rec) =>
        sum + monthlyEquivalent(Number(rec.amount || 0), rec.billingInterval),
      0,
    );

    // A month's worth of claims, averaged over the last quarter. Summing
    // every claim ever approved made the burn rate grow for ever.
    const claimsSince = new Date();
    claimsSince.setUTCDate(claimsSince.getUTCDate() - 90);
    const expenseMonthly =
      approvedExpenses
        .filter((e) => new Date(e.expenseDate ?? e.createdAt) >= claimsSince)
        .reduce((sum, exp) => sum + Number(exp.amount || 0), 0) / 3;

    // What actually moved through the bank over the last 30 days, taken from
    // posted journal lines rather than assumed. Internal transfers are left
    // out because moving money between your own accounts is not cashflow, and
    // so are opening balances, which are a starting position rather than a
    // receipt. Inflow used to be hardcoded to zero, so a company that had been
    // paid still showed no money coming in.
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - 29);
    windowStart.setHours(0, 0, 0, 0);

    const cashMovements = await this.journalRepository.find({
      where: { tenantId, entryDate: MoreThanOrEqual(windowStart) },
    });

    const movementByDay = new Map<
      string,
      { inflow: number; outflow: number }
    >();
    for (const entry of cashMovements) {
      if (entry.referenceType === 'TRANSFER') continue;
      if (
        entry.referenceType === 'MANUAL' &&
        String(entry.referenceId ?? '').startsWith('opening-balance:')
      ) {
        continue;
      }

      const day = new Date(entry.entryDate).toISOString().split('T')[0];
      const bucket = movementByDay.get(day) ?? { inflow: 0, outflow: 0 };

      for (const line of entry.lines ?? []) {
        if (!line.financeAccountId) continue;
        bucket.inflow += Number(line.debit || 0);
        bucket.outflow += Number(line.credit || 0);
      }

      movementByDay.set(day, bucket);
    }

    const monthlyInflow =
      Math.round(
        [...movementByDay.values()].reduce((sum, d) => sum + d.inflow, 0) * 100,
      ) / 100;
    const observedOutflow =
      Math.round(
        [...movementByDay.values()].reduce((sum, d) => sum + d.outflow, 0) *
          100,
      ) / 100;

    // Recurring commitments are a forward-looking obligation, so they stay in
    // the burn rate even before they have been charged.
    const [activeEmployees, allPackages] = await Promise.all([
      this.employees.find({ where: { tenantId, status: 'ACTIVE' as any } }),
      this.salaryPackages.find({ where: { tenantId } }),
    ]);
    const todayIso = utcToday();
    const payrollMonthly = round2(
      activeEmployees.reduce((sum, e) => {
        const pkg = this.packageAt(allPackages, e.id, todayIso);
        return sum + (pkg ? this.gross(pkg) : 0);
      }, 0),
    );
    const monthlyOutflow = Math.max(
      observedOutflow,
      recurringMonthly + expenseMonthly + payrollMonthly,
    );
    const netCashflow = monthlyInflow - monthlyOutflow;
    const monthlyBurnRate = monthlyOutflow;
    const runwayMonths = calculateRunwayMonths(totalCash, monthlyBurnRate);

    // Build 30-day cashflow series
    const recentCashflowSeries: Array<{
      date: string;
      inflow: number;
      outflow: number;
      net: number;
    }> = [];

    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      const moved = movementByDay.get(dateStr) ?? { inflow: 0, outflow: 0 };
      const dayInflow = Math.round(moved.inflow * 100) / 100;
      const dayOutflow = Math.round(moved.outflow * 100) / 100;

      recentCashflowSeries.push({
        date: dateStr,
        inflow: dayInflow,
        outflow: dayOutflow,
        net: Math.round((dayInflow - dayOutflow) * 100) / 100,
      });
    }

    return {
      totalCash,
      currency: accounts[0]?.currency || 'USD',
      monthlyInflow,
      monthlyOutflow,
      netCashflow,
      monthlyBurnRate,
      runwayMonths,
      accounts: accounts as any,
      recentCashflowSeries,
    };
  }

  async findAllAccounts(tenantId: string): Promise<FinanceAccount[]> {
    return this.accountRepository.find({
      where: { tenantId },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  async createAccount(
    tenantId: string,
    dto: CreateFinanceAccountDto,
  ): Promise<FinanceAccount> {
    /*
     * The first account a tenant opens becomes the default whether or not the
     * box was ticked. Nothing else can be the default, and "DEFAULT ACCOUNT:
     * None set" beside a tenant's only account is never the answer anyone
     * wants — it also leaves expense reimbursement with no account to pay
     * from, which is the point at which it starts costing money rather than
     * looking odd.
     */
    /*
     * Clearing the old default, saving the account and posting its opening
     * balance commit together: a failed posting must not leave an account
     * whose balance the ledger never heard of, nor a tenant whose default was
     * cleared with nothing to replace it.
     */
    return this.accountRepository.manager.transaction(async (manager) => {
      const accounts = manager.getRepository(FinanceAccount);
      await this.lockDefaultAccount(manager, tenantId);

      const existing = await accounts.count({ where: { tenantId } });
      const isDefault = dto.isDefault === true || existing === 0;

      if (isDefault) {
        await accounts.update(
          { tenantId, isDefault: true },
          { isDefault: false },
        );
      }

      const openingBalance = Number(dto.balance) || 0;

      const account = accounts.create({
        tenantId,
        name: dto.name,
        accountType: dto.accountType,
        currency: dto.currency || 'USD',
        balance: openingBalance,
        accountNumber: dto.accountNumber || null,
        isDefault,
      });

      const saved = await accounts.save(account);

      if (openingBalance !== 0) {
        await this.postOpeningBalance(tenantId, saved, openingBalance, manager);
      }

      return saved;
    });
  }

  /**
   * Serialises everything that decides which of a tenant's accounts is the
   * default. Without it two accounts created (or promoted) at once each clear
   * the flag and then set their own, leaving two defaults. An advisory lock
   * rather than a row lock because the first account has no row to lock yet.
   * Released when the transaction ends.
   */
  private async lockDefaultAccount(
    manager: EntityManager,
    tenantId: string,
  ): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `finance_accounts:default:${tenantId}`,
    ]);
  }

  /**
   * Renames an account, or moves the default flag onto it.
   *
   * There was no way to change either after creation, so a tenant who missed
   * the checkbox had no route back to a default account at all. The balance is
   * deliberately not editable here: it is the ledger's to move, through a
   * posting, not a form.
   */
  async updateAccount(
    tenantId: string,
    id: string,
    dto: UpdateFinanceAccountDto,
  ): Promise<FinanceAccount> {
    return this.accountRepository.manager.transaction(async (manager) => {
      const accounts = manager.getRepository(FinanceAccount);
      if (dto.isDefault !== undefined) {
        await this.lockDefaultAccount(manager, tenantId);
      }

      const account = await accounts.findOne({
        where: { id, tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!account) {
        throw new NotFoundException(`Finance account ${id} not found`);
      }

      // Clearing the old default and setting the new one commit together, so
      // a failure in between cannot leave the tenant with no default at all.
      if (dto.isDefault === true) {
        await accounts.update(
          { tenantId, isDefault: true },
          { isDefault: false },
        );
        account.isDefault = true;
      } else if (dto.isDefault === false) {
        account.isDefault = false;
      }

      if (dto.name !== undefined) account.name = dto.name;
      if (dto.accountNumber !== undefined) {
        account.accountNumber = dto.accountNumber || null;
      }

      return accounts.save(account);
    });
  }

  /**
   * Puts a new account's starting figure into the books.
   *
   * Without this the account carries a balance that treasury reports and the
   * ledger does not, so the balance sheet understates assets by every opening
   * balance ever entered and no account can be reconciled against a statement.
   *
   * The contra is opening balance equity rather than income: money the tenant
   * already had when they arrived is not revenue earned here. Idempotent on
   * `referenceId`, so a retry cannot double the opening position.
   */
  private async postOpeningBalance(
    tenantId: string,
    account: FinanceAccount,
    amount: number,
    manager: EntityManager = this.journalRepository.manager,
  ): Promise<void> {
    const referenceId = `opening-balance:${account.id}`;
    const journal = manager.getRepository(JournalEntry);

    const already = await journal.findOne({
      where: { tenantId, referenceType: 'MANUAL', referenceId },
    });
    if (already) return;

    // Tenants created before opening balance equity existed have no 3100 in
    // their chart. Provisioning is idempotent, so this only adds what is
    // missing rather than rebuilding the chart.
    await this.ledger.provisionChartOfAccounts(tenantId, manager);

    const debitsCash = amount > 0;
    const magnitude = Math.abs(amount);

    const entry = journal.create({
      tenantId,
      entryNumber: `JE-OB-${account.id.slice(0, 8)}`,
      referenceType: 'MANUAL',
      referenceId,
      entryDate: new Date(),
      totalAmount: magnitude,
      lines: await this.ledger.resolveLines(
        tenantId,
        [
          {
            financeAccountId: account.id,
            accountName: account.name,
            debit: debitsCash ? magnitude : 0,
            credit: debitsCash ? 0 : magnitude,
            description: `Opening balance for ${account.name}`,
          },
          {
            role: LEDGER_ROLES.OPENING_BALANCE_EQUITY,
            accountName: 'Opening balance equity',
            debit: debitsCash ? 0 : magnitude,
            credit: debitsCash ? magnitude : 0,
            description: `Opening balance for ${account.name}`,
          },
        ],
        manager,
      ),
    });

    await journal.save(entry);
  }

  async transferFunds(
    tenantId: string,
    dto: TransferFundsDto,
  ): Promise<{
    fromAccount: FinanceAccount;
    toAccount: FinanceAccount;
    journalEntry: JournalEntry;
  }> {
    if (!dto.fromAccountId || !dto.toAccountId) {
      throw new BadRequestException(
        'Source and destination accounts are required',
      );
    }

    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException(
        'Cannot transfer funds to the same account',
      );
    }

    if (!dto.amount || dto.amount <= 0) {
      throw new BadRequestException(
        'Transfer amount must be greater than zero',
      );
    }

    const amount = dto.amount;

    /*
     * One transaction for both balances and the journal, so a failure part
     * way leaves nothing moved. Both rows are locked before the balance is
     * read — otherwise two transfers out of one account could each pass the
     * check against the same figure — and they are locked in id order, so a
     * transfer A→B and a simultaneous B→A cannot each hold one lock while
     * waiting for the other.
     */
    return this.accountRepository.manager.transaction(async (manager) => {
      const accounts = manager.getRepository(FinanceAccount);
      const locked = new Map<string, FinanceAccount | null>();
      for (const id of [dto.fromAccountId, dto.toAccountId].sort()) {
        locked.set(
          id,
          await accounts.findOne({
            where: { id, tenantId },
            lock: { mode: 'pessimistic_write' },
          }),
        );
      }

      const fromAccount = locked.get(dto.fromAccountId);
      if (!fromAccount) {
        throw new NotFoundException(
          `Source account ${dto.fromAccountId} not found`,
        );
      }
      const toAccount = locked.get(dto.toAccountId);
      if (!toAccount) {
        throw new NotFoundException(
          `Destination account ${dto.toAccountId} not found`,
        );
      }

      const currentBalance = Number(fromAccount.balance);
      if (currentBalance < amount) {
        throw new BadRequestException(
          `Insufficient balance in source account. Available: ${currentBalance}, Required: ${amount}`,
        );
      }

      // Relative, never read-modify-write, the same as invoice payments: the
      // database does the arithmetic on the numeric column.
      await manager.query(
        `UPDATE "finance_accounts" SET "balance" = "balance" - $1, "updatedAt" = now()
         WHERE "id" = $2 AND "tenantId" = $3`,
        [amount, fromAccount.id, tenantId],
      );
      await manager.query(
        `UPDATE "finance_accounts" SET "balance" = "balance" + $1, "updatedAt" = now()
         WHERE "id" = $2 AND "tenantId" = $3`,
        [amount, toAccount.id, tenantId],
      );

      const randomSuffix = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, '0');
      const entryNumber = `JE-TRF-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}${randomSuffix}`;

      const journal = manager.getRepository(JournalEntry);
      const journalEntry = journal.create({
        tenantId,
        entryNumber,
        referenceType: 'TRANSFER',
        referenceId: `${fromAccount.id}->${toAccount.id}`,
        entryDate: new Date(),
        totalAmount: amount,
        lines: await this.ledger.resolveLines(
          tenantId,
          [
            {
              financeAccountId: fromAccount.id,
              accountName: fromAccount.name,
              debit: 0,
              credit: amount,
              description: dto.description || `Transfer to ${toAccount.name}`,
            },
            {
              financeAccountId: toAccount.id,
              accountName: toAccount.name,
              debit: amount,
              credit: 0,
              description:
                dto.description || `Transfer from ${fromAccount.name}`,
            },
          ],
          manager,
        ),
      });

      const savedJournal = await journal.save(journalEntry);

      // Re-read rather than echo a figure computed here, so the response
      // carries what the database actually holds.
      const fromAfter = await accounts.findOne({
        where: { id: fromAccount.id, tenantId },
      });
      const toAfter = await accounts.findOne({
        where: { id: toAccount.id, tenantId },
      });

      return {
        fromAccount: fromAfter ?? fromAccount,
        toAccount: toAfter ?? toAccount,
        journalEntry: savedJournal,
      };
    });
  }

  async recordInvoicePayment(
    tenantId: string,
    params: {
      invoiceId: string;
      accountId: string;
      amount: number;
      description?: string;
      /**
       * Currency and rates, when the invoice is not in base currency. The
       * receivable clears at the invoice's rate; the cash arrives at the
       * payment's. Omitted, everything is at 1, as before.
       */
      fx?: { currency: string; invoiceRate: number; paymentRate: number };
    },
    manager: EntityManager = this.accountRepository.manager,
  ): Promise<{ account: FinanceAccount; journalEntry: JournalEntry }> {
    if (!params.amount || params.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const accounts = manager.getRepository(FinanceAccount);
    const exists = await accounts.findOne({
      where: { id: params.accountId, tenantId },
    });
    if (!exists) {
      throw new NotFoundException(`Account ${params.accountId} not found`);
    }

    const arriving = params.fx
      ? await cashAccountAmount(manager, tenantId, exists, {
          amount: params.amount,
          currency: params.fx.currency,
          rate: params.fx.paymentRate,
        })
      : params.amount;

    // Relative, never read-modify-write: two payments landing in the same
    // account at once would otherwise lose one of them from the balance.
    await manager.query(
      `UPDATE "finance_accounts" SET "balance" = "balance" + $1, "updatedAt" = now()
       WHERE "id" = $2 AND "tenantId" = $3`,
      [arriving, params.accountId, tenantId],
    );
    const account = (await accounts.findOne({
      where: { id: params.accountId, tenantId },
    })) as FinanceAccount;

    const randomSuffix = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    const entryNumber = `JE-INV-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}${randomSuffix}`;
    const description = params.description || `Invoice payment received`;

    const journal = manager.getRepository(JournalEntry);
    const journalEntry = journal.create({
      tenantId,
      entryNumber,
      referenceType: 'INVOICE',
      referenceId: params.invoiceId,
      entryDate: new Date(),
      totalAmount: params.amount,
      currency: params.fx?.currency ?? null,
      fxRate: params.fx?.paymentRate ?? 1,
      lines: await this.ledger.resolveLines(
        tenantId,
        [
          {
            financeAccountId: account.id,
            accountName: account.name,
            debit: params.amount,
            credit: 0,
            fxRate: params.fx?.paymentRate,
            description,
          },
          {
            role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
            accountName: 'Accounts Receivable',
            debit: 0,
            credit: params.amount,
            fxRate: params.fx?.invoiceRate,
            description,
          },
        ],
        manager,
        params.fx?.paymentRate ?? 1,
      ),
    });

    const savedJournal = await journal.save(journalEntry);

    return { account, journalEntry: savedJournal };
  }

  /**
   * Reverses a previously recorded invoice payment (e.g. when the invoice is
   * voided) — mirrors `recordInvoicePayment`'s lines exactly in reverse. No
   * insufficient-balance guard: this is a bookkeeping correction for cash
   * already recorded, not a live funds check (`recordInvoicePayment` has no
   * upper bound either).
   */
  async reverseInvoicePayment(
    tenantId: string,
    params: {
      invoiceId: string;
      paymentId: string;
      accountId: string;
      amount: number;
      description?: string;
      /** The rates the payment was recorded at, so the reversal mirrors it exactly. */
      fx?: { currency: string; invoiceRate: number; paymentRate: number };
    },
    manager: EntityManager = this.accountRepository.manager,
  ): Promise<{ account: FinanceAccount; journalEntry: JournalEntry }> {
    if (!params.amount || params.amount <= 0) {
      throw new BadRequestException(
        'Reversal amount must be greater than zero',
      );
    }

    const accounts = manager.getRepository(FinanceAccount);
    const exists = await accounts.findOne({
      where: { id: params.accountId, tenantId },
    });
    if (!exists) {
      throw new NotFoundException(`Account ${params.accountId} not found`);
    }

    const leaving = params.fx
      ? await cashAccountAmount(manager, tenantId, exists, {
          amount: params.amount,
          currency: params.fx.currency,
          rate: params.fx.paymentRate,
        })
      : params.amount;

    await manager.query(
      `UPDATE "finance_accounts" SET "balance" = "balance" - $1, "updatedAt" = now()
       WHERE "id" = $2 AND "tenantId" = $3`,
      [leaving, params.accountId, tenantId],
    );
    const account = (await accounts.findOne({
      where: { id: params.accountId, tenantId },
    })) as FinanceAccount;

    const randomSuffix = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    const entryNumber = `JE-VOID-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}${randomSuffix}`;
    const description = params.description || 'Invoice payment reversal';

    const journal = manager.getRepository(JournalEntry);
    const journalEntry = journal.create({
      tenantId,
      entryNumber,
      referenceType: 'INVOICE',
      referenceId: params.paymentId,
      entryDate: new Date(),
      totalAmount: params.amount,
      currency: params.fx?.currency ?? null,
      fxRate: params.fx?.paymentRate ?? 1,
      lines: await this.ledger.resolveLines(
        tenantId,
        [
          {
            role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
            accountName: 'Accounts Receivable',
            debit: params.amount,
            credit: 0,
            fxRate: params.fx?.invoiceRate,
            description,
          },
          {
            financeAccountId: account.id,
            accountName: account.name,
            debit: 0,
            credit: params.amount,
            fxRate: params.fx?.paymentRate,
            description,
          },
        ],
        manager,
        params.fx?.paymentRate ?? 1,
      ),
    });

    const savedJournal = await journal.save(journalEntry);

    return { account, journalEntry: savedJournal };
  }

  async findAllBudgets(tenantId: string): Promise<CategoryBudget[]> {
    return this.budgetRepository.find({
      where: { tenantId },
      order: { category: 'ASC' },
    });
  }

  async createBudget(
    tenantId: string,
    dto: CreateCategoryBudgetDto,
  ): Promise<CategoryBudget> {
    const budget = this.budgetRepository.create({
      tenantId,
      category: dto.category,
      period: dto.period,
      budgetAmount: dto.budgetAmount,
      spentAmount: dto.spentAmount || 0,
      alertThresholdPercent: dto.alertThresholdPercent ?? 80,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    });

    return this.budgetRepository.save(budget);
  }

  private assertCanAutoApprove(actor: { permissions: Permission[] }, wants: boolean | undefined) {
    // Same rule as assertActorCanGrant: compared with what this actor holds.
    // A finance manager who cannot approve bills must not be able to set up
    // bills that approve themselves.
    if (wants && !actor.permissions.includes(PERMISSIONS.BILL_APPROVE)) {
      throw new ForbiddenException('Only someone who can approve bills can turn on auto-approve.');
    }
  }

  private toDto(row: RecurringExpense, last?: RecurringExpenseOccurrence | null): RecurringExpenseDto {
    return {
      id: row.id, tenantId: row.tenantId,
      supplierId: row.supplierId, supplierName: row.supplier?.companyName ?? null,
      vendorName: row.vendorName, category: row.category, amount: row.amount,
      currency: row.supplier?.currency ?? null,
      billingInterval: row.billingInterval, startDate: row.startDate, endDate: row.endDate,
      nextBillingDate: row.nextBillingDate.toISOString(),
      taxCodeId: row.taxCodeId, autoApprove: row.autoApprove, spreadOverPeriod: row.spreadOverPeriod,
      financeAccountId: row.financeAccountId, status: row.status,
      lastOccurrenceStatus: last?.status ?? null,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  async findAllSubscriptions(tenantId: string): Promise<RecurringExpenseDto[]> {
    const rows = await this.recurringRepository.find({
      where: { tenantId },
      order: { nextBillingDate: 'ASC' },
      relations: { financeAccount: true, supplier: true },
    });
    const last = rows.length
      ? await this.occurrences
          .createQueryBuilder('o')
          .distinctOn(['o.recurringExpenseId'])
          .where('o.tenantId = :tenantId', { tenantId })
          .orderBy('o.recurringExpenseId')
          .addOrderBy('o.periodStart', 'DESC')
          .getMany()
      : [];
    const byId = new Map(last.map((o) => [o.recurringExpenseId, o]));
    return rows.map((r) => this.toDto(r, byId.get(r.id)));
  }

  async createSubscription(
    tenantId: string,
    actor: { userId: string; permissions: Permission[] },
    input: CreateRecurringExpensePayload,
  ): Promise<RecurringExpenseDto> {
    this.assertCanAutoApprove(actor, input.autoApprove);
    await this.assertReferences(tenantId, input);
    const saved = await this.recurringRepository.save(
      this.recurringRepository.create({
        tenantId,
        ...input,
        nextBillingDate: new Date(`${input.startDate}T00:00:00Z`),
        autoApproveById: input.autoApprove ? actor.userId : null,
        createdById: actor.userId,
        status: 'ACTIVE',
      }),
    );
    return this.findSubscription(tenantId, saved.id);
  }

  /** A supplier and purchase tax code the schedule points at must exist in this tenant. */
  private async assertReferences(
    tenantId: string,
    input: { supplierId?: string | null; taxCodeId?: string | null },
  ): Promise<void> {
    if (input.supplierId) {
      // Soft-deleted suppliers are excluded by find.
      const supplier = await this.suppliers.findOne({
        where: { id: input.supplierId, tenantId },
        select: { id: true },
      });
      if (!supplier) throw new BadRequestException('That supplier does not exist');
    }
    if (input.taxCodeId) {
      try {
        await this.tax.findCode(tenantId, input.taxCodeId, 'PURCHASE');
      } catch (err) {
        if (err instanceof NotFoundException) {
          throw new BadRequestException('That purchase tax code does not exist');
        }
        throw err;
      }
    }
  }

  private async findSubscriptionRow(tenantId: string, id: string): Promise<RecurringExpense> {
    const row = await this.recurringRepository.findOne({ where: { id, tenantId }, relations: { supplier: true } });
    if (!row) throw new NotFoundException('Recurring expense not found');
    return row;
  }

  async findSubscription(tenantId: string, id: string): Promise<RecurringExpenseDto> {
    const row = await this.findSubscriptionRow(tenantId, id);
    const last = await this.occurrences.findOne({ where: { tenantId, recurringExpenseId: id }, order: { periodStart: 'DESC' } });
    return this.toDto(row, last);
  }

  async updateSubscription(
    tenantId: string,
    id: string,
    actor: { userId: string; permissions: Permission[] },
    input: UpdateRecurringExpensePayload,
  ): Promise<RecurringExpenseDto> {
    const row = await this.findSubscriptionRow(tenantId, id);
    const reshapes =
      (input.startDate !== undefined && input.startDate !== row.startDate) ||
      (input.billingInterval !== undefined && input.billingInterval !== row.billingInterval);
    if (reshapes && (await this.occurrences.count({ where: { tenantId, recurringExpenseId: id } })) > 0) {
      throw new BadRequestException('The start date and interval cannot change once a bill has been generated. Cancel this one and create a new schedule.');
    }
    await this.assertReferences(tenantId, {
      supplierId: input.supplierId !== row.supplierId ? input.supplierId : undefined,
      taxCodeId: input.taxCodeId !== row.taxCodeId ? input.taxCodeId : undefined,
    });
    if (row.autoApprove && input.autoApprove !== false) {
      // A schedule that approves its own bills is changed only by someone who
      // could approve those bills; sent-but-unchanged values don't count.
      const changesMoney = (
        [
          'amount',
          'supplierId',
          'taxCodeId',
          'category',
          'spreadOverPeriod',
          // When and how often it bills is what gets approved, too.
          'billingInterval',
          'startDate',
          'endDate',
        ] as const
      ).some((k) => input[k] !== undefined && input[k] !== row[k]);
      if (changesMoney && !actor.permissions.includes(PERMISSIONS.BILL_APPROVE)) {
        throw new ForbiddenException(
          'Only someone who can approve bills can change a schedule that approves its own bills.',
        );
      }
    }
    if (input.autoApprove === true && !row.autoApprove) {
      this.assertCanAutoApprove(actor, true);
      row.autoApproveById = actor.userId;
    }
    if (input.autoApprove === false) row.autoApproveById = null;

    Object.assign(row, input);
    // The loaded relation would win over the new supplierId on save.
    if (input.supplierId !== undefined) row.supplier = undefined;
    if (row.endDate && row.endDate <= row.startDate) {
      throw new BadRequestException('The end date must be after the start');
    }
    if (row.billingInterval === 'MONTHLY') row.spreadOverPeriod = false;
    if (input.startDate !== undefined && reshapes) row.nextBillingDate = new Date(`${row.startDate}T00:00:00Z`);
    await this.recurringRepository.save(row);
    return this.findSubscription(tenantId, id);
  }

  async pauseSubscription(tenantId: string, id: string): Promise<RecurringExpenseDto> {
    const row = await this.findSubscriptionRow(tenantId, id);
    if (row.status !== 'ACTIVE') throw new BadRequestException('Only an active schedule can be paused');
    row.status = 'PAUSED';
    await this.recurringRepository.save(row);
    return this.findSubscription(tenantId, id);
  }

  async resumeSubscription(tenantId: string, id: string): Promise<RecurringExpenseDto> {
    const row = await this.findSubscriptionRow(tenantId, id);
    if (row.status !== 'PAUSED') throw new BadRequestException('Only a paused schedule can be resumed');
    // Paused months are deliberately not back-generated.
    const n = occurrenceIndexOnOrAfter(row.startDate, row.billingInterval, utcToday());
    row.nextBillingDate = new Date(`${occurrenceDate(row.startDate, n, row.billingInterval)}T00:00:00Z`);
    row.status = 'ACTIVE';
    await this.recurringRepository.save(row);
    return this.findSubscription(tenantId, id);
  }

  async cancelSubscription(tenantId: string, id: string): Promise<RecurringExpenseDto> {
    const row = await this.findSubscriptionRow(tenantId, id);
    row.status = 'CANCELLED';
    await this.recurringRepository.save(row);
    return this.findSubscription(tenantId, id);
  }

  async listOccurrences(tenantId: string, id: string): Promise<RecurringOccurrenceDto[]> {
    await this.findSubscriptionRow(tenantId, id);
    const rows = await this.occurrences.find({ where: { tenantId, recurringExpenseId: id }, order: { periodStart: 'DESC' } });
    const billIds = rows.map((r) => r.billId).filter((v): v is string => Boolean(v));
    const bills = billIds.length
      ? await this.recurringRepository.manager.getRepository(SupplierBill).find({ where: { tenantId, id: In(billIds) }, select: { id: true, billNumber: true } })
      : [];
    const numbers = new Map(bills.map((b) => [b.id, b.billNumber]));
    return rows.map((r) => ({
      id: r.id, periodStart: r.periodStart, periodEnd: r.periodEnd, amount: r.amount,
      billId: r.billId, billNumber: r.billId ? (numbers.get(r.billId) ?? null) : null,
      status: r.status, error: r.error, attempts: r.attempts, createdAt: r.createdAt.toISOString(),
    }));
  }

  async findAllJournalEntries(tenantId: string): Promise<JournalEntry[]> {
    return this.journalRepository.find({
      where: { tenantId },
      order: { entryDate: 'DESC', createdAt: 'DESC' },
    });
  }
}
