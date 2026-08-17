import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, TreasuryOverviewDto } from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { FinanceService } from './finance.service';
import {
  CreateFinanceAccountDto,
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
  constructor(private readonly financeService: FinanceService) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'Treasury overview',
    description: 'Returns total cash, burn rate, runway, and cashflow series for tenant',
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

  @Post('accounts/transfer')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @ApiOperation({
    summary: 'Inter-account transfer',
    description: 'Transfers funds between accounts with double-entry auto-journaling',
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
    description: 'Lists departmental and category budgets with alert thresholds',
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
}
