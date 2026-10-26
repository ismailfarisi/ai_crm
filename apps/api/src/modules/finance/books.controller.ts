import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createLedgerAccountSchema,
  importStatementSchema,
  journalListQuerySchema,
  manualJournalSchema,
  matchStatementLineSchema,
  periodLockSchema,
  PERMISSIONS,
  postStatementLineSchema,
  reverseJournalSchema,
  updateLedgerAccountSchema,
  type CreateLedgerAccountSchemaPayload,
  type ImportStatementSchemaPayload,
  type JournalListQuery,
  type ManualJournalPayload,
  type PeriodLockPayload,
  type PostStatementLineSchemaPayload,
  type ReverseJournalSchemaPayload,
  type UpdateLedgerAccountSchemaPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/modules/rbac/guards/permissions.guard';
import { BooksService } from './books.service';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('finance-books')
@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BooksController {
  constructor(
    private readonly books: BooksService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  /* ---------------- period lock ---------------- */

  @Get('period-lock')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({ summary: 'The date the books are locked through' })
  periodLock(@CurrentUser() user: AuthenticatedUser) {
    return this.books.periodLock(user.organizationId);
  }

  @Put('period-lock')
  @RequirePermissions(PERMISSIONS.BOOKS_LOCK)
  @ApiOperation({
    summary: 'Lock the books through a date, or reopen them',
    description:
      'Nothing dated on or before the lock date can post, from any source. Null reopens.',
  })
  setPeriodLock(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(periodLockSchema)) body: PeriodLockPayload,
  ) {
    return this.books.setPeriodLock(
      user.organizationId,
      user.id,
      body.lockedThrough,
    );
  }

  /* ---------------- journal ---------------- */

  @Get('journal-entries')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'List journal entries',
    description: 'Newest first, filtered by date, source or account',
  })
  listJournals(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(journalListQuerySchema)) query: JournalListQuery,
  ) {
    return this.books.listJournals(user.organizationId, query);
  }

  @Get('journal-entries/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  getJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.books.getJournal(user.organizationId, id);
  }

  @Post('journal-entries')
  @RequirePermissions(PERMISSIONS.JOURNAL_POST)
  @ApiOperation({ summary: 'Post a manual journal' })
  postJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(manualJournalSchema)) body: ManualJournalPayload,
  ) {
    return this.books.postManual(user.organizationId, user.id, body);
  }

  @Post('journal-entries/:id/reverse')
  @RequirePermissions(PERMISSIONS.JOURNAL_POST)
  @ApiOperation({ summary: 'Reverse a manual journal' })
  reverseJournal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(reverseJournalSchema)) body: ReverseJournalSchemaPayload,
  ) {
    return this.books.reverse(user.organizationId, user.id, id, body);
  }

  /* ---------------- chart of accounts ---------------- */

  @Post('ledger-accounts')
  @RequirePermissions(PERMISSIONS.LEDGER_MANAGE)
  @ApiOperation({ summary: 'Add an account to the chart' })
  createAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createLedgerAccountSchema))
    body: CreateLedgerAccountSchemaPayload,
  ) {
    return this.books.createAccount(user.organizationId, body);
  }

  @Patch('ledger-accounts/:id')
  @RequirePermissions(PERMISSIONS.LEDGER_MANAGE)
  @ApiOperation({ summary: 'Rename, re-parent or retire an account' })
  updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateLedgerAccountSchema))
    body: UpdateLedgerAccountSchemaPayload,
  ) {
    return this.books.updateAccount(user.organizationId, id, body);
  }

  @Delete('ledger-accounts/:id')
  @RequirePermissions(PERMISSIONS.LEDGER_MANAGE)
  @ApiOperation({ summary: 'Delete an account nothing has used' })
  deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.books.deleteAccount(user.organizationId, id);
  }

  /* ---------------- bank reconciliation ---------------- */

  @Get('accounts/:id/reconciliation')
  @RequirePermissions(PERMISSIONS.FINANCE_READ)
  @ApiOperation({
    summary: 'Statement lines and unreconciled ledger movements for a bank account',
  })
  getReconciliation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reconciliation.reconciliation(user.organizationId, id);
  }

  @Post('bank-statements')
  @RequirePermissions(PERMISSIONS.BANK_RECONCILE)
  @ApiOperation({
    summary: 'Import statement lines',
    description: 'Lines already imported are skipped, so overlapping statements are safe.',
  })
  importStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(importStatementSchema)) body: ImportStatementSchemaPayload,
  ) {
    return this.reconciliation.import(user.organizationId, body);
  }

  @Post('bank-statement-lines/:id/match')
  @RequirePermissions(PERMISSIONS.BANK_RECONCILE)
  matchLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(matchStatementLineSchema)) body: { journalEntryId: string },
  ) {
    return this.reconciliation.match(
      user.organizationId,
      user.id,
      id,
      body.journalEntryId,
    );
  }

  @Post('bank-statement-lines/:id/unmatch')
  @RequirePermissions(PERMISSIONS.BANK_RECONCILE)
  unmatchLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reconciliation.setStatus(user.organizationId, id, 'UNMATCHED');
  }

  @Post('bank-statement-lines/:id/exclude')
  @RequirePermissions(PERMISSIONS.BANK_RECONCILE)
  @ApiOperation({ summary: 'Leave a line out of the reconciliation (a duplicate, a balance row)' })
  excludeLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reconciliation.setStatus(user.organizationId, id, 'EXCLUDED');
  }

  @Post('bank-statement-lines/:id/post')
  @RequirePermissions(PERMISSIONS.BANK_RECONCILE, PERMISSIONS.JOURNAL_POST)
  @ApiOperation({ summary: 'Book a line the ledger has no entry for, and match it' })
  postLine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(postStatementLineSchema)) body: PostStatementLineSchemaPayload,
  ) {
    return this.reconciliation.postAndMatch(user.organizationId, user.id, id, body);
  }
}
