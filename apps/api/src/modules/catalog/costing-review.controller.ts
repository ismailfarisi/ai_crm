import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS, type CostingReviewDto } from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import {
  COSTING_REVIEW_MAX_DAYS,
  CostingReviewService,
} from './costing-review.service';

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
  constructor(private readonly reviews: CostingReviewService) {}

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
}
