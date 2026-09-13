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
  cancelPurchaseOrderSchema,
  createPurchaseOrderSchema,
  createSupplierSchema,
  PERMISSIONS,
  purchaseOrderQuerySchema,
  suggestPurchaseOrderSchema,
  updatePurchasePolicySchema,
  replaceSupplierMaterialsSchema,
  supplierQuerySchema,
  updateSupplierSchema,
  type CancelPurchaseOrderPayload,
  type CreatePurchaseOrderPayload,
  type CreateSupplierPayload,
  type PurchaseGuardrailViolation,
  type PurchaseOrderQueryPayload,
  type PurchasePolicy,
  type SuggestPurchaseOrderPayload,
  type UpdatePurchasePolicyPayload,
  type PaginatedResult,
  type ReplaceSupplierMaterialsPayload,
  type SupplierQueryPayload,
  type UpdateSupplierPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { PurchasingService, type PurchaseSuggestion } from './purchasing.service';
import { PurchaseOrderLifecycleService } from './purchase-order-lifecycle.service';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { CostingService } from '../catalog/costing.service';
import { QuotesService } from '../quotes/quotes.service';
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
  constructor(
    private readonly purchasing: PurchasingService,
    private readonly lifecycle: PurchaseOrderLifecycleService,
    private readonly costing: CostingService,
    private readonly quotes: QuotesService,
  ) {}

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

  /* ---------------- Purchase orders ---------------- */

  @Get('purchase-orders')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_READ)
  @ApiOperation({ summary: 'List purchase orders' })
  async listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(purchaseOrderQuerySchema)) query: PurchaseOrderQueryPayload,
  ): Promise<PaginatedResult<PurchaseOrder>> {
    return this.purchasing.listPurchaseOrders(user.organizationId, query);
  }

  @Get('purchase-orders/:id')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_READ)
  @ApiOperation({ summary: 'Get one purchase order' })
  async getOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseOrder> {
    return this.purchasing.findById(user.organizationId, id);
  }

  @Get('purchase-orders/:id/guardrails')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_READ)
  @ApiOperation({
    summary: 'Policy check for one order',
    description:
      'The same evaluation the API enforces on submit, so the editor can warn before anyone clicks it.',
  })
  async guardrails(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseGuardrailViolation[]> {
    return this.lifecycle.check(user.organizationId, id);
  }

  @Post('purchase-orders')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_CREATE)
  @ApiOperation({ summary: 'Raise a draft purchase order' })
  async createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createPurchaseOrderSchema)) body: CreatePurchaseOrderPayload,
  ): Promise<PurchaseOrder> {
    return this.purchasing.createPurchaseOrder(user.organizationId, user.id, body);
  }

  @Post('purchase-orders/suggest')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_CREATE, PERMISSIONS.QUOTE_READ)
  @ApiOperation({
    summary: 'Propose orders for the stock a quote consumes',
    description:
      "Recomputes the quote's material demand from the costing engine and groups it by preferred supplier. Returns drafts to review - nothing is created.",
  })
  async suggest(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(suggestPurchaseOrderSchema)) body: SuggestPurchaseOrderPayload,
  ): Promise<PurchaseSuggestion> {
    const quote = await this.quotes.findQuoteById(user.organizationId, body.quoteId);
    const demand = await this.costing.materialDemandForItems(
      user.organizationId,
      quote.items ?? [],
    );
    return this.purchasing.suggestFromQuote(user.organizationId, demand);
  }

  @Post('purchase-orders/:id/submit')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_UPDATE)
  @ApiOperation({ summary: 'Send a draft for approval' })
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseOrder> {
    return this.lifecycle.submit(user.organizationId, id, {
      userId: user.id,
      permissions: user.permissions,
    });
  }

  @Post('purchase-orders/:id/reopen')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_UPDATE)
  @ApiOperation({ summary: 'Pull an order back to draft for changes' })
  async reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseOrder> {
    return this.lifecycle.reopen(user.organizationId, id);
  }

  @Post('purchase-orders/:id/approve')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_APPROVE)
  @ApiOperation({
    summary: 'Approve an order',
    description:
      'Above the tenant threshold this also needs purchase_order:approve_above_threshold. The check is against the actor own effective permissions, in the service.',
  })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseOrder> {
    return this.lifecycle.approve(user.organizationId, id, {
      userId: user.id,
      permissions: user.permissions,
    });
  }

  @Post('purchase-orders/:id/send')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_UPDATE)
  @ApiOperation({ summary: 'Email the order to the supplier' })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PurchaseOrder> {
    return this.purchasing.sendToSupplier(user.organizationId, id);
  }

  @Post('purchase-orders/:id/cancel')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_DELETE)
  @ApiOperation({ summary: 'Cancel an order' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(cancelPurchaseOrderSchema)) body: CancelPurchaseOrderPayload,
  ): Promise<PurchaseOrder> {
    return this.lifecycle.cancel(
      user.organizationId,
      id,
      { userId: user.id, permissions: user.permissions },
      body.reason ?? null,
    );
  }

  /* ---------------- Policy ---------------- */

  @Get('purchase-policy')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_READ)
  @ApiOperation({ summary: 'Get the purchasing policy' })
  async getPolicy(@CurrentUser() user: AuthenticatedUser): Promise<PurchasePolicy> {
    return this.lifecycle.getPolicy(user.organizationId);
  }

  @Patch('purchase-policy')
  @RequirePermissions(PERMISSIONS.PURCHASE_ORDER_APPROVE_ABOVE_THRESHOLD)
  @ApiOperation({
    summary: 'Edit the purchasing policy',
    description:
      'Gated on the escalated permission: whoever sets the threshold is in effect setting their own limit.',
  })
  async updatePolicy(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updatePurchasePolicySchema)) body: UpdatePurchasePolicyPayload,
  ): Promise<PurchasePolicy> {
    return this.lifecycle.updatePolicy(user.organizationId, body);
  }
}
