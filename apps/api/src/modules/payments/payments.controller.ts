import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  updatePaymentSettingsSchema,
  type UpdatePaymentSettingsPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { OnlinePaymentsService } from './online-payments.service';
import { PaymentSettingsService } from './payment-settings.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly settings: PaymentSettingsService,
    private readonly payments: OnlinePaymentsService,
  ) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.ORG_MANAGE_PAYMENTS)
  @ApiOperation({
    summary: 'Online payment settings. Secrets are never returned.',
  })
  getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.get(user.organizationId);
  }

  @Put('settings')
  @RequirePermissions(PERMISSIONS.ORG_MANAGE_PAYMENTS)
  @ApiOperation({ summary: 'Save online payment settings' })
  updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updatePaymentSettingsSchema))
    body: UpdatePaymentSettingsPayload,
  ) {
    return this.settings.update(user.organizationId, body);
  }

  @Post('settings/clear-keys')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.ORG_MANAGE_PAYMENTS)
  @ApiOperation({ summary: 'Forget the saved provider keys' })
  clearKeys(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.clearKeys(user.organizationId);
  }

  @Get('quote-defaults')
  @RequirePermissions(PERMISSIONS.QUOTE_CREATE)
  @ApiOperation({ summary: 'The deposit a new quote starts with' })
  async quoteDefaults(@CurrentUser() user: AuthenticatedUser) {
    const dto = await this.settings.get(user.organizationId);
    return { defaultDepositPercent: dto.defaultDepositPercent };
  }

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.INVOICE_READ)
  @ApiOperation({
    summary: 'Online payment state of every invoice that has any',
  })
  invoiceStatuses(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.invoiceStatuses(user.organizationId);
  }

  @Post('invoices/:id/pay-link')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.INVOICE_MANAGE)
  @ApiOperation({
    summary: 'Issue a fresh pay link; earlier links stop working',
  })
  payLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.payments.issuePayLink(user.organizationId, id);
  }

  @Get('quotes/:id/deposit')
  @RequirePermissions(PERMISSIONS.QUOTE_READ)
  @ApiOperation({
    summary: 'The deposit invoice on an accepted quote, and whether it is paid',
  })
  async quoteDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return {
      deposit: await this.payments.quoteDeposit(user.organizationId, id),
    };
  }
}
