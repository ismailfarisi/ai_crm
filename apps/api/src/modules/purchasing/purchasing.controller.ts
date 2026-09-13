import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createSupplierSchema,
  PERMISSIONS,
  replaceSupplierMaterialsSchema,
  supplierQuerySchema,
  updateSupplierSchema,
  type CreateSupplierPayload,
  type PaginatedResult,
  type ReplaceSupplierMaterialsPayload,
  type SupplierQueryPayload,
  type UpdateSupplierPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { PurchasingService } from './purchasing.service';
import { Supplier } from './entities/supplier.entity';
import { SupplierMaterial } from './entities/supplier-material.entity';

/**
 * Supplier costs are stripped for callers without `supplier:view_cost`,
 * following the `quote:view_cost` precedent — the supplier is visible, what
 * they charge is not.
 */
function stripCost(
  rows: SupplierMaterial[],
  canSeeCost: boolean,
): Partial<SupplierMaterial>[] {
  if (canSeeCost) return rows;
  return rows.map((row) => {
    const copy: Partial<SupplierMaterial> = { ...row };
    delete copy.unitCost;
    return copy;
  });
}

@ApiTags('purchasing')
@Controller()
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  /* ---------------- Suppliers ---------------- */

  @Get('suppliers')
  @RequirePermissions(PERMISSIONS.SUPPLIER_READ)
  @ApiOperation({ summary: 'List suppliers' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(supplierQuerySchema)) query: SupplierQueryPayload,
  ): Promise<PaginatedResult<Supplier>> {
    return this.purchasing.listSuppliers(user.organizationId, query);
  }

  @Get('suppliers/:id')
  @RequirePermissions(PERMISSIONS.SUPPLIER_READ)
  @ApiOperation({ summary: 'Get one supplier' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Supplier> {
    return this.purchasing.findSupplierById(user.organizationId, id);
  }

  @Post('suppliers')
  @RequirePermissions(PERMISSIONS.SUPPLIER_CREATE)
  @ApiOperation({ summary: 'Create a supplier' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createSupplierSchema)) body: CreateSupplierPayload,
  ): Promise<Supplier> {
    return this.purchasing.createSupplier(user.organizationId, body);
  }

  @Patch('suppliers/:id')
  @RequirePermissions(PERMISSIONS.SUPPLIER_UPDATE)
  @ApiOperation({ summary: 'Edit a supplier' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateSupplierSchema)) body: UpdateSupplierPayload,
  ): Promise<Supplier> {
    return this.purchasing.updateSupplier(user.organizationId, id, body);
  }

  @Delete('suppliers/:id')
  @RequirePermissions(PERMISSIONS.SUPPLIER_DELETE)
  @ApiOperation({ summary: 'Delete a supplier' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.purchasing.deleteSupplier(user.organizationId, id);
  }

  /* ---------------- Price list ---------------- */

  @Get('suppliers/:id/materials')
  @RequirePermissions(PERMISSIONS.SUPPLIER_READ)
  @ApiOperation({ summary: "List a supplier's price list" })
  async listMaterials(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Partial<SupplierMaterial>[]> {
    const rows = await this.purchasing.listSupplierMaterials(
      user.organizationId,
      id,
    );
    return stripCost(
      rows,
      user.permissions.includes(PERMISSIONS.SUPPLIER_VIEW_COST),
    );
  }

  @Put('suppliers/:id/materials')
  @RequirePermissions(
    PERMISSIONS.SUPPLIER_UPDATE,
    PERMISSIONS.SUPPLIER_VIEW_COST,
  )
  @ApiOperation({ summary: "Replace a supplier's price list" })
  async replaceMaterials(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(replaceSupplierMaterialsSchema))
    body: ReplaceSupplierMaterialsPayload,
  ): Promise<SupplierMaterial[]> {
    return this.purchasing.replaceSupplierMaterials(
      user.organizationId,
      id,
      body,
    );
  }
}
