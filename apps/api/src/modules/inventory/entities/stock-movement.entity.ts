import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { StockMovementType, StockReferenceType } from '@saas/shared';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * The stock ledger. Append-only, never updated, never soft-deleted.
 *
 * This is the source of truth; `stock_items` is a cached projection that
 * `replayMovements` can rebuild. A correction is another movement, not an
 * edit — the same discipline the journal follows, and for the same reason:
 * a quantity nobody can explain is worse than a quantity that is wrong.
 */
@Entity('stock_movements')
@Index('idx_stock_movements_tenant_material', ['tenantId', 'materialId'])
@Index('idx_stock_movements_reference', ['referenceType', 'referenceId'])
export class StockMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'material_id', type: 'uuid' })
  materialId: string;

  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({ type: 'varchar', length: 20 })
  type: StockMovementType;

  /** Signed: positive brings stock in, negative takes it out. */
  @Column({
    name: 'qty_delta',
    type: 'numeric',
    precision: 14,
    scale: 4,
    transformer: numericTransformer,
  })
  qtyDelta: number;

  /** The price this movement happened at — not the average after it. */
  @Column({
    name: 'unit_cost',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  unitCost: number;

  /** The running average *after* this movement, so history reads without replay. */
  @Column({
    name: 'avg_unit_cost_after',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  avgUnitCostAfter: number;

  @Column({
    name: 'qty_on_hand_after',
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: numericTransformer,
  })
  qtyOnHandAfter: number;

  @Column({
    name: 'reference_type',
    type: 'varchar',
    length: 30,
    default: 'MANUAL',
  })
  referenceType: StockReferenceType;

  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId: string | null;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
