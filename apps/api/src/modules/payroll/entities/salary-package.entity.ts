import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

export interface OtherAllowance {
  label: string;
  amount: number;
}

/**
 * What an employee is paid from `effectiveFrom`. Never edited: a raise is a
 * new row. The package for a month is the latest one effective by its last day.
 */
@Entity('salary_packages')
@Index('uq_salary_packages_employee_from', ['employeeId', 'effectiveFrom'], {
  unique: true,
})
export class SalaryPackage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'effective_from', type: 'date' })
  effectiveFrom: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  basic: number;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  housing: number;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    transformer: numericTransformer,
  })
  transport: number;

  @Column({ name: 'other_allowances', type: 'jsonb', default: [] })
  otherAllowances: OtherAllowance[];

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
