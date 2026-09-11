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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Material,
      WorkCenter,
      Tooling,
      CatalogItem,
      ProductTemplate,
      CostingPolicy,
    ]),
  ],
  controllers: [CatalogController],
  providers: [CatalogService, CostingService],
  // QuotesModule consumes CostingService to re-cost lines on save, so the
  // client can never post its own cost.
  exports: [CatalogService, CostingService],
})
export class CatalogModule {}
