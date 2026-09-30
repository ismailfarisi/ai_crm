import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerStatementService } from './customer-statement.service';
import { Customer } from './entities/customer.entity';
// Registered so the customer overview can read a customer's own documents
// through the shared entity manager; nothing here writes to them.
import { Quote } from '../quotes/entities/quote.entity';
import { Invoice } from '../quotes/entities/invoice.entity';
import { InvoicePayment } from '../quotes/entities/invoice-payment.entity';
import { SalesOrder } from '../orders/entities/sales-order.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { DocumentPdfRendererService } from '../document-templates/document-pdf-renderer.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      Quote,
      Invoice,
      InvoicePayment,
      SalesOrder,
      Organization,
    ]),
  ],
  controllers: [CustomersController],
  providers: [
    CustomersService,
    CustomerStatementService,
    DocumentPdfRendererService,
  ],
  exports: [CustomersService, CustomerStatementService],
})
export class CustomersModule {}

