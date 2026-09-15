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
  cancelWorkOrderSchema,
  completeWorkOrderSchema,
  createWorkOrdersSchema,
  issueMaterialSchema,
  logOperationTimeSchema,
  PERMISSIONS,
  workOrderQuerySchema,
  type CancelWorkOrderPayload,
  type CompleteWorkOrderPayload,
  type CreateWorkOrdersPayload,
  type IssueMaterialPayload,
  type LogOperationTimePayload,
  type WorkOrderDto,
  type WorkOrderQueryPayload,
} from '@saas/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody, zodQuery } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { ProductionService } from './production.service';

const varianceQuerySchema = z.object({
  from: z.coerce
    .date()
    .nullish()
    .transform((v) => v ?? undefined),
  to: z.coerce
    .date()
    .nullish()
    .transform((v) => v ?? undefined),
});

/**
 * Cost figures follow `quote:view_cost`, the precedent set by quotes and
 * supplier prices: the shop floor sees the job, not what it is worth.
 */
const canSeeCost = (user: AuthenticatedUser) =>
  user.permissions.includes(PERMISSIONS.QUOTE_VIEW_COST);

@ApiTags('production')
@Controller()
export class ProductionController {
  constructor(private readonly production: ProductionService) {}

  @Get('work-orders')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_READ)
  @ApiOperation({ summary: 'List work orders for the production board' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(workOrderQuerySchema)) query: WorkOrderQueryPayload,
  ): Promise<WorkOrderDto[]> {
    return this.production.list(user.organizationId, query, canSeeCost(user));
  }

  @Get('work-orders/variance')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_READ, PERMISSIONS.QUOTE_VIEW_COST)
  @ApiOperation({
    summary: 'Estimate against actual, by template version and work centre',
    description: 'Ranked by the cost of the estimating error, largest first.',
  })
  variance(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(varianceQuerySchema))
    query: z.output<typeof varianceQuerySchema>,
  ) {
    return this.production.varianceReport(user.organizationId, query);
  }

  @Get('work-orders/:id')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_READ)
  @ApiOperation({
    summary: 'Get a work order with its operations and materials',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkOrderDto> {
    return this.production.get(user.organizationId, id, canSeeCost(user));
  }

  @Post('sales-orders/:id/work-orders')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_CREATE)
  @ApiOperation({
    summary: 'Plan work orders from a sales order',
    description:
      'One per template-priced line without a live work order. Lines with no routing are skipped with a reason.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(createWorkOrdersSchema)) body: CreateWorkOrdersPayload,
  ) {
    return this.production.createFromSalesOrder(
      user.organizationId,
      user.id,
      id,
      body,
    );
  }

  @Post('work-orders/:id/release')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_UPDATE)
  @ApiOperation({ summary: 'Release a planned job to the shop floor' })
  release(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.production.release(user.organizationId, id);
  }

  @Post('work-orders/:id/complete')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_UPDATE)
  @ApiOperation({
    summary: 'Complete a job',
    description:
      'Records the good quantity, computes actual cost, and posts material from WIP to cost of sales.',
  })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(completeWorkOrderSchema)) body: CompleteWorkOrderPayload,
  ) {
    return this.production.complete(
      user.organizationId,
      id,
      user.id,
      body,
      canSeeCost(user),
    );
  }

  @Post('work-orders/:id/cancel')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_UPDATE)
  @ApiOperation({ summary: 'Cancel a job with no material left on it' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(cancelWorkOrderSchema)) body: CancelWorkOrderPayload,
  ) {
    return this.production.cancel(user.organizationId, id, body.reason);
  }

  @Post('work-orders/:id/operations/:operationId/start')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_EXECUTE)
  @ApiOperation({ summary: 'Start the clock on an operation' })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ) {
    return this.production.startOperation(
      user.organizationId,
      id,
      operationId,
      user.id,
    );
  }

  @Post('work-orders/:id/operations/:operationId/stop')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_EXECUTE)
  @ApiOperation({ summary: 'Pause the clock on an operation' })
  stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ) {
    return this.production.stopOperation(
      user.organizationId,
      id,
      operationId,
      false,
    );
  }

  @Post('work-orders/:id/operations/:operationId/finish')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_EXECUTE)
  @ApiOperation({ summary: 'Stop the clock and mark an operation done' })
  finish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
  ) {
    return this.production.stopOperation(
      user.organizationId,
      id,
      operationId,
      true,
    );
  }

  @Post('work-orders/:id/operations/:operationId/time')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_EXECUTE)
  @ApiOperation({ summary: 'Log time on an operation after the fact' })
  logTime(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Body(zodBody(logOperationTimeSchema)) body: LogOperationTimePayload,
  ) {
    return this.production.logTime(
      user.organizationId,
      id,
      operationId,
      user.id,
      body.minutes,
    );
  }

  @Post('work-orders/:id/materials')
  @RequirePermissions(PERMISSIONS.WORK_ORDER_EXECUTE)
  @ApiOperation({
    summary: 'Issue material to a job, or return it',
    description:
      'Positive quantity issues from stock into WIP; negative returns unused material.',
  })
  issue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(issueMaterialSchema)) body: IssueMaterialPayload,
  ) {
    return this.production.issueMaterial(
      user.organizationId,
      id,
      user.id,
      body,
      canSeeCost(user),
    );
  }
}
