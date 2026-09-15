import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  type BillingStage,
  CreateQuotePayload,
  MarkInvoicePaidPayload,
  PERMISSIONS,
  QuoteCreatedBy as SharedQuoteCreatedBy,
  QuoteLineItem,
  QuoteStatus as SharedQuoteStatus,
  RecordInvoicePaymentPayload,
  UpdateQuotePayload,
  VoidInvoicePayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { QuotesService } from './quotes.service';
import { QuoteAcceptanceService } from './quote-acceptance.service';
import { InvoicesService } from './invoices.service';
import { Quote } from './entities/quote.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoicePayment } from './entities/invoice-payment.entity';

export class CreateQuoteDto implements CreateQuotePayload {
  title: string;
  quoteNumber?: string;
  customerId?: string | null;
  customerName?: string;
  customerEmail?: string | null;
  validUntil?: string | null;
  paymentTerms?: string;
  currency?: string;
  items: QuoteLineItem[];
  subtotalAmount?: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  termsAndConditions?: string | null;
  notes?: string | null;
  prompt?: string | null;
  createdBy?: SharedQuoteCreatedBy;
  billingSchedule?: BillingStage[] | null;
}

export class UpdateQuoteDto implements UpdateQuotePayload {
  title?: string;
  quoteNumber?: string;
  customerId?: string | null;
  customerName?: string;
  customerEmail?: string | null;
  validUntil?: string | null;
  paymentTerms?: string;
  currency?: string;
  items?: QuoteLineItem[];
  subtotalAmount?: number;
  discountAmount?: number;
  taxAmount?: number;
  totalAmount?: number;
  termsAndConditions?: string | null;
  notes?: string | null;
  prompt?: string | null;
  createdBy?: SharedQuoteCreatedBy;
  status?: SharedQuoteStatus;
  billingSchedule?: BillingStage[] | null;
}

export class SignalQuoteDto {
  action: 'APPROVE' | 'REJECT' | 'OVERRIDE';
  payload?: any;
}

export class MarkInvoicePaidDto implements MarkInvoicePaidPayload {
  accountId: string;
  paidAmount?: number;
  paidAt?: string;
  notes?: string;
}

export class RecordInvoicePaymentDto implements RecordInvoicePaymentPayload {
  accountId: string;
  amount?: number;
  paidAt?: string;
  notes?: string;
}

export class VoidInvoiceDto implements VoidInvoicePayload {
  reason?: string;
}

