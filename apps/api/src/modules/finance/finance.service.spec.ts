import type { JournalLineInput } from '@saas/shared';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { FinanceService } from './finance.service';
import { LedgerService } from './ledger.service';
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

describe('FinanceService', () => {
  let service: FinanceService;
  let ledger: { resolveLines: jest.Mock };
  let accountRepo: jest.Mocked<Partial<Repository<FinanceAccount>>>;
  let budgetRepo: jest.Mocked<Partial<Repository<CategoryBudget>>>;
  let recurringRepo: jest.Mocked<Partial<Repository<RecurringExpense>>>;
  let journalRepo: jest.Mocked<Partial<Repository<JournalEntry>>>;
  let expenseRepo: jest.Mocked<Partial<Repository<ExpenseClaim>>>;

  const tenantId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    accountRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => ({ id: 'acc-1', ...dto })),
      save: jest
        .fn()
        .mockImplementation(async (acc) => ({ id: 'acc-1', ...acc })),
      update: jest.fn().mockResolvedValue({} as any),
    };
    // Invoice payments move the balance with a relative UPDATE through the
    // manager. The fake applies it to whatever `findOne` currently returns,
    // so the balance assertions still read the effect.
    (accountRepo as any).manager = {
      getRepository: (entity: { name: string }) =>
        entity.name === 'JournalEntry' ? journalRepo : accountRepo,
      query: jest.fn(async (sql: string, params: unknown[]) => {
        const account = await accountRepo.findOne!({});
        if (account && sql.includes('"balance" = "balance" +')) {
          account.balance = Number(account.balance) + Number(params[0]);
        } else if (account && sql.includes('"balance" = "balance" -')) {
          account.balance = Number(account.balance) - Number(params[0]);
        }
        return [];
      }),
    };

    budgetRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => ({ id: 'bud-1', ...dto })),
      save: jest
        .fn()
        .mockImplementation(async (bud) => ({ id: 'bud-1', ...bud })),
    };

    recurringRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => ({ id: 'rec-1', ...dto })),
      save: jest
        .fn()
        .mockImplementation(async (rec) => ({ id: 'rec-1', ...rec })),
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

    service = new FinanceService(
      accountRepo as unknown as Repository<FinanceAccount>,
      budgetRepo as unknown as Repository<CategoryBudget>,
      recurringRepo as unknown as Repository<RecurringExpense>,
      journalRepo as unknown as Repository<JournalEntry>,
      expenseRepo as unknown as Repository<ExpenseClaim>,
      ledger as unknown as LedgerService,
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
          balance: 10000,
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
          amount: 2500,
          status: 'APPROVED',
          createdAt: new Date(),
        },
        {
          id: 'exp-2',
          tenantId,
          amount: 1000,
          status: 'PAID',
          createdAt: new Date(),
        },
      ] as ExpenseClaim[];

      accountRepo.find = jest.fn().mockResolvedValue(mockAccounts);
      recurringRepo.find = jest.fn().mockResolvedValue(mockRecurring);
      expenseRepo.find = jest.fn().mockResolvedValue(mockExpenses);

      const overview = await service.getOverview(tenantId);

      expect(overview.totalCash).toBe(60000);
      expect(overview.currency).toBe('USD');
      expect(overview.accounts).toHaveLength(2);
      expect(overview.monthlyOutflow).toBe(6000); // 2000 + 500 + 2500 + 1000 = 6000
      expect(overview.monthlyBurnRate).toBe(6000);
      expect(overview.runwayMonths).toBe(10); // 60000 / 6000 = 10
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
      } as CreateFinanceAccountDto);

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

    it('posts nothing when an account opens at zero', async () => {
      await service.createAccount(tenantId, {
        name: 'Empty Account',
        accountType: 'BANK',
        currency: 'USD',
        balance: 0,
      } as CreateFinanceAccountDto);

      expect(journalRepo.save).not.toHaveBeenCalled();
    });

    it('transfers funds between accounts and records double-entry journal entry', async () => {
      const fromAcc = {
        id: 'acc-1',
        tenantId,
        name: 'Bank A',
        balance: 5000,
        currency: 'USD',
      } as FinanceAccount;
      const toAcc = {
        id: 'acc-2',
        tenantId,
        name: 'Bank B',
        balance: 1000,
        currency: 'USD',
      } as FinanceAccount;

      accountRepo.findOne = jest
        .fn()
        .mockResolvedValueOnce(fromAcc)
        .mockResolvedValueOnce(toAcc);

      const transferDto: TransferFundsDto = {
        fromAccountId: 'acc-1',
        toAccountId: 'acc-2',
        amount: 2000,
        description: 'Fund replenishment',
      };

      const res = await service.transferFunds(tenantId, transferDto);

      expect(fromAcc.balance).toBe(3000);
      expect(toAcc.balance).toBe(3000);
      expect(accountRepo.save).toHaveBeenCalledWith(fromAcc);
      expect(accountRepo.save).toHaveBeenCalledWith(toAcc);
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
      expect(res.fromAccount.balance).toBe(3000);
      expect(res.toAccount.balance).toBe(3000);
      expect(res.journalEntry).toBeDefined();
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

    it('throws BadRequestException when insufficient balance', async () => {
      const fromAcc = {
        id: 'acc-1',
        tenantId,
        name: 'Bank A',
        balance: 100,
        currency: 'USD',
      } as FinanceAccount;
      const toAcc = {
        id: 'acc-2',
        tenantId,
        name: 'Bank B',
        balance: 1000,
        currency: 'USD',
      } as FinanceAccount;

      accountRepo.findOne = jest
        .fn()
        .mockResolvedValueOnce(fromAcc)
        .mockResolvedValueOnce(toAcc);

      const transferDto: TransferFundsDto = {
        fromAccountId: 'acc-1',
        toAccountId: 'acc-2',
        amount: 500,
      };

      await expect(
        service.transferFunds(tenantId, transferDto),
      ).rejects.toBeInstanceOf(BadRequestException);
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

    it('creates and lists recurring SaaS subscriptions', async () => {
      const subDto: CreateRecurringExpenseDto = {
        vendorName: 'Figma',
        category: 'Design Tools',
        amount: 45,
        billingInterval: 'MONTHLY',
        nextBillingDate: '2026-09-01',
        status: 'ACTIVE',
      };

      const created = await service.createSubscription(tenantId, subDto);
      expect(recurringRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId, vendorName: 'Figma', amount: 45 }),
      );
      expect(created.id).toBe('rec-1');

      recurringRepo.find = jest.fn().mockResolvedValue([created]);
      const list = await service.findAllSubscriptions(tenantId);
      expect(list).toHaveLength(1);
    });
  });
});
