import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceModule } from '../finance/finance.module';
import { AutomationsModule } from '../automations/automations.module';
import { Invoice } from '../quotes/entities/invoice.entity';
import { Quote } from '../quotes/entities/quote.entity';
import {
  BillingScheduleLine,
  SalesOrder,
  SalesOrderLine,
} from './entities/sales-order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * Deliberately does not import `QuotesModule`: quotes create orders (through
 * the DI-free `order-provisioning.ts`), so the dependency points that way.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesOrder,
      SalesOrderLine,
      BillingScheduleLine,
      Invoice,
      Quote,
    ]),
    FinanceModule,
    AutomationsModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
