import { Column, Entity, Index } from 'typeorm';
import type { EmployeeStatus, PaymentMethod } from '@saas/shared';
import { SoftDeletableEntity } from '@/common/entities/base.entity';

/**
 * Someone the company pays. Not a login: `userId` optionally links one.
 *
 * Soft-deleted employees keep their run lines and gratuity history. The IBAN
 * is stored only as ciphertext; `ibanLast4` is what everyone else sees.
 */
@Entity('employees')
@Index('idx_employees_tenant', ['tenantId'])
@Index('uq_employees_tenant_number', ['tenantId', 'employeeNumber'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('uq_employees_tenant_user', ['tenantId', 'userId'], {
  unique: true,
  where: '"user_id" IS NOT NULL AND "deletedAt" IS NULL',
})
export class Employee extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** EMP-0001, from the `employee_number` sequence. */
  @Column({ name: 'employee_number', type: 'varchar', length: 40 })
  employeeNumber: string;

  @Column({ name: 'first_name', type: 'varchar', length: 120 })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 120 })
  lastName: string;

  @Column({ name: 'job_title', type: 'varchar', length: 120, nullable: true })
  jobTitle: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  department: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'joining_date', type: 'date' })
  joiningDate: string;

  @Column({ name: 'leaving_date', type: 'date', nullable: true })
  leavingDate: string | null;

  /** ON_HOLD is excluded from runs. CHECK lives in the migration. */
  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: EmployeeStatus;

  /** ISO 3166-1 alpha-2. */
  @Column({ type: 'char', length: 2, nullable: true })
  nationality: string | null;

  /** Nationals accrue no end-of-service gratuity (pension is out of scope). */
  @Column({ name: 'is_national', type: 'boolean', default: false })
  isNational: boolean;

  @Column({ name: 'payment_method', type: 'varchar', length: 10 })
  paymentMethod: PaymentMethod;

  @Column({ name: 'bank_name', type: 'varchar', length: 120, nullable: true })
  bankName: string | null;

  /** AES-256-GCM (iv + tag + data, base64). Never returned, logged or audited. */
  @Column({ name: 'iban_encrypted', type: 'text', nullable: true })
  ibanEncrypted: string | null;

  @Column({ name: 'iban_last4', type: 'varchar', length: 4, nullable: true })
  ibanLast4: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;
}
