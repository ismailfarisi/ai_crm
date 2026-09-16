import { Column, Entity, Index } from 'typeorm';
import type { AttachmentOwnerType } from '@saas/shared';
import { SoftDeletableEntity } from '@/common/entities/base.entity';

/**
 * A file belonging to a document. The bytes live in the storage driver; this
 * row is the only index of them, which is why it soft-deletes — a row removed
 * outright would orphan the object it points at.
 */
@Entity('attachments')
@Index('idx_attachments_owner', ['tenantId', 'ownerType', 'ownerId'])
export class Attachment extends SoftDeletableEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'owner_type', type: 'varchar', length: 30 })
  ownerType: AttachmentOwnerType;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ name: 'content_type', type: 'varchar', length: 120 })
  contentType: string;

  @Column({
    name: 'size_bytes',
    type: 'bigint',
    transformer: {
      to: (v: number) => v,
      from: (v: string | null) => (v === null ? 0 : Number(v)),
    },
  })
  sizeBytes: number;

  /** Opaque to everything but the driver that wrote it. */
  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  checksum: string | null;

  @Column({ name: 'uploaded_by_id', type: 'uuid', nullable: true })
  uploadedById: string | null;
}
