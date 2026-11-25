import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CostingService } from './costing.service';
import { CatalogItem } from './entities/catalog-item.entity';
import { CostingPolicy } from './entities/costing-policy.entity';
import { Material } from './entities/material.entity';
import { ProductTemplate } from './entities/product-template.entity';
import { Tooling } from './entities/tooling.entity';
import { WorkCenter } from './entities/work-center.entity';
import {
  WorkOrder,
  WorkOrderMaterial,
  WorkOrderOperation,
} from '../production/entities/work-order.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerAccount } from '../finance/entities/ledger-account.entity';
import { CostingReviewController } from './costing-review.controller';
import { OverheadRateController } from './overhead-rate.controller';
import { OverheadRateService } from './overhead-rate.service';
import { CostingReviewService } from './costing-review.service';
import { MaterialCostsService } from './material-costs.service';
import { GoodsReceiptLine } from '../inventory/entities/goods-receipt.entity';
import { StockItem } from '../inventory/entities/stock-item.entity';
import { SupplierMaterial } from '../purchasing/entities/supplier-material.entity';
import { Supplier } from '../purchasing/entities/supplier.entity';
import { StarterTemplatesController } from './starter-templates.controller';
import { StarterTemplatesService } from './starter-templates.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Material,
      WorkCenter,
      Tooling,
      CatalogItem,
      ProductTemplate,
      CostingPolicy,
      // Read by the costing review; owned by production.
      WorkOrder,
      WorkOrderMaterial,
      WorkOrderOperation,
      // Read when comparing catalog costs with what the shop pays.
      GoodsReceiptLine,
      StockItem,
      SupplierMaterial,
      Supplier,
      // Read by the overhead rate suggestion; owned by finance.
      JournalEntry,
      LedgerAccount,
    ]),
  ],
  controllers: [
    CatalogController,
    CostingReviewController,
    OverheadRateController,
    StarterTemplatesController,
  ],
  providers: [
    CatalogService,
    CostingService,
    CostingReviewService,
    MaterialCostsService,
    OverheadRateService,
    StarterTemplatesService,
  ],
  // QuotesModule consumes CostingService to re-cost lines on save, so the
  // client can never post its own cost.
  exports: [CatalogService, CostingService],
})
export class CatalogModule {}