@ApiTags('quotes')
@Controller()
export class QuotesController {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly invoicesService: InvoicesService,
    private readonly acceptance: QuoteAcceptanceService,
  ) {}

  @Get('quotes/next-number')
  @RequirePermissions(PERMISSIONS.QUOTE_READ)
  @ApiOperation({
    summary: 'Preview next quote number',
    description:
      'Previews the next sequential quote number for tenant without allocating it',
  })
  async getNextQuoteNumber(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ nextNumber: string }> {
    const nextNumber = await this.quotesService.peekNextQuoteNumber(
      user.organizationId,
    );
    return { nextNumber };
  }

  @Post('quotes')
  @RequirePermissions(PERMISSIONS.QUOTE_CREATE)
  @ApiOperation({
    summary: 'Create quote',
    description: 'Creates quote using authenticated user tenant ID',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuoteDto,
  ): Promise<Quote> {
    return this.quotesService.createQuote(user.organizationId, dto);
  }

  @Get('quotes')
  @RequirePermissions(PERMISSIONS.QUOTE_READ)
  @ApiOperation({
    summary: 'List quotes',
    description: 'List quotes for tenant',
  })
  async findAllQuotes(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Quote[]> {
    return this.quotesService.findAllQuotes(user.organizationId);
  }

  @Get('quotes/:id')
  @RequirePermissions(PERMISSIONS.QUOTE_READ)
  @ApiOperation({
    summary: 'Get quote',
    description: 'Get single quote by ID',
  })
  async findQuoteById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Quote> {
    return this.quotesService.findQuoteById(user.organizationId, id);
  }

  @Patch('quotes/:id')
  @RequirePermissions(PERMISSIONS.QUOTE_UPDATE)
  @ApiOperation({
    summary: 'Update quote',
    description: 'Updates quote fields and recalculates totals',
  })
  async updateQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteDto,
  ): Promise<Quote> {
    return this.quotesService.updateQuote(user.organizationId, id, dto);
  }

  @Post('quotes/:id/signal')
  @RequirePermissions(PERMISSIONS.QUOTE_APPROVE)
  @ApiOperation({
    summary: 'Send signal',
    description: 'Send signal to quote workflow',
  })
  async sendSignal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignalQuoteDto,
  ): Promise<Quote> {
    return this.quotesService.sendSignal(
      user.organizationId,
      id,
      dto.action,
      dto.payload,
      user.id,
    );
  }

  @Post('quotes/:id/acceptance-link')
  @RequirePermissions(PERMISSIONS.QUOTE_UPDATE)
  @ApiOperation({
    summary: 'Create a customer acceptance link',
    description:
      'Issues a single link the customer can open without an account to review and accept the quote. Any earlier link stops working.',
  })
  async createAcceptanceLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.acceptance.createLink(user.organizationId, id);
  }

  @Post('quotes/:id/revise')
  @RequirePermissions(PERMISSIONS.QUOTE_CREATE)
  @ApiOperation({
    summary: 'Revise a quote',
    description:
      'Creates the next version as a draft and marks this one superseded. Refused once the quote has a sales order.',
  })
  async reviseQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Quote> {
    return this.quotesService.reviseQuote(user.organizationId, id);
  }

  @Get('quotes/:id/guardrails')
  @RequirePermissions(PERMISSIONS.QUOTE_READ)
  @ApiOperation({
    summary: 'Preview the commercial checks on a quote',
    description:
      'Re-costs the quote from the catalog and returns anything that would block approval, so the editor can warn before the button is pressed',
  })
  async evaluateQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.quotesService.evaluateQuote(user.organizationId, id);
  }

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.INVOICE_READ)
  @ApiOperation({
    summary: 'List invoices',
    description: 'List invoices for tenant',
  })
  async findAllInvoices(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Invoice[]> {
    return this.quotesService.findAllInvoices(user.organizationId);
  }

  @Get('invoices/:id')
  @RequirePermissions(PERMISSIONS.INVOICE_READ)
  @ApiOperation({
    summary: 'Get invoice',
    description: 'Get single invoice by ID',
  })
  async findInvoiceById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Invoice> {
    return this.invoicesService.findById(user.organizationId, id);
  }

  @Patch('invoices/:id/mark-paid')
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  @ApiOperation({
    summary: 'Mark invoice paid (deprecated)',
    deprecated: true,
    description: 'Deprecated — use POST /invoices/:id/payments',
  })
  async markInvoicePaid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkInvoicePaidDto,
  ): Promise<Invoice> {
    return this.invoicesService.markPaid(user.organizationId, id, dto, user.id);
  }

  @Post('invoices/:id/payments')
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  @ApiOperation({
    summary: 'Record invoice payment',
    description: 'Records a full or partial payment against a finance account',
  })
  async recordInvoicePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordInvoicePaymentDto,
  ): Promise<Invoice> {
    return this.invoicesService.recordPayment(
      user.organizationId,
      id,
      dto,
      user.id,
    );
  }

  @Get('invoices/:id/payments')
  @RequirePermissions(PERMISSIONS.INVOICE_READ)
  @ApiOperation({
    summary: 'List invoice payments',
    description: 'Lists the payment history recorded against an invoice',
  })
  async findInvoicePayments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvoicePayment[]> {
    return this.invoicesService.findPayments(user.organizationId, id);
  }

  @Post('invoices/:id/void')
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  @ApiOperation({
    summary: 'Void invoice',
    description:
      'Cancels an invoice, automatically reversing any recorded payments',
  })
  async voidInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidInvoiceDto,
  ): Promise<Invoice> {
    return this.invoicesService.voidInvoice(
      user.organizationId,
      id,
      dto,
      user.id,
    );
  }

  @Post('invoices/:id/send')
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  @ApiOperation({
    summary: 'Send invoice',
    description: 'Emails the invoice PDF to the customer',
  })
  async sendInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Invoice> {
    return this.invoicesService.sendToCustomer(user.organizationId, id);
  }

  @Get('invoices/:id/pdf')
  @RequirePermissions(PERMISSIONS.INVOICE_READ)
  @ApiOperation({
    summary: 'Download invoice PDF',
    description: 'Returns the invoice as a PDF file',
  })
  async downloadInvoicePdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.invoicesService.getPdf(
      user.organizationId,
      id,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return new StreamableFile(buffer);
  }
}
