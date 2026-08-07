import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum InvoiceStatus {
  ISSUED = 'ISSUED',
  PAID = 'PAID',
}

@Entity('invoices')
@Index('idx_invoices_tenant_id', ['tenantId'])
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'invoice_number', type: 'varchar' })
  invoiceNumber: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    enumName: 'invoices_status_enum',
    default: InvoiceStatus.ISSUED,
  })
  status: InvoiceStatus;

  @CreateDateColumn({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;
}
