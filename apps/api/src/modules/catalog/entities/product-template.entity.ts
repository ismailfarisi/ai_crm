import { Column, Entity, Index } from 'typeorm';
import type {
  DerivedVariable,
  TemplateMaterial,
  TemplateOperation,
  TemplateParameter,
  TemplatePricing,
  TemplateTooling,
} from '@saas/shared';
import { BaseEntity } from '@/common/entities/base.entity';

/**
 * A parametric product: parameters in, bill of materials and routing out.
 *
 * **Rows are immutable once published.** Editing a template inserts a new row
 * with `version + 1` and flips `isCurrent`; the old row stays exactly as it
 * was because quotes point at a specific version. Re-costing a six-month-old
 * quote against today's formulas would produce a different number and make
 * the document unexplainable.
 *
 * That is also why this extends `BaseEntity` rather than `SoftDeletableEntity`
 * — a version a quote references must never disappear. Retiring a template is
 * `isCurrent = false` on every version of the key.
 *
 * The model itself lives in jsonb: it is a document that is always read whole,
 * never queried field-by-field, and its shape is owned by the costing engine
 * in `@saas/shared`.
 */
@Entity('product_templates')
@Index('idx_product_templates_tenant', ['tenantId'])
@Index(
  'uq_product_templates_tenant_key_version',
  ['tenantId', 'templateKey', 'version'],
  {
    unique: true,
  },
)
export class ProductTemplate extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** Stable across versions — `rigid-box-2pc` stays that through v1, v2, v3. */
  @Column({ name: 'template_key', type: 'varchar', length: 60 })
  templateKey: string;

  @Column({ type: 'integer', default: 1 })
  version: number;

  /** Exactly one version per key carries this. */
  @Column({ name: 'is_current', type: 'boolean', default: true })
  isCurrent: boolean;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'jsonb', default: [] })
  parameters: TemplateParameter[];

  @Column({ type: 'jsonb', default: [] })
  derived: DerivedVariable[];

  @Column({ type: 'jsonb', default: [] })
  materials: TemplateMaterial[];

  @Column({ type: 'jsonb', default: [] })
  operations: TemplateOperation[];

  @Column({ type: 'jsonb', default: [] })
  tooling: TemplateTooling[];

  @Column({ type: 'jsonb' })
  pricing: TemplatePricing;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;
}
