import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { NotificationType } from '@saas/shared';

@Entity('notifications')
@Index('idx_notifications_user_unread', ['userId', 'readAt', 'createdAt'])
@Index('uq_notifications_unread_entity', ['userId', 'type', 'entityId'], {
  unique: true,
  where: '"read_at" IS NULL AND "entity_id" IS NOT NULL',
})
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 40 })
  type: NotificationType;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  link: string | null;

  @Column({ name: 'entity_type', type: 'varchar', length: 40, nullable: true })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;
}
