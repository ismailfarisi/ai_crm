import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, MoreThanOrEqual, Repository } from 'typeorm';
import {
  calculateRunwayMonths,
  LEDGER_ROLES,
  TreasuryOverviewDto,
} from '@saas/shared';
import { FinanceAccount } from './entities/finance-account.entity';
import { CategoryBudget } from './entities/category-budget.entity';
import { RecurringExpense } from './entities/recurring-expense.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { ExpenseClaim } from './entities/expense-claim.entity';
import { LedgerService } from './ledger.service';
import { cashAccountAmount } from './fx';
import {
  CreateFinanceAccountDto,
  UpdateFinanceAccountDto,
  CreateCategoryBudgetDto,
  CreateRecurringExpenseDto,
  TransferFundsDto,
} from './dto';

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
  ) {}

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

    const recurringMonthly = recurringExpenses.reduce((sum, rec) => {
      const amt = Number(rec.amount || 0);
      return sum + (rec.billingInterval === 'ANNUAL' ? amt / 12 : amt);
    }, 0);

    const expenseMonthly = approvedExpenses.reduce(
      (sum, exp) => sum + Number(exp.amount || 0),
      0,
    );

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

    const movementByDay = new Map<string, { inflow: number; outflow: number }>();
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
        [...movementByDay.values()].reduce((sum, d) => sum + d.outflow, 0) * 100,
      ) / 100;

    // Recurring commitments are a forward-looking obligation, so they stay in
    // the burn rate even before they have been charged.
    const monthlyOutflow = Math.max(
      observedOutflow,
      recurringMonthly + expenseMonthly,
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
    const existing = await this.accountRepository.count({ where: { tenantId } });
    const isDefault = dto.isDefault === true || existing === 0;

    if (isDefault) {
      await this.accountRepository.update(
        { tenantId, isDefault: true },
        { isDefault: false },
      );
    }

    const openingBalance = Number(dto.balance) || 0;

    const account = this.accountRepository.create({
      tenantId,
      name: dto.name,
      accountType: dto.accountType,
      currency: dto.currency || 'USD',
      balance: openingBalance,
      accountNumber: dto.accountNumber || null,
      isDefault,
    });

    const saved = await this.accountRepository.save(account);

    if (openingBalance !== 0) {
      await this.postOpeningBalance(tenantId, saved, openingBalance);
    }

    return saved;
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
    const account = await this.accountRepository.findOne({
      where: { id, tenantId },
    });
    if (!account) {
      throw new NotFoundException(`Finance account ${id} not found`);
    }

    if (dto.isDefault === true) {
      await this.accountRepository.update(
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

    return this.accountRepository.save(account);
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
  ): Promise<void> {
    const referenceId = `opening-balance:${account.id}`;

    const already = await this.journalRepository.findOne({
      where: { tenantId, referenceType: 'MANUAL', referenceId },
    });
    if (already) return;

    // Tenants created before opening balance equity existed have no 3100 in
    // their chart. Provisioning is idempotent, so this only adds what is
    // missing rather than rebuilding the chart.
    await this.ledger.provisionChartOfAccounts(tenantId);

    const debitsCash = amount > 0;
    const magnitude = Math.abs(amount);

    const entry = this.journalRepository.create({
      tenantId,
      entryNumber: `JE-OB-${account.id.slice(0, 8)}`,
      referenceType: 'MANUAL',
      referenceId,
      entryDate: new Date(),
      totalAmount: magnitude,
      lines: await this.ledger.resolveLines(tenantId, [
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
      ]),
    });

    await this.journalRepository.save(entry);
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

    const fromAccount = await this.accountRepository.findOne({
      where: { id: dto.fromAccountId, tenantId },
    });
    if (!fromAccount) {
      throw new NotFoundException(
        `Source account ${dto.fromAccountId} not found`,
      );
    }

    const toAccount = await this.accountRepository.findOne({
      where: { id: dto.toAccountId, tenantId },
    });
    if (!toAccount) {
      throw new NotFoundException(
        `Destination account ${dto.toAccountId} not found`,
      );
    }

    const currentBalance = Number(fromAccount.balance);
    if (currentBalance < dto.amount) {
      throw new BadRequestException(
        `Insufficient balance in source account. Available: ${currentBalance}, Required: ${dto.amount}`,
      );
    }

    fromAccount.balance = currentBalance - dto.amount;
    toAccount.balance = Number(toAccount.balance) + dto.amount;

    await this.accountRepository.save(fromAccount);
    await this.accountRepository.save(toAccount);

    const randomSuffix = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    const entryNumber = `JE-TRF-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}${randomSuffix}`;

    const journalEntry = this.journalRepository.create({
      tenantId,
      entryNumber,
      referenceType: 'TRANSFER',
      referenceId: `${fromAccount.id}->${toAccount.id}`,
      entryDate: new Date(),
      totalAmount: dto.amount,
      lines: await this.ledger.resolveLines(tenantId, [
        {
          financeAccountId: fromAccount.id,
          accountName: fromAccount.name,
          debit: 0,
          credit: dto.amount,
          description: dto.description || `Transfer to ${toAccount.name}`,
        },
        {
          financeAccountId: toAccount.id,
          accountName: toAccount.name,
          debit: dto.amount,
          credit: 0,
          description: dto.description || `Transfer from ${fromAccount.name}`,
        },
      ]),
    });

    const savedJournal = await this.journalRepository.save(journalEntry);

    return {
      fromAccount,
      toAccount,
      journalEntry: savedJournal,
    };
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

  async findAllSubscriptions(tenantId: string): Promise<RecurringExpense[]> {
    return this.recurringRepository.find({
      where: { tenantId },
      order: { nextBillingDate: 'ASC' },
      relations: { financeAccount: true },
    });
  }

  async createSubscription(
    tenantId: string,
    dto: CreateRecurringExpenseDto,
  ): Promise<RecurringExpense> {
    const sub = this.recurringRepository.create({
      tenantId,
      vendorName: dto.vendorName,
      category: dto.category,
      amount: dto.amount,
      billingInterval: dto.billingInterval,
      nextBillingDate: new Date(dto.nextBillingDate),
      financeAccountId: dto.financeAccountId || null,
      status: dto.status || 'ACTIVE',
    });

    return this.recurringRepository.save(sub);
  }

  async findAllJournalEntries(tenantId: string): Promise<JournalEntry[]> {
    return this.journalRepository.find({
      where: { tenantId },
      order: { entryDate: 'DESC', createdAt: 'DESC' },
    });
  }
}
