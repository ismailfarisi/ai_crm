import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  TreasuryOverviewDto,
  type TrialBalanceDto,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { FinanceService } from './finance.service';
import { LedgerService } from './ledger.service';
import { LedgerAccount } from './entities/ledger-account.entity';
import {
  CreateFinanceAccountDto,
  UpdateFinanceAccountDto,
  CreateCategoryBudgetDto,
  CreateRecurringExpenseDto,
  TransferFundsDto,
} from './dto';
import { FinanceAccount } from './entities/finance-account.entity';
import { CategoryBudget } from './entities/category-budget.entity';
import { RecurringExpense } from './entities/recurring-expense.entity';
import { JournalEntry } from './entities/journal-entry.entity';

@ApiTags('finance')
@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinanceController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly ledgerService: LedgerService,
  ) {}

  @Get('ledger-accounts')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'List the chart of accounts',
    description: 'Every ledger account this tenant posts to, in code order',
  })
  async listLedgerAccounts(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LedgerAccount[]> {
    return this.ledgerService.list(user.organizationId);
  }

  @Get('trial-balance')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'Trial balance',
    description:
      'Debits and credits per account. `difference` is the number that matters: anything other than zero means an unbalanced entry was written.',
  })
  async trialBalance(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TrialBalanceDto> {
    return this.ledgerService.trialBalance(user.organizationId);
  }

  @Get('overview')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'Treasury overview',
    description:
      'Returns total cash, burn rate, runway, and cashflow series for tenant',
  })
  async getOverview(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TreasuryOverviewDto> {
    return this.financeService.getOverview(user.organizationId);
  }

  @Get('accounts')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'List finance accounts',
    description: 'Lists all financial bank/cash accounts for tenant',
  })
  async findAllAccounts(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FinanceAccount[]> {
    return this.financeService.findAllAccounts(user.organizationId);
  }

  @Post('accounts')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @ApiOperation({
    summary: 'Create finance account',
    description: 'Creates a new bank, cash, or credit account for tenant',
  })
  async createAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFinanceAccountDto,
  ): Promise<FinanceAccount> {
    return this.financeService.createAccount(user.organizationId, dto);
  }

  @Patch('accounts/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @ApiOperation({
    summary: 'Update a finance account',
    description:
      'Renames an account or makes it the default one. Balances move through postings, not this route.',
  })
  async updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFinanceAccountDto,
  ): Promise<FinanceAccount> {
    return this.financeService.updateAccount(user.organizationId, id, dto);
  }

  @Post('accounts/transfer')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @ApiOperation({
    summary: 'Inter-account transfer',
    description:
      'Transfers funds between accounts with double-entry auto-journaling',
  })
  async transferFunds(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TransferFundsDto,
  ): Promise<{
    fromAccount: FinanceAccount;
    toAccount: FinanceAccount;
    journalEntry: JournalEntry;
  }> {
    return this.financeService.transferFunds(user.organizationId, dto);
  }

  @Get('budgets')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'List category budgets',
    description:
      'Lists departmental and category budgets with alert thresholds',
  })
  async findAllBudgets(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CategoryBudget[]> {
    return this.financeService.findAllBudgets(user.organizationId);
  }

  @Post('budgets')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @ApiOperation({
    summary: 'Create category budget',
    description: 'Creates a new spending budget for a category',
  })
  async createBudget(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCategoryBudgetDto,
  ): Promise<CategoryBudget> {
    return this.financeService.createBudget(user.organizationId, dto);
  }

  @Get('subscriptions')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'List SaaS subscriptions',
    description: 'Lists recurring SaaS and vendor subscriptions',
  })
  async findAllSubscriptions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RecurringExpense[]> {
    return this.financeService.findAllSubscriptions(user.organizationId);
  }

  @Post('subscriptions')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @ApiOperation({
    summary: 'Create SaaS subscription',
    description: 'Registers a new recurring vendor subscription or SaaS fee',
  })
  async createSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecurringExpenseDto,
  ): Promise<RecurringExpense> {
    return this.financeService.createSubscription(user.organizationId, dto);
  }

  @Get('journal-entries')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'List journal entries',
    description: 'Lists all double-entry journal entries for tenant',
  })
  async findAllJournalEntries(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JournalEntry[]> {
    return this.financeService.findAllJournalEntries(user.organizationId);
  }
}
