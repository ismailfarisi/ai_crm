import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PaymentMethod, PayrollRunStatus } from '@saas/shared';
import { numericTransformer } from '../../finance/entities/finance-account.entity';
import { nullableNumericTransformer } from '../../catalog/entities/numeric.transformer';
import type { OtherAllowance } from './salary-package.entity';

/** A money column: numeric(14,2), default 0. */
const money = (name: string) =>
  ({
    name,
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  }) as const;

/**
 * One month's payroll. Nothing posts until approval; voiding posts the exact
 * reversal and frees the period for a new run.
 */
@Entity('payroll_runs')
@Index('uq_payroll_runs_tenant_period', ['tenantId', 'period'], {
  unique: true,
  where: '"status" <> \'VOIDED\'',
})
export class PayrollRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** PR-YYYY-NNNN, from the `payroll_run_number` sequence. */
  @Column({ name: 'run_number', type: 'varchar', length: 40 })
  runNumber: string;

  /** 'YYYY-MM'. */
  @Column({ type: 'char', length: 7 })
  period: string;

  @Column({ name: 'pay_date', type: 'date' })
  payDate: string;

  /** CHECK lives in the migration. */
  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: PayrollRunStatus;

  @Column(money('total_salary_cost'))
  totalSalaryCost: number;

  @Column(money('total_overtime'))
  totalOvertime: number;

  @Column(money('total_bonus'))
  totalBonus: number;

  @Column(money('total_unpaid_leave'))
  totalUnpaidLeave: number;

  @Column(money('total_advance_recovery'))
  totalAdvanceRecovery: number;

  @Column(money('total_other_deductions'))
  totalOtherDeductions: number;

  @Column(money('total_net'))
  totalNet: number;

  @Column(money('total_gratuity_accrual'))
  totalGratuityAccrual: number;

  @Column({ name: 'bank_paid_at', type: 'timestamptz', nullable: true })
  bankPaidAt: Date | null;

  @Column({ name: 'cash_paid_at', type: 'timestamptz', nullable: true })
  cashPaidAt: Date | null;

  @Column({ name: 'approved_by_id', type: 'uuid', nullable: true })
  approvedById: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'journal_entry_id', type: 'uuid', nullable: true })
  journalEntryId: string | null;

  @Column({ name: 'void_journal_entry_id', type: 'uuid', nullable: true })
  voidJournalEntryId: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => PayrollRunLine, (line) => line.run, {
    cascade: ['insert'],
    eager: false,
  })
  lines: PayrollRunLine[];
}

/**
 * One employee in a run. The employee and package are snapshotted so a payslip
 * reprinted next year says what it said on the day.
 */
@Entity('payroll_run_lines')
@Index('uq_payroll_run_lines_run_employee', ['runId', 'employeeId'], {
  unique: true,
})
export class PayrollRunLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @ManyToOne(() => PayrollRun, (run) => run.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run: PayrollRun;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  // ─── snapshot ────────────────────────────────────────────────────────────
  @Column({ name: 'employee_name', type: 'varchar', length: 255 })
  employeeName: string;

  @Column({ name: 'employee_number', type: 'varchar', length: 40 })
  employeeNumber: string;

  @Column({ name: 'payment_method', type: 'varchar', length: 10 })
  paymentMethod: PaymentMethod;

  @Column({ name: 'is_national', type: 'boolean', default: false })
  isNational: boolean;

  @Column({ name: 'package_id', type: 'uuid', nullable: true })
  packageId: string | null;

  @Column(money('basic'))
  basic: number;

  @Column(money('housing'))
  housing: number;

  @Column(money('transport'))
  transport: number;

  @Column({ name: 'other_allowances', type: 'jsonb', default: [] })
  otherAllowances: OtherAllowance[];

  @Column(money('gross'))
  gross: number;

  // ─── proration ───────────────────────────────────────────────────────────
  @Column({ name: 'days_employed', type: 'int' })
  daysEmployed: number;

  @Column({ name: 'days_in_month', type: 'int' })
  daysInMonth: number;

  @Column(money('prorated_gross'))
  proratedGross: number;

  // ─── extras ──────────────────────────────────────────────────────────────
  @Column({
    name: 'overtime_hours',
    type: 'numeric',
    precision: 7,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  overtimeHours: number;

  @Column({
    name: 'overtime_hours_premium',
    type: 'numeric',
    precision: 7,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  overtimeHoursPremium: number;

  @Column(money('overtime_amount'))
  overtimeAmount: number;

  @Column(money('bonus_amount'))
  bonusAmount: number;

  @Column({ name: 'bonus_label', type: 'varchar', length: 120, nullable: true })
  bonusLabel: string | null;

  @Column({
    name: 'unpaid_leave_days',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  unpaidLeaveDays: number;

  @Column(money('unpaid_leave_amount'))
  unpaidLeaveAmount: number;

  @Column(money('advance_recovery'))
  advanceRecovery: number;

  @Column(money('other_deduction_amount'))
  otherDeductionAmount: number;

  @Column({
    name: 'other_deduction_label',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  otherDeductionLabel: string | null;

  // ─── results ─────────────────────────────────────────────────────────────
  @Column(money('salary_cost'))
  salaryCost: number;

  @Column(money('net_pay'))
  netPay: number;

  /** Null until approval computes the gratuity true-up. */
  @Column({
    name: 'gratuity_before',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  gratuityBefore: number | null;

  @Column({
    name: 'gratuity_accrual',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  gratuityAccrual: number | null;

  @Column({
    name: 'gratuity_after',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: nullableNumericTransformer,
  })
  gratuityAfter: number | null;

  /** e.g. NATIONAL_PENSION_NOT_HANDLED. */
  @Column({ type: 'text', array: true, default: '{}' })
  flags: string[];

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;
}
