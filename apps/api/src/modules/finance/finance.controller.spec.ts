import { Test, TestingModule } from '@nestjs/testing';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';

describe('FinanceController', () => {
  let controller: FinanceController;
  let financeService: jest.Mocked<Partial<FinanceService>>;

  const mockUser: AuthenticatedUser = {
    id: 'user-123',
    organizationId: 'tenant-123',
    email: 'finance@example.com',
    roleId: 'role-admin',
    permissions: [
      'finance:read',
      'finance:manage',
    ],
  };

  beforeEach(async () => {
    financeService = {
      getOverview: jest.fn().mockResolvedValue({
        totalCash: 50000,
        currency: 'USD',
        monthlyInflow: 10000,
        monthlyOutflow: 4000,
        netCashflow: 6000,
        monthlyBurnRate: 0,
        runwayMonths: Infinity,
        accounts: [],
        recentCashflowSeries: [],
      }),
      findAllAccounts: jest.fn().mockResolvedValue([]),
      createAccount: jest.fn().mockResolvedValue({ id: 'acc-1' } as any),
      transferFunds: jest.fn().mockResolvedValue({
        fromAccount: {} as any,
        toAccount: {} as any,
        journalEntry: {} as any,
      }),
      findAllBudgets: jest.fn().mockResolvedValue([]),
      createBudget: jest.fn().mockResolvedValue({ id: 'bud-1' } as any),
      findAllSubscriptions: jest.fn().mockResolvedValue([]),
      createSubscription: jest.fn().mockResolvedValue({ id: 'sub-1' } as any),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FinanceController],
      providers: [
        {
          provide: FinanceService,
          useValue: financeService,
        },
      ],
    }).compile();

    controller = module.get<FinanceController>(FinanceController);
  });

  it('should get treasury overview', async () => {
    const result = await controller.getOverview(mockUser);
    expect(financeService.getOverview).toHaveBeenCalledWith('tenant-123');
    expect(result.totalCash).toBe(50000);
  });

  it('should list all accounts', async () => {
    const result = await controller.findAllAccounts(mockUser);
    expect(financeService.findAllAccounts).toHaveBeenCalledWith('tenant-123');
    expect(result).toEqual([]);
  });

  it('should create an account', async () => {
    const dto = { name: 'Savings Account', accountType: 'BANK' as const };
    const result = await controller.createAccount(mockUser, dto);
    expect(financeService.createAccount).toHaveBeenCalledWith('tenant-123', dto);
    expect(result).toEqual({ id: 'acc-1' });
  });

  it('should transfer funds', async () => {
    const dto = { fromAccountId: 'acc-1', toAccountId: 'acc-2', amount: 500 };
    await controller.transferFunds(mockUser, dto);
    expect(financeService.transferFunds).toHaveBeenCalledWith('tenant-123', dto);
  });

  it('should list and create budgets', async () => {
    await controller.findAllBudgets(mockUser);
    expect(financeService.findAllBudgets).toHaveBeenCalledWith('tenant-123');

    const budgetDto = {
      category: 'Sales',
      period: 'MONTHLY' as const,
      budgetAmount: 5000,
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    };
    await controller.createBudget(mockUser, budgetDto);
    expect(financeService.createBudget).toHaveBeenCalledWith('tenant-123', budgetDto);
  });

  it('should list and create subscriptions', async () => {
    await controller.findAllSubscriptions(mockUser);
    expect(financeService.findAllSubscriptions).toHaveBeenCalledWith('tenant-123');

    const subDto = {
      vendorName: 'Slack',
      category: 'Communication',
      amount: 15,
      billingInterval: 'MONTHLY' as const,
      nextBillingDate: '2026-09-01',
    };
    await controller.createSubscription(mockUser, subDto);
    expect(financeService.createSubscription).toHaveBeenCalledWith('tenant-123', subDto);
  });
});
