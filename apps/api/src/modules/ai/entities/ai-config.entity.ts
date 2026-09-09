import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export enum AiProviderType {
  OPENAI = 'OPENAI',
  ANTHROPIC = 'ANTHROPIC',
  OPENROUTER = 'OPENROUTER',
}

export enum AiConfigStatus {
  UNCONFIGURED = 'unconfigured',
  CONFIGURED = 'configured',
  ERROR = 'error',
}

@Entity('ai_configs')
@Unique(['organizationId', 'provider'])
export class AiConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  organizationId: string;

  @Column({ type: 'enum', enum: AiProviderType })
  provider: AiProviderType;

  @Column({ type: 'boolean', default: false })
  isEnabled: boolean;

  /** At most one per org — enforced in AiConfigService.setDefault, not a DB constraint. */
  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ type: 'text', nullable: true })
  encryptedCredentials: string | null;

  @Column({
    type: 'enum',
    enum: AiConfigStatus,
    default: AiConfigStatus.UNCONFIGURED,
  })
  status: AiConfigStatus;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastTestedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
