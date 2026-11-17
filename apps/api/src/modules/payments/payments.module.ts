import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { ChannelCryptoService } from '../channels/services/channel-crypto.service';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Organization } from '../organizations/entities/organization.entity';
import { Invoice } from '../quotes/entities/invoice.entity';
import { INVOICE_PAY_LINK_ISSUER } from '../quotes/invoice-pay-link-issuer';
import { QuotesModule } from '../quotes/quotes.module';
import {
  InvoicePayLink,
  PaymentCheckout,
  PaymentSettings,
  PaymentWebhookEvent,
} from './entities/payments.entity';
import { OnlinePaymentsService } from './online-payments.service';
import { PaymentSettingsService } from './payment-settings.service';
import { PaymentsController } from './payments.controller';
import { PublicPaymentsController } from './public-payments.controller';

/** Tenants' customers paying them online. Kerf's own subscription billing is `BillingModule`. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentSettings,
      PaymentCheckout,
      PaymentWebhookEvent,
      InvoicePayLink,
      Invoice,
      Organization,
      FinanceAccount,
    ]),
    QuotesModule,
    AuditModule,
    NotificationsModule,
  ],
  controllers: [PaymentsController, PublicPaymentsController],
  providers: [
    PaymentSettingsService,
    OnlinePaymentsService,
    ChannelCryptoService,
    { provide: INVOICE_PAY_LINK_ISSUER, useExisting: OnlinePaymentsService },
  ],
})
export class PaymentsModule {}
