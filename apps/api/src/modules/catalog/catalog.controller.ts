import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  catalogSearchSchema,
  createCatalogItemSchema,
  createMaterialSchema,
  createProductTemplateSchema,
  createToolingSchema,
  createWorkCenterSchema,
  PERMISSIONS,
  priceBreaksSchema,
  resolveLinesSchema,
  stripLineCosts,
  stripTotalsCosts,
  updateCatalogItemSchema,
  updateMaterialSchema,
  updateProductTemplateSchema,
  updateCostingPolicySchema,
  updateToolingSchema,
  updateWorkCenterSchema,
  type CatalogSearchPayload,
  type CreateCatalogItemPayload,
  type CreateMaterialPayload,
  type CreateProductTemplatePayload,
  type CreateToolingPayload,
  type CreateWorkCenterPayload,
  type PriceBreaksPayload,
  type ResolveLinesPayload,
  type CostingPolicy,
  type UpdateCatalogItemPayload,
  type UpdateCostingPolicyPayload,
  type UpdateMaterialPayload,
  type UpdateProductTemplatePayload,
  type UpdateToolingPayload,
  type UpdateWorkCenterPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { CatalogService } from './catalog.service';
import { CostingService, type ResolvedLines, type TemplatePriceBreaks } from './costing.service';
import { CatalogItem } from './entities/catalog-item.entity';
import { Material } from './entities/material.entity';
import { ProductTemplate } from './entities/product-template.entity';
import { Tooling } from './entities/tooling.entity';
import { WorkCenter } from './entities/work-center.entity';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly costingService: CostingService,
  ) {}

  /* ---------------- Materials ---------------- */

  @Get('catalog/materials')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'List materials' })
  async listMaterials(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<Material[]> {
    return this.catalogService.listMaterials(user.organizationId, includeInactive === 'true');
  }

  @Post('catalog/materials')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Create material' })
  async createMaterial(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createMaterialSchema)) dto: CreateMaterialPayload,
  ): Promise<Material> {
    return this.catalogService.createMaterial(user.organizationId, dto);
  }

  @Patch('catalog/materials/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Update material' })
  async updateMaterial(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateMaterialSchema)) dto: UpdateMaterialPayload,
  ): Promise<Material> {
    return this.catalogService.updateMaterial(user.organizationId, id, dto);
  }

  @Delete('catalog/materials/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Delete material' })
  async deleteMaterial(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: true }> {
    await this.catalogService.deleteMaterial(user.organizationId, id);
    return { success: true };
  }

  /* ---------------- Work centres ---------------- */

  @Get('catalog/work-centers')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'List work centres' })
  async listWorkCenters(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<WorkCenter[]> {
    return this.catalogService.listWorkCenters(user.organizationId, includeInactive === 'true');
  }

  @Post('catalog/work-centers')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Create work centre' })
  async createWorkCenter(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createWorkCenterSchema)) dto: CreateWorkCenterPayload,
  ): Promise<WorkCenter> {
    return this.catalogService.createWorkCenter(user.organizationId, dto);
  }

  @Patch('catalog/work-centers/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Update work centre' })
  async updateWorkCenter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateWorkCenterSchema)) dto: UpdateWorkCenterPayload,
  ): Promise<WorkCenter> {
    return this.catalogService.updateWorkCenter(user.organizationId, id, dto);
  }

  @Delete('catalog/work-centers/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Delete work centre' })
  async deleteWorkCenter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: true }> {
    await this.catalogService.deleteWorkCenter(user.organizationId, id);
    return { success: true };
  }

  /* ---------------- Tooling ---------------- */

  @Get('catalog/tooling')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'List tooling' })
  async listTooling(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<Tooling[]> {
    return this.catalogService.listTooling(user.organizationId, includeInactive === 'true');
  }

  @Post('catalog/tooling')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Create tooling' })
  async createTooling(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createToolingSchema)) dto: CreateToolingPayload,
  ): Promise<Tooling> {
    return this.catalogService.createTooling(user.organizationId, dto);
  }

  @Patch('catalog/tooling/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Update tooling' })
  async updateTooling(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateToolingSchema)) dto: UpdateToolingPayload,
  ): Promise<Tooling> {
    return this.catalogService.updateTooling(user.organizationId, id, dto);
  }

  @Delete('catalog/tooling/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Delete tooling' })
  async deleteTooling(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: true }> {
    await this.catalogService.deleteTooling(user.organizationId, id);
    return { success: true };
  }

  /* ---------------- Catalog items ---------------- */

  @Get('catalog/items')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Search catalog items',
    description: 'Backs the item picker in the quote editor',
  })
  async searchItems(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(catalogSearchSchema)) query: CatalogSearchPayload,
  ): Promise<CatalogItem[]> {
    const items = await this.catalogService.searchItems(user.organizationId, query);
    return canSeeCost(user) ? items : items.map(withoutStandardCost);
  }

  @Get('catalog/items/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'Get catalog item' })
  async findItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CatalogItem> {
    const item = await this.catalogService.findItem(user.organizationId, id);
    return canSeeCost(user) ? item : withoutStandardCost(item);
  }

  @Post('catalog/items')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Create catalog item' })
  async createItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createCatalogItemSchema)) dto: CreateCatalogItemPayload,
  ): Promise<CatalogItem> {
    return this.catalogService.createItem(user.organizationId, dto);
  }

  @Patch('catalog/items/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Update catalog item' })
  async updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateCatalogItemSchema)) dto: UpdateCatalogItemPayload,
  ): Promise<CatalogItem> {
    return this.catalogService.updateItem(user.organizationId, id, dto);
  }

  @Delete('catalog/items/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Delete catalog item' })
  async deleteItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: true }> {
    await this.catalogService.deleteItem(user.organizationId, id);
    return { success: true };
  }

  /* ---------------- Product templates ---------------- */

  @Get('catalog/templates')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'List product templates',
    description: 'Current versions only unless allVersions=true',
  })
  async listTemplates(
    @CurrentUser() user: AuthenticatedUser,
    @Query('allVersions') allVersions?: string,
  ): Promise<ProductTemplate[]> {
    const templates = await this.catalogService.listTemplates(
      user.organizationId,
      allVersions === 'true',
    );
    return canSeeCost(user) ? templates : templates.map(withoutCostModel);
  }

  @Get('catalog/templates/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({ summary: 'Get product template' })
  async findTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductTemplate> {
    const template = await this.catalogService.findTemplate(user.organizationId, id);
    return canSeeCost(user) ? template : withoutCostModel(template);
  }

  @Get('catalog/templates/:id/versions')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'List every version of a template' })
  async listTemplateVersions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductTemplate[]> {
    const template = await this.catalogService.findTemplate(user.organizationId, id);
    return this.catalogService.listTemplateVersions(user.organizationId, template.templateKey);
  }

  @Post('catalog/templates')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({ summary: 'Create product template (version 1)' })
  async createTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createProductTemplateSchema)) dto: CreateProductTemplatePayload,
  ): Promise<ProductTemplate> {
    return this.catalogService.createTemplate(user.organizationId, dto, user.id);
  }

  @Post('catalog/templates/:id/versions')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Publish a new template version',
    description:
      'Templates are immutable once published — this inserts version + 1 and leaves quotes pointing at the old one untouched',
  })
  async publishTemplateVersion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateProductTemplateSchema)) dto: UpdateProductTemplatePayload,
  ): Promise<ProductTemplate> {
    return this.catalogService.publishTemplateVersion(user.organizationId, id, dto, user.id);
  }

  @Delete('catalog/templates/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Retire a template',
    description: 'Removes it from the picker. Versions are never deleted — quotes reference them.',
  })
  async retireTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: true }> {
    await this.catalogService.retireTemplate(user.organizationId, id);
    return { success: true };
  }

  /* ---------------- Costing policy ---------------- */

  @Get('catalog/policy')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Get the tenant margin floor and discount cap',
  })
  async getPolicy(@CurrentUser() user: AuthenticatedUser): Promise<CostingPolicy> {
    return this.costingService.getPolicy(user.organizationId);
  }

  @Patch('catalog/policy')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiOperation({
    summary: 'Update the commercial floors',
    description:
      'Enforcement is off until switched on, so enabling the costing engine does not retroactively block quotes that were acceptable before',
  })
  async updatePolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updateCostingPolicySchema)) dto: UpdateCostingPolicyPayload,
  ): Promise<CostingPolicy> {
    return this.costingService.updatePolicy(user.organizationId, dto);
  }

  /* ---------------- Resolver ---------------- */

  @Post('catalog/resolve-lines')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Resolve catalog references into priced quote lines',
    description:
      'The browser sends ids, quantities and template parameters; prices and cost snapshots are decided here. Cost is omitted entirely without quote:view_cost.',
  })
  async resolveLines(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(resolveLinesSchema)) dto: ResolveLinesPayload,
  ): Promise<ResolvedLines> {
    const resolved = await this.costingService.resolveLines(user.organizationId, dto);
    if (canSeeCost(user)) return resolved;

    return {
      ...resolved,
      lines: stripLineCosts(resolved.lines),
      totals: stripTotalsCosts(resolved.totals),
    };
  }

  @Post('catalog/templates/:id/price-breaks')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  @ApiOperation({
    summary: 'Price a template across several quantities',
    description:
      'Unit price falls in steps as quantity rises, because sheets are bought whole and setup is charged once',
  })
  async priceBreaks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(priceBreaksSchema)) dto: PriceBreaksPayload,
  ): Promise<TemplatePriceBreaks> {
    const result = await this.costingService.priceBreaks(user.organizationId, id, dto);
    if (canSeeCost(user)) return result;

    return {
      ...result,
      breaks: result.breaks.map(({ unitCost: _unitCost, marginPct: _marginPct, ...rest }) => ({
        ...rest,
        unitCost: 0,
        marginPct: 0,
      })),
    };
  }
}

/**
 * Permissions are resolved per request and live on `req.user`, never in the
 * JWT — see `RbacService.resolveAccess`.
 */
function canSeeCost(user: AuthenticatedUser): boolean {
  return (user.permissions ?? []).includes(PERMISSIONS.QUOTE_VIEW_COST);
}

function withoutStandardCost(item: CatalogItem): CatalogItem {
  return { ...item, standardCost: 0 } as CatalogItem;
}

/**
 * The bill of materials and routing *are* the cost base — sheet counts and
 * machine minutes reverse straight into it — so a template without cost rights
 * comes back as a name and its parameters only.
 */
function withoutCostModel(template: ProductTemplate): ProductTemplate {
  return {
    ...template,
    materials: [],
    operations: [],
    tooling: [],
    pricing: { method: 'MARGIN', rate: 0, overheadPct: 0 },
  } as ProductTemplate;
}
