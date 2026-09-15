import { Column, Entity, Index } from 'typeorm';
import type {
  CostSplit,
  WorkOrderOperationStatus,
  WorkOrderStatus,
} from '@saas/shared';
import { BaseEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';
import { nullableNumericTransformer } from '../../catalog/entities/numeric.transformer';

const numeric = (name: string, precision: number, scale: number) =>
  ({
    name,
    type: 'numeric',
    precision,
    scale,
    default: 0,
    transformer: numericTransformer,
  }) as const;

/**
 * One job on the shop floor.
 *
 * Plain columns rather than TypeORM relations to its operations and
 * materials, for the same reason as sales orders: relations would name their
 * own foreign keys and report the migration's as drift.
 */
@Entity('work_orders')
@Index('idx_work_orders_tenant_status', ['tenantId', 'status'])
@Index('uq_work_orders_tenant_number', ['tenantId', 'woNumber'], {
  unique: true,
})
@Index('idx_work_orders_sales_order', ['salesOrderId'])
// One live job per order line; a cancelled job frees the line.
@Index('uq_work_orders_live_line', ['salesOrderLineId'], {
  unique: true,
  where: `"sales_order_line_id" IS NOT NULL AND "status" <> 'CANCELLED'`,
})
export class WorkOrder extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'wo_number', type: 'varchar', length: 40 })
  woNumber: string;

  @Column({ type: 'varchar', length: 20, default: 'PLANNED' })
  status: WorkOrderStatus;

  @Column({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId: string | null;

  @Column({ name: 'sales_order_line_id', type: 'uuid', nullable: true })
  salesOrderLineId: string | null;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'template_id', type: 'uuid', nullable: true })
  templateId: string | null;

  @Column({ name: 'template_key', type: 'varchar', length: 60, nullable: true })
  templateKey: string | null;

  @Column({
    name: 'template_name',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  templateName: string | null;

  @Column({ name: 'template_version', type: 'int', nullable: true })
  templateVersion: number | null;

  /** The quote line's template inputs, so the routing can be explained later. */
  @Column({ type: 'jsonb', default: {} })
  parameters: Record<string, unknown>;

  @Column(numeric('qty', 14, 4))
  qty: number;

  @Column({
    name: 'qty_completed',
    type: 'numeric',
    precision: 14,
    scale: 4,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  qtyCompleted: number | null;

  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate: Date | null;

  /** The template's burden, applied to actual direct cost exactly as the engine applied it to the estimate. */
  @Column(numeric('overhead_pct', 7, 4))
  overheadPct: number;

  /** The cost the customer was quoted against, from the quote line's snapshot. */
  @Column({
    name: 'quoted_unit_cost',
    type: 'numeric',
    precision: 14,
    scale: 4,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  quotedUnitCost: number | null;

  @Column({ name: 'estimated_cost', type: 'jsonb', nullable: true })
  estimatedCost: CostSplit | null;

  /** Written once, on completion. */
  @Column({ name: 'actual_cost', type: 'jsonb', nullable: true })
  actualCost: CostSplit | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'completed_by_id', type: 'uuid', nullable: true })
  completedById: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;
}

@Entity('work_order_operations')
@Index('idx_work_order_operations_order', ['workOrderId'])
@Index('idx_work_order_operations_center', ['tenantId', 'workCenterId'])
export class WorkOrderOperation extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'work_order_id', type: 'uuid' })
  workOrderId: string;

  @Column({ type: 'int' })
  sequence: number;

  @Column({
    name: 'operation_key',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  operationKey: string | null;

  @Column({ type: 'varchar', length: 200 })
  label: string;

  @Column({ name: 'work_center_id', type: 'uuid' })
  workCenterId: string;

  @Column({ name: 'work_center_name', type: 'varchar', length: 160 })
  workCenterName: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: WorkOrderOperationStatus;

  @Column(numeric('estimated_setup_minutes', 10, 2))
  estimatedSetupMinutes: number;

  @Column(numeric('estimated_run_minutes', 10, 2))
  estimatedRunMinutes: number;

  @Column(numeric('estimated_charged_minutes', 10, 2))
  estimatedChargedMinutes: number;

  @Column(numeric('actual_minutes', 10, 2))
  actualMinutes: number;

  @Column(numeric('machine_cost_per_hour', 12, 4))
  machineCostPerHour: number;

  @Column(numeric('labor_cost_per_hour', 12, 4))
  laborCostPerHour: number;

  @Column({ name: 'running_since', type: 'timestamptz', nullable: true })
  runningSince: Date | null;

  @Column({ name: 'operator_id', type: 'uuid', nullable: true })
  operatorId: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}

@Entity('work_order_materials')
@Index(
  'uq_work_order_materials_order_material',
  ['workOrderId', 'materialId'],
  { unique: true },
)
export class WorkOrderMaterial extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'work_order_id', type: 'uuid' })
  workOrderId: string;

  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @Column({ name: 'material_name', type: 'varchar', length: 200 })
  materialName: string;

  @Column({ type: 'varchar', length: 20 })
  uom: string;

  @Column(numeric('qty_planned', 14, 4))
  qtyPlanned: number;

  @Column(numeric('qty_issued', 14, 4))
  qtyIssued: number;

  @Column(numeric('qty_returned', 14, 4))
  qtyReturned: number;

  /** Net value in WIP for this material: issues at the moving average, less returns. */
  @Column(numeric('value_issued', 14, 4))
  valueIssued: number;

  @Column(numeric('estimated_unit_cost', 14, 4))
  estimatedUnitCost: number;

  @Column({ name: 'last_stock_movement_id', type: 'uuid', nullable: true })
  lastStockMovementId: string | null;
}
