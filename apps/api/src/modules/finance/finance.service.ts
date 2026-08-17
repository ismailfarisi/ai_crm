import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { calculateRunwayMonths, TreasuryOverviewDto } from '@saas/shared';
import { FinanceAccount } from './entities/finance-account.entity';
import { CategoryBudget } from './entities/category-budget.entity';
import { RecurringExpense } from './entities/recurring-expense.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { ExpenseClaim } from './entities/expense-claim.entity';
import {
  CreateFinanceAccountDto,
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

    const monthlyOutflow = recurringMonthly + expenseMonthly;
    const monthlyInflow = 0;
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

      // Match expenses on that date if any
      const dayExpenseTotal = approvedExpenses
        .filter((e) => {
          const expDate = new Date(e.expenseDate || e.createdAt)
            .toISOString()
            .split('T')[0];
          return expDate === dateStr;
        })
        .reduce((sum, e) => sum + Number(e.amount || 0), 0);

      const dayRecurring = recurringMonthly / 30;
      const dayOutflow = Math.round((dayExpenseTotal + dayRecurring) * 100) / 100;
      const dayInflow = 0;

      recentCashflowSeries.push({
        date: dateStr,
        inflow: dayInflow,
        outflow: dayOutflow,
        net: dayInflow - dayOutflow,
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
    if (dto.isDefault) {
      await this.accountRepository.update(
        { tenantId, isDefault: true },
        { isDefault: false },
      );
    }

    const account = this.accountRepository.create({
      tenantId,
      name: dto.name,
      accountType: dto.accountType,
      currency: dto.currency || 'USD',
      balance: dto.balance || 0,
      accountNumber: dto.accountNumber || null,
      isDefault: dto.isDefault ?? false,
    });

    return this.accountRepository.save(account);
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
      throw new BadRequestException('Source and destination accounts are required');
    }

    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('Cannot transfer funds to the same account');
    }

    if (!dto.amount || dto.amount <= 0) {
      throw new BadRequestException('Transfer amount must be greater than zero');
    }

    const fromAccount = await this.accountRepository.findOne({
      where: { id: dto.fromAccountId, tenantId },
    });
    if (!fromAccount) {
      throw new NotFoundException(`Source account ${dto.fromAccountId} not found`);
    }

    const toAccount = await this.accountRepository.findOne({
      where: { id: dto.toAccountId, tenantId },
    });
    if (!toAccount) {
      throw new NotFoundException(`Destination account ${dto.toAccountId} not found`);
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
      lines: [
        {
          accountId: fromAccount.id,
          accountName: fromAccount.name,
          debit: 0,
          credit: dto.amount,
          description: dto.description || `Transfer to ${toAccount.name}`,
        },
        {
          accountId: toAccount.id,
          accountName: toAccount.name,
          debit: dto.amount,
          credit: 0,
          description: dto.description || `Transfer from ${fromAccount.name}`,
        },
      ],
    });

    const savedJournal = await this.journalRepository.save(journalEntry);

    return {
      fromAccount,
      toAccount,
      journalEntry: savedJournal,
    };
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
}
