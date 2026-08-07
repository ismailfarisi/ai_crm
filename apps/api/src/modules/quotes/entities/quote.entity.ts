import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum QuoteCreatedBy {
  AI = 'AI',
  HUMAN = 'HUMAN',
}

export enum QuoteStatus {
  DRAFT = 'DRAFT',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity('quotes')
@Index('idx_quotes_tenant_id', ['tenantId'])
export class Quote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({
    type: 'enum',
    enum: QuoteCreatedBy,
    enumName: 'quotes_created_by_enum',
    default: QuoteCreatedBy.HUMAN,
  })
  createdBy: QuoteCreatedBy;

  @Column({
    type: 'enum',
    enum: QuoteStatus,
    enumName: 'quotes_status_enum',
    default: QuoteStatus.DRAFT,
  })
  status: QuoteStatus;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'text', nullable: true })
  prompt: string | null;

  @Column({ type: 'jsonb', default: [] })
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ name: 'workflow_id', type: 'varchar', nullable: true })
  workflowId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
