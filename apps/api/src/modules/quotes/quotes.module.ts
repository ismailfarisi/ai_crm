import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quote } from './entities/quote.entity';
import { QuoteProof } from './entities/quote-proof.entity';
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
import { QuoteProofsController } from './quote-proofs.controller';
import { QuoteProofsService } from './quote-proofs.service';
import { QuoteResponsesService } from './quote-responses.service';
import { Attachment } from '../storage/entities/attachment.entity';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/entities/user.entity';
import { WorkOrder } from '../production/entities/work-order.entity';
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
import { TaxModule } from '../tax/tax.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentTemplatesModule } from '../document-templates/document-templates.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Quote,
      QuoteProof,
      Attachment,
      User,
      WorkOrder,
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
    TaxModule,
    NotificationsModule,
    DocumentTemplatesModule,
    StorageModule,
  ],
  controllers: [QuotesController, PublicQuotesController, QuoteProofsController],
  providers: [
    QuotesService,
    InvoicesService,
    InvoicePdfService,
    InvoiceOverdueService,
    QuoteAcceptanceService,
    QuoteProofsService,
    QuoteResponsesService,
  ],
  exports: [QuotesService, InvoicesService],
})
export class QuotesModule {}
