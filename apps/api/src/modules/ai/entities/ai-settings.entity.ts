import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Which provider and model one AI feature runs on. */
export interface AiFeatureModel {
  /** Lowercase-insensitive provider id (`AiProviderType`), or absent for the default provider. */
  provider?: string | null;
  model: string;
}

/**
 * Per-organization model choices. A provider row (`ai_configs`) holds only
 * the key; which model runs is decided here and on each agent.
 */
@Entity('ai_settings')
export class AiSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index('idx_ai_settings_organization_id', { unique: true })
  organizationId: string;

  /** Used by every agent and feature that names no model of its own. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  defaultModel: string | null;

  /** Feature key (as passed to `AiService`) to its own provider and model. */
  @Column({ type: 'jsonb', default: {} })
  featureModels: Record<string, AiFeatureModel>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
