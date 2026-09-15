import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import {
  SalesOrder,
  SalesOrderLine,
} from '../orders/entities/sales-order.entity';
import { Quote } from '../quotes/entities/quote.entity';
import {
  WorkOrder,
  WorkOrderMaterial,
  WorkOrderOperation,
} from './entities/work-order.entity';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkOrder,
      WorkOrderOperation,
      WorkOrderMaterial,
      SalesOrder,
      SalesOrderLine,
      Quote,
    ]),
    // Routing and material come from the costing engine; issues move stock
    // and post to the ledger.
    CatalogModule,
    InventoryModule,
    FinanceModule,
  ],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
