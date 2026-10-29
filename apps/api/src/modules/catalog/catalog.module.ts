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
import { CostingReviewController } from './costing-review.controller';
import { CostingReviewService } from './costing-review.service';

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
    ]),
  ],
  controllers: [CatalogController, CostingReviewController],
  providers: [CatalogService, CostingService, CostingReviewService],
  // QuotesModule consumes CostingService to re-cost lines on save, so the
  // client can never post its own cost.
  exports: [CatalogService, CostingService],
})
export class CatalogModule {}
