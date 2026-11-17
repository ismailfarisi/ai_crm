import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type {
  ImportDuplicateMode,
  ImportEntity,
  ImportFailure,
} from '@saas/shared';

/**
 * One spreadsheet import: what was imported, by whom, and how it went.
 *
 * The import is audited as this one row rather than a row per record, so
 * the trail reads "Imported 1,200 customers", not 1,200 separate creates.
 * `failures` keeps the rejected rows for the error file; it is not selected
 * by default so the audit snapshot carries the counts, not the cell values.
 * Created in migration 1791200000000-ImportRuns.
 */
@Entity('import_runs')
@Index('idx_import_runs_tenant_created', ['tenantId', 'createdAt'])
export class ImportRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 40 })
  entity: ImportEntity;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'on_duplicate', type: 'varchar', length: 10 })
  onDuplicate: ImportDuplicateMode;

  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows: number;

  @Column({ type: 'int', default: 0 })
  created: number;

  @Column({ type: 'int', default: 0 })
  updated: number;

  @Column({ type: 'int', default: 0 })
  skipped: number;

  @Column({ type: 'int', default: 0 })
  failed: number;

  @Column({ type: 'jsonb', default: () => "'[]'", select: false })
  failures: ImportFailure[];

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
