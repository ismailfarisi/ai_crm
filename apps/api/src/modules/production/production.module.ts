import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { JobCostingModule } from '../job-costing/job-costing.module';
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
import { ProductionBoardSetting } from './entities/production-board-settings.entity';
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
      ProductionBoardSetting,
    ]),
    // Routing and material come from the costing engine; issues move stock
    // and post to the ledger.
    CatalogModule,
    InventoryModule,
    FinanceModule,
    // The labour panel and actual labour cost of a job.
    JobCostingModule,
  ],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
