import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  checkoutSchema,
  PERMISSIONS,
  type CheckoutPayload,
} from '@saas/shared';
import { CurrentUser, Public, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { BillingService } from './billing.service';

const fakeCompleteSchema = z.object({ session: z.string().min(1).max(200) });

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  @ApiOperation({ summary: 'Plans on offer' })
  plans() {
    return this.billing.listPlans();
  }

  /** Visible to everyone in the organization: the restriction banner depends on it. */
  @Get('subscription')
  @ApiOperation({
    summary:
      "The organization's subscription and whether writes are restricted",
  })
  subscription(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.get(user.organizationId);
  }

  @Post('checkout')
  @RequirePermissions(PERMISSIONS.ORG_MANAGE_BILLING)
  @ApiOperation({
    summary:
      'Start checkout for a plan; returns the URL to send the browser to',
  })
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(checkoutSchema)) body: CheckoutPayload,
  ) {
    return this.billing.checkout(
      user.organizationId,
      { id: user.id, email: user.email },
      body.planCode,
    );
  }

  @Post('cancel')
  @RequirePermissions(PERMISSIONS.ORG_MANAGE_BILLING)
  @ApiOperation({ summary: 'Cancel at the end of the current period' })
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.cancel(user.organizationId);
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Payment provider events. Verified by signature, not by session.',
  })
  webhook(@Req() req: RawBodyRequest<Request>) {
    return this.billing.handleWebhook(
      req.rawBody ?? Buffer.from(''),
      req.headers,
    );
  }

  @Post('fake/complete')
  @RequirePermissions(PERMISSIONS.ORG_MANAGE_BILLING)
  @ApiOperation({
    summary: 'Development and staging: complete a simulated checkout',
  })
  fakeComplete(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(fakeCompleteSchema))
    body: z.output<typeof fakeCompleteSchema>,
  ) {
    return this.billing.completeFakeCheckout(user.organizationId, body.session);
  }

  @Post('fake/fail-payment')
  @RequirePermissions(PERMISSIONS.ORG_MANAGE_BILLING)
  @ApiOperation({
    summary: 'Development and staging: simulate a failed renewal',
  })
  fakeFail(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.failFakePayment(user.organizationId);
  }
}
