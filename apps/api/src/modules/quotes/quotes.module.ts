import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quote } from './entities/quote.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoicePayment } from './entities/invoice-payment.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { QuotesService } from './quotes.service';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoiceOverdueService } from './invoice-overdue.service';
import { QuotesController } from './quotes.controller';
import { PublicQuotesController } from './public-quotes.controller';
import { QuoteAcceptanceService } from './quote-acceptance.service';
import {
  BillingScheduleLine,
  SalesOrder,
  SalesOrderLine,
} from '../orders/entities/sales-order.entity';
import { FinanceModule } from '../finance/finance.module';
import { MailModule } from '../mail/mail.module';
import { AutomationsModule } from '../automations/automations.module';
import { CatalogModule } from '../catalog/catalog.module';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Quote,
      Invoice,
      InvoicePayment,
      Organization,
      SalesOrder,
      SalesOrderLine,
      BillingScheduleLine,
    ]),
    FinanceModule,
    MailModule,
    AutomationsModule,
    // Quote lines are re-priced from the catalog on save, and the margin
    // override is checked against the actor's own effective permissions.
    CatalogModule,
    RbacModule,
  ],
  controllers: [QuotesController, PublicQuotesController],
  providers: [
    QuotesService,
    InvoicesService,
    InvoicePdfService,
    InvoiceOverdueService,
    QuoteAcceptanceService,
  ],
  exports: [QuotesService, InvoicesService],
})
export class QuotesModule {}
