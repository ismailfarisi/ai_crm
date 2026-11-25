import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceModule } from '../finance/finance.module';
import { ProductionModule } from '../production/production.module';
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
import { DocumentTemplatesModule } from '../document-templates/document-templates.module';
import { JobCostingModule } from '../job-costing/job-costing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderCostService } from './order-cost.service';

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
    // Moving an order to IN_PRODUCTION raises the work orders it claims exist.
    ProductionModule,
    DocumentTemplatesModule,
    JobCostingModule,
    NotificationsModule,
  ],
  controllers: [OrdersController, DeliveryNotesController],
  providers: [
    OrdersService,
    DeliveryNotesService,
    PackingSlipPdfService,
    OrderCostService,
  ],
  exports: [OrdersService, DeliveryNotesService, OrderCostService],
})
export class OrdersModule {}
