import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createCreditNoteSchema,
  PERMISSIONS,
  refundCreditNoteSchema,
  type CreateCreditNotePayload,
  type RefundCreditNotePayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { CreditNotesService } from './credit-notes.service';

@ApiTags('credit-notes')
@Controller()
export class CreditNotesController {
  constructor(private readonly credits: CreditNotesService) {}

  @Get('credit-notes')
  @RequirePermissions(PERMISSIONS.CREDIT_NOTE_READ)
  @ApiOperation({ summary: 'List credit notes, optionally for one invoice' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('invoiceId') invoiceId?: string,
  ) {
    return this.credits.list(
      user.organizationId,
      invoiceId && /^[0-9a-f-]{36}$/i.test(invoiceId) ? invoiceId : undefined,
    );
  }

  @Get('credit-notes/:id')
  @RequirePermissions(PERMISSIONS.CREDIT_NOTE_READ)
  @ApiOperation({ summary: 'Get a credit note' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.credits.get(user.organizationId, id);
  }

  @Get('credit-notes/:id/refunds')
  @RequirePermissions(PERMISSIONS.CREDIT_NOTE_READ)
  @ApiOperation({ summary: 'Refunds paid against a credit note' })
  refunds(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.credits.listRefunds(user.organizationId, id);
  }

  @Post('invoices/:id/credit-notes')
  @RequirePermissions(PERMISSIONS.CREDIT_NOTE_CREATE)
  @ApiOperation({
    summary: 'Draft a credit note against an invoice',
    description:
      'Itemised lines, a net amount spread across the invoice tax codes, or the full remaining amount.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createCreditNoteSchema)) body: CreateCreditNotePayload,
  ) {
    return this.credits.create(user.organizationId, user.id, id, body);
  }

  @Post('credit-notes/:id/issue')
  @RequirePermissions(PERMISSIONS.CREDIT_NOTE_APPROVE)
  @ApiOperation({
    summary: 'Issue a credit note: reduces what is owed and posts it',
  })
  issue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.credits.issue(user.organizationId, id, user.id);
  }

  @Post('credit-notes/:id/cancel')
  @RequirePermissions(PERMISSIONS.CREDIT_NOTE_CREATE)
  @ApiOperation({ summary: 'Discard a draft credit note' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.credits.cancel(user.organizationId, id);
  }

  @Post('credit-notes/:id/refunds')
  @RequirePermissions(PERMISSIONS.CREDIT_NOTE_REFUND)
  @ApiOperation({
    summary: 'Refund money the customer is owed against this credit note',
  })
  refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(refundCreditNoteSchema)) body: RefundCreditNotePayload,
  ) {
    return this.credits.refund(user.organizationId, id, user.id, body);
  }
}
