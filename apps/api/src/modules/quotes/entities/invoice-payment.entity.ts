import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

@Entity('invoice_payments')
@Index('idx_invoice_payments_tenant_id', ['tenantId'])
@Index('idx_invoice_payments_invoice_id', ['invoiceId'])
export class InvoicePayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ name: 'paid_at', type: 'timestamptz' })
  paidAt: Date;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @Column({ name: 'recorded_by_id', type: 'uuid', nullable: true })
  recordedById: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /**
   * Base currency per unit of this document's currency, as it was posted.
   * Stays as it was: a report rerun next year must say what it said today.
   */
  @Column({
    name: 'fx_rate',
    type: 'numeric',
    precision: 18,
    scale: 8,
    default: 1,
    transformer: numericTransformer,
  })
  fxRate: number;
}
