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
import { FinanceModule } from '../finance/finance.module';
import { MailModule } from '../mail/mail.module';
import { AutomationsModule } from '../automations/automations.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Quote, Invoice, InvoicePayment, Organization]),
    FinanceModule,
    MailModule,
    AutomationsModule,
  ],
  controllers: [QuotesController],
  providers: [
    QuotesService,
    InvoicesService,
    InvoicePdfService,
    InvoiceOverdueService,
  ],
  exports: [QuotesService, InvoicesService],
})
export class QuotesModule {}
