import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import type { JournalLineDto } from '@saas/shared';
import { numericTransformer } from './finance-account.entity';

@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index('idx_journal_entries_tenant_id')
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  entryNumber: string;

  @Column({
    type: 'enum',
    enum: ['EXPENSE', 'INVOICE', 'TRANSFER', 'MANUAL'],
    enumName: 'journal_entries_reference_type_enum',
    default: 'MANUAL',
  })
  referenceType: 'EXPENSE' | 'INVOICE' | 'TRANSFER' | 'MANUAL';

  @Column({ type: 'varchar', length: 255 })
  referenceId: string;

  @Column({ type: 'timestamptz' })
  entryDate: Date;

  @Column({ type: 'jsonb', default: [] })
  lines: JournalLineDto[];

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  totalAmount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
