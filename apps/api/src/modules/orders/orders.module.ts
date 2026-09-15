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
import { DeliveryNotesController } from './delivery-notes.controller';
import { DeliveryNotesService } from './delivery-notes.service';
import { PackingSlipPdfService } from './packing-slip-pdf.service';
import { InventoryModule } from '../inventory/inventory.module';
import { CatalogItem } from '../catalog/entities/catalog-item.entity';
import { Organization } from '../organizations/entities/organization.entity';
import {
  DeliveryNote,
  DeliveryNoteLine,
} from '../credits/entities/credit-note.entity';

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
      DeliveryNote,
      DeliveryNoteLine,
      CatalogItem,
      Organization,
    ]),
    FinanceModule,
    AutomationsModule,
    InventoryModule,
  ],
  controllers: [OrdersController, DeliveryNotesController],
  providers: [OrdersService, DeliveryNotesService, PackingSlipPdfService],
  exports: [OrdersService],
})
export class OrdersModule {}
