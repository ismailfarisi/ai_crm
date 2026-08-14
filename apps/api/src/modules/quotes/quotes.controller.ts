import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateQuotePayload,
  PERMISSIONS,
  QuoteCreatedBy as SharedQuoteCreatedBy,
  QuoteLineItem,
  QuoteStatus as SharedQuoteStatus,
  UpdateQuotePayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { QuotesService } from './quotes.service';
import { Quote } from './entities/quote.entity';
import { Invoice } from './entities/invoice.entity';

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
}

export class SignalQuoteDto {
  action: 'APPROVE' | 'REJECT' | 'OVERRIDE';
  payload?: any;
}

@ApiTags('quotes')
@Controller()
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Get('quotes/next-number')
  @RequirePermissions(PERMISSIONS.QUOTE_READ)
  @ApiOperation({
    summary: 'Generate next quote number',
    description: 'Generates next sequential quote number for tenant',
  })
  async getNextQuoteNumber(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ nextNumber: string }> {
    const nextNumber = await this.quotesService.generateNextQuoteNumber(
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
    );
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
}
