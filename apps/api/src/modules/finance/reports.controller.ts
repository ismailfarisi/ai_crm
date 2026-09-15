import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  baseCurrencySchema,
  fxRateSchema,
  PERMISSIONS,
  revaluationSchema,
  statementQuerySchema,
  type BaseCurrencyPayload,
  type FxRatePayload,
  type RevaluationPayload,
  type StatementQueryPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { CurrencyService } from './currency.service';
import { LedgerService } from './ledger.service';
import { ReportsService, toCsv } from './reports.service';

const startOfYear = () => new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
const endOfToday = () => {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
};
/** A date-only `to` means the whole of that day. */
const inclusive = (d: Date | undefined) => {
  if (!d) return endOfToday();
  const copy = new Date(d);
  if (copy.getUTCHours() === 0 && copy.getUTCMinutes() === 0)
    copy.setUTCHours(23, 59, 59, 999);
  return copy;
};

@ApiTags('finance-reports')
@Controller('finance')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly currency: CurrencyService,
    private readonly ledger: LedgerService,
  ) {}

  /* ---------------- currencies ---------------- */

  @Get('currencies')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'Base currency, currencies in use and their latest rates',
  })
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.currency.settings(user.organizationId);
  }

  @Put('currencies/base')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @ApiOperation({
    summary: 'Set the base currency. Only before anything has been posted.',
  })
  setBase(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(baseCurrencySchema)) body: BaseCurrencyPayload,
  ) {
    return this.currency.setBaseCurrency(
      user.organizationId,
      body.baseCurrency,
    );
  }

  @Get('fx-rates')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({ summary: 'Exchange rates, newest first' })
  rates(
    @CurrentUser() user: AuthenticatedUser,
    @Query('currency') currency?: string,
  ) {
    return this.currency.listRates(
      user.organizationId,
      currency && /^[A-Za-z]{3}$/.test(currency) ? currency : undefined,
    );
  }

  @Post('fx-rates')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @ApiOperation({
    summary:
      "Add or correct a day's rate: base currency per unit of the currency",
  })
  upsertRate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(fxRateSchema)) body: FxRatePayload,
  ) {
    return this.currency.upsertRate(user.organizationId, body);
  }

  @Delete('fx-rates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  async deleteRate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.currency.deleteRate(user.organizationId, id);
  }

  @Post('fx/revaluation')
  @RequirePermissions(PERMISSIONS.FINANCE_MANAGE)
  @ApiOperation({
    summary:
      'Revalue open foreign receivables and payables at month end, reversing next month',
  })
  revalue(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(revaluationSchema)) body: RevaluationPayload,
  ) {
    return this.currency.revalue(user.organizationId, body.period);
  }

  /* ---------------- statements ---------------- */

  @Get('reports/trial-balance')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({ summary: 'Trial balance at a date, in base currency' })
  async trialBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(statementQuerySchema)) q: StatementQueryPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.ledger.trialBalance(
      user.organizationId,
      inclusive(q.asOf),
    );
    if (q.format !== 'csv') return report;
    return this.csv(
      user,
      res,
      'trial-balance',
      ['Code', 'Account', 'Type', 'Debit', 'Credit', 'Balance'],
      report.rows.map((r) => [
        r.code,
        r.name,
        r.type,
        r.debit,
        r.credit,
        r.balance,
      ]),
    );
  }

  @Get('reports/profit-and-loss')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({ summary: 'Profit and loss for a period, in base currency' })
  async profitAndLoss(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(statementQuerySchema)) q: StatementQueryPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.profitAndLoss(
      user.organizationId,
      q.from ?? startOfYear(),
      inclusive(q.to),
    );
    if (q.format !== 'csv') return report;
    return this.csv(
      user,
      res,
      'profit-and-loss',
      ['Section', 'Code', 'Account', 'Amount'],
      [
        ...report.income.map((l) => ['Income', l.code, l.name, l.amount]),
        ['Income', '', 'Total income', report.totalIncome],
        ...report.expenses.map((l) => ['Expenses', l.code, l.name, l.amount]),
        ['Expenses', '', 'Total expenses', report.totalExpenses],
        ['', '', 'Net profit', report.netProfit],
      ],
    );
  }

  @Get('reports/balance-sheet')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({ summary: 'Balance sheet at a date, in base currency' })
  async balanceSheet(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(statementQuerySchema)) q: StatementQueryPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.balanceSheet(
      user.organizationId,
      inclusive(q.asOf),
    );
    if (q.format !== 'csv') return report;
    return this.csv(
      user,
      res,
      'balance-sheet',
      ['Section', 'Code', 'Account', 'Amount'],
      [
        ...report.assets.map((l) => ['Assets', l.code, l.name, l.amount]),
        ['Assets', '', 'Total assets', report.totalAssets],
        ...report.liabilities.map((l) => [
          'Liabilities',
          l.code,
          l.name,
          l.amount,
        ]),
        ...report.equity.map((l) => ['Equity', l.code, l.name, l.amount]),
        ['Equity', '', 'Current earnings', report.currentEarnings],
        [
          '',
          '',
          'Total liabilities and equity',
          report.totalLiabilitiesAndEquity,
        ],
      ],
    );
  }

  @Get('reports/receivables-aging')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary:
      'What customers owe, by how overdue, reconciled to the receivables account',
  })
  async receivablesAging(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(statementQuerySchema)) q: StatementQueryPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.receivablesAging(
      user.organizationId,
      inclusive(q.asOf),
    );
    if (q.format !== 'csv') return report;
    return this.csv(
      user,
      res,
      'receivables-aging',
      [
        'Invoice',
        'Customer',
        'Currency',
        'Outstanding',
        `Outstanding (${report.baseCurrency})`,
        'Due',
        'Days overdue',
        'Bucket',
      ],
      report.rows.map((r) => [
        r.invoiceNumber,
        r.customerName,
        r.currency,
        r.outstanding,
        r.outstandingBase,
        r.dueDate?.slice(0, 10),
        r.daysOverdue,
        r.bucket,
      ]),
    );
  }

  @Get('reports/margins')
  @RequirePermissions(PERMISSIONS.FINANCE_READ, PERMISSIONS.QUOTE_VIEW_COST)
  @ApiOperation({
    summary: 'Margin on sales orders by customer or product template',
  })
  async margins(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(statementQuerySchema)) q: StatementQueryPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.margins(
      user.organizationId,
      q.from ?? startOfYear(),
      inclusive(q.to),
      q.by,
    );
    if (q.format !== 'csv') return report;
    return this.csv(
      user,
      res,
      `margin-by-${q.by}`,
      [
        q.by === 'customer' ? 'Customer' : 'Template',
        'Orders',
        'Revenue',
        'Cost',
        'Margin',
        'Margin %',
        'Measured cost share',
      ],
      report.rows.map((r) => [
        r.label,
        r.orders,
        r.revenue,
        r.cost,
        r.margin,
        r.marginPct,
        r.measuredCostShare,
      ]),
    );
  }

  /** CSV is a download of the same figures, behind its own permission, as `contact:export` is. */
  private csv(
    user: AuthenticatedUser,
    res: Response,
    name: string,
    header: string[],
    rows: (string | number | null | undefined)[][],
  ): string {
    if (!user.permissions.includes(PERMISSIONS.FINANCE_EXPORT)) {
      throw new ForbiddenException(
        'You do not have permission to export financial reports.',
      );
    }
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
    return toCsv(header, rows);
  }
}
