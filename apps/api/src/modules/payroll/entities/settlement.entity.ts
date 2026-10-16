import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  PaymentMethod,
  SettlementLineKind,
  SettlementReason,
  SettlementStatus,
} from '@saas/shared';
import { numericTransformer } from '../../finance/entities/finance-account.entity';
import { nullableNumericTransformer } from '../../catalog/entities/numeric.transformer';
import { money } from './payroll-run.entity';

/**
 * A leaver's final settlement: gratuity, leave encashment, notice pay,
 * advance recovery and free lines. Draft → approved (posts, clears 2400 and
 * 2410 for the employee) → paid. At most one live (non-voided) settlement per
 * employee. CHECKs (status, reason) live in the migration.
 */
@Entity('settlements')
@Index('uq_settlements_tenant_number', ['tenantId', 'settlementNumber'], {
  unique: true,
})
@Index('uq_settlements_live_employee', ['tenantId', 'employeeId'], {
  unique: true,
  where: '"status" <> \'VOIDED\'',
})
export class Settlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** FS-0001, from the `settlement_number` sequence. */
  @Column({ name: 'settlement_number', type: 'varchar', length: 40 })
  settlementNumber: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'employee_name', type: 'varchar', length: 255 })
  employeeName: string;

  @Column({ name: 'leaving_date', type: 'date' })
  leavingDate: string;

  @Column({ type: 'varchar', length: 20 })
  reason: SettlementReason;

  @Column({ name: 'service_days', type: 'int' })
  serviceDays: number;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: SettlementStatus;

  /** Package in effect at the leaving date, snapshotted. */
  @Column(money('basic'))
  basic: number;

  @Column(money('gross'))
  gross: number;

  @Column({
    name: 'leave_balance_days',
    type: 'numeric',
    precision: 7,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  leaveBalanceDays: number;

  @Column(money('net_pay'))
  netPay: number;

  @Column({ name: 'payment_method', type: 'varchar', length: 10 })
  paymentMethod: PaymentMethod;

  @Column({ name: 'finance_account_id', type: 'uuid', nullable: true })
  financeAccountId: string | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'payment_journal_entry_id', type: 'uuid', nullable: true })
  paymentJournalEntryId: string | null;

  @Column({ name: 'void_journal_entry_id', type: 'uuid', nullable: true })
  voidJournalEntryId: string | null;

  @Column({ name: 'approved_by_id', type: 'uuid', nullable: true })
  approvedById: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** One line of a settlement. `amount` is signed: + paid to the employee, − deducted. */
@Entity('settlement_lines')
@Index('idx_settlement_lines_settlement', ['settlementId'])
export class SettlementLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'settlement_id', type: 'uuid' })
  settlementId: string;

  /** CHECK lives in the migration. */
  @Column({ type: 'varchar', length: 20 })
  kind: SettlementLineKind;

  @Column({ type: 'varchar', length: 160 })
  label: string;

  /** Days, where the line is days × rate. */
  @Column({
    type: 'numeric',
    precision: 7,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  quantity: number | null;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  rate: number | null;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}
