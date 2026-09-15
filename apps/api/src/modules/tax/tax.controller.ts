import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  taxCodeSchema,
  taxReportQuerySchema,
  taxRuleSchema,
  type TaxCodePayload,
  type TaxReportQueryPayload,
  type TaxRulePayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { TaxService } from './tax.service';

@ApiTags('tax')
@Controller('finance')
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  @Get('tax-codes')
  @RequirePermissions(PERMISSIONS.TAX_READ)
  @ApiOperation({ summary: 'List tax codes' })
  listCodes(@CurrentUser() user: AuthenticatedUser) {
    return this.tax.listCodes(user.organizationId);
  }

  @Post('tax-codes')
  @RequirePermissions(PERMISSIONS.TAX_MANAGE)
  @ApiOperation({ summary: 'Create a tax code' })
  createCode(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(taxCodeSchema)) body: TaxCodePayload,
  ) {
    return this.tax.createCode(user.organizationId, body);
  }

  @Put('tax-codes/:id')
  @RequirePermissions(PERMISSIONS.TAX_MANAGE)
  @ApiOperation({
    summary:
      'Update a tax code. Issued documents keep the rate they were issued with.',
  })
  updateCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(taxCodeSchema)) body: TaxCodePayload,
  ) {
    return this.tax.updateCode(user.organizationId, id, body);
  }

  @Get('tax-rules')
  @RequirePermissions(PERMISSIONS.TAX_READ)
  @ApiOperation({
    summary: 'List the rules that choose a tax code from an address',
  })
  listRules(@CurrentUser() user: AuthenticatedUser) {
    return this.tax.listRules(user.organizationId);
  }

  @Post('tax-rules')
  @RequirePermissions(PERMISSIONS.TAX_MANAGE)
  @ApiOperation({ summary: 'Add a tax rule' })
  createRule(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(taxRuleSchema)) body: TaxRulePayload,
  ) {
    return this.tax.createRule(user.organizationId, body);
  }

  @Delete('tax-rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.TAX_MANAGE)
  @ApiOperation({ summary: 'Remove a tax rule' })
  async deleteRule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.tax.deleteRule(user.organizationId, id);
  }

  @Get('tax-report')
  @RequirePermissions(PERMISSIONS.TAX_READ)
  @ApiOperation({ summary: 'Output and input tax for a period, by code' })
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(taxReportQuerySchema)) query: TaxReportQueryPayload,
  ) {
    return this.tax.report(user.organizationId, query.from, query.to);
  }
}
