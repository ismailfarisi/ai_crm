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
import {
  adjustStockSchema,
  PERMISSIONS,
  receiveGoodsSchema,
  type AdjustStockPayload,
  type ReceiveGoodsPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { InventoryService, type StockItemView } from './inventory.service';
import { GoodsReceipt } from './entities/goods-receipt.entity';
import { StockLocation } from './entities/stock-location.entity';
import { StockMovement } from './entities/stock-movement.entity';

@ApiTags('inventory')
@Controller()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('inventory/stock')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Stock on hand, per material and location' })
  async stock(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StockItemView[]> {
    return this.inventory.listStockView(user.organizationId);
  }

  @Get('inventory/locations')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'Stock locations' })
  async locations(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StockLocation[]> {
    return this.inventory.listLocations(user.organizationId);
  }

  @Get('inventory/reorder-suggestions')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary: 'Materials at or below their reorder point',
    description:
      'Counts stock already on order, so one shortage does not produce two purchase orders.',
  })
  async reorder(@CurrentUser() user: AuthenticatedUser) {
    return this.inventory.reorderSuggestions(user.organizationId);
  }

  @Get('inventory/reconcile')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({
    summary:
      'Compare the cached position against a replay of the movement ledger',
    description:
      'Should always be empty. A divergence means something wrote a quantity without recording why.',
  })
  async reconcile(@CurrentUser() user: AuthenticatedUser) {
    return this.inventory.reconcile(user.organizationId);
  }

  @Post('inventory/adjustments')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ApiOperation({
    summary: 'Correct a stock quantity after a count or write-off',
  })
  async adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(adjustStockSchema)) body: AdjustStockPayload,
  ): Promise<StockMovement> {
    return this.inventory.adjust(user.organizationId, user.id, body);
  }

  @Get('goods-receipts')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ApiOperation({ summary: 'List goods receipts' })
  async receipts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('purchaseOrderId') purchaseOrderId?: string,
  ): Promise<GoodsReceipt[]> {
    return this.inventory.listReceipts(user.organizationId, purchaseOrderId);
  }

  @Post('purchase-orders/:id/receipts')
  @RequirePermissions(PERMISSIONS.GOODS_RECEIPT_CREATE)
  @ApiOperation({
    summary: 'Book a delivery in against a purchase order',
    description:
      'Moves stock, updates the order, and posts Dr Inventory / Cr GRNI — all in one transaction.',
  })
  async receive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(receiveGoodsSchema)) body: ReceiveGoodsPayload,
  ): Promise<GoodsReceipt> {
    return this.inventory.receive(user.organizationId, id, user.id, body);
  }
}
