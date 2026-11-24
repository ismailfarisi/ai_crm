import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  sendOnWhatsAppSchema,
  type SendOnWhatsAppPayload,
  type WhatsAppSendResultDto,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { WhatsAppDocumentService } from './services/whatsapp-document.service';

const DESCRIPTION =
  'Sends from the connected business WhatsApp number when WhatsApp allows it (inside 24 hours of the customer writing, or with the approved template), and records it in the inbox. Otherwise returns a click-to-chat link to send it from your own WhatsApp.';

/** Each document keeps the permission its email send already needs. */
@ApiTags('channels')
@ApiBearerAuth()
@Controller()
export class WhatsAppSendController {
  constructor(private readonly documents: WhatsAppDocumentService) {}

  @Post('quotes/:id/whatsapp')
  @RequirePermissions(PERMISSIONS.QUOTE_UPDATE)
  @ApiOperation({
    summary: 'Send the quote link on WhatsApp',
    description: DESCRIPTION,
  })
  sendQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(sendOnWhatsAppSchema)) body: SendOnWhatsAppPayload,
  ): Promise<WhatsAppSendResultDto> {
    return this.documents.sendQuote(user, id, body);
  }

  @Post('quotes/:id/proofs/whatsapp')
  @RequirePermissions(PERMISSIONS.QUOTE_UPDATE)
  @ApiOperation({
    summary: 'Send the artwork proof link on WhatsApp',
    description: DESCRIPTION,
  })
  sendProof(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(sendOnWhatsAppSchema)) body: SendOnWhatsAppPayload,
  ): Promise<WhatsAppSendResultDto> {
    return this.documents.sendProof(user, id, body);
  }

  @Post('invoices/:id/whatsapp')
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  @ApiOperation({
    summary: 'Send the invoice and pay link on WhatsApp',
    description: DESCRIPTION,
  })
  sendInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(sendOnWhatsAppSchema)) body: SendOnWhatsAppPayload,
  ): Promise<WhatsAppSendResultDto> {
    return this.documents.sendInvoice(user, id, body);
  }
}
