import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { Customer } from './entities/customer.entity';
// Registered so the customer overview can read a customer's own documents
// through the shared entity manager; nothing here writes to them.
import { Quote } from '../quotes/entities/quote.entity';
import { Invoice } from '../quotes/entities/invoice.entity';
import { SalesOrder } from '../orders/entities/sales-order.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, Quote, Invoice, SalesOrder])],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
