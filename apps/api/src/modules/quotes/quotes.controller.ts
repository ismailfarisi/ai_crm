import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { QuotesService } from './quotes.service';
import { Quote, QuoteCreatedBy } from './entities/quote.entity';
import { Invoice } from './entities/invoice.entity';

export class CreateQuoteDto {
  createdBy?: QuoteCreatedBy;
  title?: string;
  prompt?: string;
  items?: any[];
  totalAmount?: number;
}

export class SignalQuoteDto {
  action: 'APPROVE' | 'REJECT' | 'OVERRIDE';
  payload?: any;
}

@ApiTags('quotes')
@Controller()
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post('quotes')
  @RequirePermissions(PERMISSIONS.QUOTE_CREATE)
  @ApiOperation({ summary: 'Create quote', description: 'Creates quote using authenticated user tenant ID' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuoteDto,
  ): Promise<Quote> {
    return this.quotesService.createQuote(
      user.organizationId,
      dto.createdBy,
      dto.title,
      dto.prompt,
      dto.items,
      dto.totalAmount,
    );
  }

  @Get('quotes')
  @RequirePermissions(PERMISSIONS.QUOTE_READ)
  @ApiOperation({ summary: 'List quotes', description: 'List quotes for tenant' })
  async findAllQuotes(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Quote[]> {
    return this.quotesService.findAllQuotes(user.organizationId);
  }

  @Get('quotes/:id')
  @RequirePermissions(PERMISSIONS.QUOTE_READ)
  @ApiOperation({ summary: 'Get quote', description: 'Get single quote by ID' })
  async findQuoteById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Quote> {
    return this.quotesService.findQuoteById(user.organizationId, id);
  }

  @Post('quotes/:id/signal')
  @RequirePermissions(PERMISSIONS.QUOTE_APPROVE)
  @ApiOperation({ summary: 'Send signal', description: 'Send signal to quote workflow' })
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
  @ApiOperation({ summary: 'List invoices', description: 'List invoices for tenant' })
  async findAllInvoices(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Invoice[]> {
    return this.quotesService.findAllInvoices(user.organizationId);
  }
}
