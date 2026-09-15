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
  cancelSalesOrderSchema,
  PERMISSIONS,
  salesOrderQuerySchema,
  setSalesOrderStatusSchema,
  type CancelSalesOrderPayload,
  type SalesOrderDto,
  type SalesOrderQueryPayload,
  type SetSalesOrderStatusPayload,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { OrdersService } from './orders.service';

@ApiTags('sales-orders')
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('sales-orders')
  @RequirePermissions(PERMISSIONS.SALES_ORDER_READ)
  @ApiOperation({ summary: 'List sales orders' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(salesOrderQuerySchema)) query: SalesOrderQueryPayload,
  ): Promise<SalesOrderDto[]> {
    return this.orders.list(user.organizationId, query);
  }

  @Get('sales-orders/:id')
  @RequirePermissions(PERMISSIONS.SALES_ORDER_READ)
  @ApiOperation({
    summary: 'Get a sales order with its lines and billing stages',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SalesOrderDto> {
    return this.orders.get(user.organizationId, id);
  }

  @Get('quotes/:id/sales-order')
  @RequirePermissions(PERMISSIONS.SALES_ORDER_READ)
  @ApiOperation({ summary: 'The sales order an approved quote became, if any' })
  async byQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ order: SalesOrderDto | null }> {
    return { order: await this.orders.findByQuote(user.organizationId, id) };
  }

  @Post('sales-orders/:id/stages/:stageId/invoice')
  @RequirePermissions(PERMISSIONS.SALES_ORDER_INVOICE)
  @ApiOperation({
    summary: 'Invoice a billing stage',
    description:
      'Raises the invoice for a milestone or balance. Idempotent: a stage already invoiced returns its invoice.',
  })
  invoiceStage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
  ) {
    return this.orders.invoiceStage(user.organizationId, id, stageId);
  }

  @Post('sales-orders/:id/status')
  @RequirePermissions(PERMISSIONS.SALES_ORDER_UPDATE)
  @ApiOperation({ summary: 'Move an order through production and fulfilment' })
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(setSalesOrderStatusSchema)) body: SetSalesOrderStatusPayload,
  ): Promise<SalesOrderDto> {
    return this.orders.setStatus(user.organizationId, id, body.status);
  }

  @Post('sales-orders/:id/cancel')
  @RequirePermissions(PERMISSIONS.SALES_ORDER_CANCEL)
  @ApiOperation({ summary: 'Cancel an order that has not been invoiced' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(cancelSalesOrderSchema)) body: CancelSalesOrderPayload,
  ): Promise<SalesOrderDto> {
    return this.orders.cancel(user.organizationId, id, body.reason);
  }
}
