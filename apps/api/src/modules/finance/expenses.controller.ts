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
import { PERMISSIONS } from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { ExpensesService } from './expenses.service';
import {
  CreateExpenseClaimDto,
  UpdateExpenseClaimDto,
  SignalExpenseDto,
  ScanReceiptDto,
  ScannedReceiptResult,
} from './dto';
import { ExpenseClaim } from './entities/expense-claim.entity';

@ApiTags('finance/expenses')
@Controller('finance/expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'List expense claims',
    description: 'Lists all employee expense claims for tenant',
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExpenseClaim[]> {
    return this.expensesService.findAll(user.organizationId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EXPENSE_SUBMIT)
  @ApiOperation({
    summary: 'Submit expense claim',
    description: 'Submits a new expense claim and starts Temporal approval workflow',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExpenseClaimDto,
  ): Promise<ExpenseClaim> {
    return this.expensesService.create(user.organizationId, dto, user);
  }

  @Post('scan-receipt')
  @RequirePermissions(PERMISSIONS.EXPENSE_SUBMIT)
  @ApiOperation({
    summary: 'Scan receipt with AI OCR',
    description: 'Extracts merchant, amount, date, category, and items from receipt image or text',
  })
  async scanReceipt(
    @Body() dto: ScanReceiptDto,
  ): Promise<ScannedReceiptResult> {
    return this.expensesService.scanReceipt(dto);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'Get expense claim',
    description: 'Gets a single expense claim by ID',
  })
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ExpenseClaim> {
    return this.expensesService.findById(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EXPENSE_SUBMIT)
  @ApiOperation({
    summary: 'Update expense claim',
    description: 'Updates expense claim attributes',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseClaimDto,
  ): Promise<ExpenseClaim> {
    return this.expensesService.update(user.organizationId, id, dto);
  }

  @Post(':id/signal')
  @RequirePermissions(PERMISSIONS.EXPENSE_APPROVE)
  @ApiOperation({
    summary: 'Signal expense claim',
    description: 'Approve, reject, or reimburse an expense claim via Temporal workflow',
  })
  async signal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignalExpenseDto,
  ): Promise<ExpenseClaim> {
    return this.expensesService.sendSignal(user.organizationId, id, dto);
  }
}
