import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { CheckoutRedirectDto, PublicInvoiceDto } from '@saas/shared';
import { Public } from '@/common/decorators';
import { OnlinePaymentsService } from './online-payments.service';

/**
 * Reachable without signing in: a customer's pay link, the deposit button on
 * an accepted quote, and provider webhooks. Throttled on the `auth` bucket,
 * as the quote link is.
 */
@ApiTags('public')
@Controller('public/payments')
export class PublicPaymentsController {
  constructor(private readonly payments: OnlinePaymentsService) {}

  @Public()
  @Get('invoices/:token')
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'View an invoice from its pay link' })
  viewInvoice(@Param('token') token: string): Promise<PublicInvoiceDto> {
    return this.payments.viewInvoice(token);
  }

  @Public()
  @Post('invoices/:token/checkout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start a hosted checkout for the balance due' })
  payInvoice(@Param('token') token: string): Promise<CheckoutRedirectDto> {
    return this.payments.startInvoiceCheckout(token);
  }

  @Public()
  @Post('quotes/:token/deposit-checkout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Start a hosted checkout for the deposit on an accepted quote',
  })
  payDeposit(@Param('token') token: string): Promise<CheckoutRedirectDto> {
    return this.payments.startDepositCheckout(token);
  }

  @Public()
  @Post('webhooks/stripe/:webhookKey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Stripe events for one tenant's account. Verified by signature.",
  })
  stripeWebhook(
    @Param('webhookKey') webhookKey: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return this.payments.handleStripeWebhook(
      webhookKey,
      req.rawBody ?? Buffer.from(''),
      req.headers,
    );
  }

  @Public()
  @Post('fake/:session/complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Development and staging: pay or cancel a test checkout',
  })
  completeFake(
    @Param('session') session: string,
    @Body() body: { outcome?: string },
  ) {
    return this.payments.completeFake(
      session,
      body?.outcome === 'PAID' ? 'PAID' : 'EXPIRED',
    );
  }
}
