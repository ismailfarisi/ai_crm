import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  acceptOverheadSuggestionSchema,
  overheadSuggestionQuerySchema,
  PERMISSIONS,
  type CostingPolicy,
  type OverheadSuggestionDto,
  type OverheadSuggestionQuery,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { OverheadRateService } from './overhead-rate.service';

/**
 * The shop-wide overhead rate, suggested from the books. Both routes show
 * what the shop spends, so they need the cost permission as well as the
 * right to change the catalog.
 */
@ApiTags('catalog')
@Controller()
export class OverheadRateController {
  constructor(private readonly overhead: OverheadRateService) {}

  @Get('catalog/policy/overhead-suggestion')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE, PERMISSIONS.QUOTE_VIEW_COST)
  @ApiOperation({
    summary: 'Suggest a shop-wide overhead rate from the books',
    description:
      'Running costs (operating expense accounts, net of labour absorbed into jobs) divided by cost of sales over the last full months. Changes nothing.',
  })
  suggest(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(overheadSuggestionQuerySchema))
    query: OverheadSuggestionQuery,
  ): Promise<OverheadSuggestionDto> {
    return this.overhead.suggest(
      user.organizationId,
      query.months,
      query.exclude,
    );
  }

  @Post('catalog/policy/overhead-suggestion/accept')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE, PERMISSIONS.QUOTE_VIEW_COST)
  @ApiOperation({
    summary: 'Use the suggested overhead rate as the shop rate',
    description:
      'The rate is worked out again on the server from the months and accounts named; the browser never sends the percentage.',
  })
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(acceptOverheadSuggestionSchema))
    dto: { months: number; excludeAccountCodes: string[] },
  ): Promise<CostingPolicy> {
    return this.overhead.accept(
      user.organizationId,
      dto.months,
      dto.excludeAccountCodes,
    );
  }
}
