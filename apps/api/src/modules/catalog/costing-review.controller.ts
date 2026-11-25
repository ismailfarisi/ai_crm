import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  PERMISSIONS,
  type CostingReviewDto,
  type MaterialCostBasis,
  type MaterialCostReview,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import {
  COSTING_REVIEW_MAX_DAYS,
  CostingReviewService,
} from './costing-review.service';
import { MaterialCostsService } from './material-costs.service';
import type { CatalogItem } from './entities/catalog-item.entity';
import type { Material } from './entities/material.entity';

/** Only which figure to use: the amount itself is worked out on the server. */
const updateCostSchema = z.object({
  basis: z.enum(['LAST_PURCHASE', 'AVERAGE', 'SUPPLIER']),
});

const reviewQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(COSTING_REVIEW_MAX_DAYS)
    .default(180),
});

@ApiTags('catalog')
@Controller()
export class CostingReviewController {
  constructor(
    private readonly reviews: CostingReviewService,
    private readonly materialCosts: MaterialCostsService,
  ) {}

  @Get('catalog/costing-review')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'What completed jobs say about the catalog’s rates',
    description:
      'Compares estimates with actuals on jobs completed in the window and proposes material prices, waste allowances and work-centre time allowances. Changes nothing; apply a proposal with the ordinary catalog update.',
  })
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(reviewQuerySchema)) query: { days: number },
  ): Promise<CostingReviewDto> {
    return this.reviews.review(user.organizationId, query.days);
  }

  @Get('catalog/material-costs')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE, PERMISSIONS.QUOTE_VIEW_COST)
  @ApiOperation({
    summary: 'Catalog costs against what the shop pays',
    description:
      'Compares each material cost (and each stock item cost) with the last goods receipt, the average cost in stock and the supplier price. Changes nothing.',
  })
  materialCostReview(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MaterialCostReview> {
    return this.materialCosts.review(user.organizationId);
  }

  @Post('catalog/materials/:id/update-cost')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE, PERMISSIONS.QUOTE_VIEW_COST)
  @ApiOperation({
    summary: 'Set a material cost to what the shop pays',
    description:
      'An ordinary material update with the figure worked out on the server from receipts, stock or supplier prices. Quotes already made keep their costs.',
  })
  updateMaterialCost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateCostSchema)) body: { basis: MaterialCostBasis },
  ): Promise<Material | CatalogItem> {
    return this.materialCosts.apply(
      user.organizationId,
      { type: 'MATERIAL', id },
      body.basis,
    );
  }

  @Post('catalog/items/:id/update-cost')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE, PERMISSIONS.QUOTE_VIEW_COST)
  @ApiOperation({
    summary: 'Set a stock item cost to what the shop pays',
    description:
      'An ordinary catalog item update of standardCost, from the linked stock material.',
  })
  updateItemCost(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateCostSchema)) body: { basis: MaterialCostBasis },
  ): Promise<Material | CatalogItem> {
    return this.materialCosts.apply(
      user.organizationId,
      { type: 'CATALOG_ITEM', id },
      body.basis,
    );
  }
}
