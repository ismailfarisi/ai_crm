import { Column, Entity, Index } from 'typeorm';
import type { QuoteProofStatus } from '@saas/shared';
import { TenantBaseEntity } from '@/common/entities/base.entity';

/**
 * One version of the artwork the customer is asked to sign off.
 *
 * The file itself is an ordinary quote attachment; this row is what makes it
 * a proof: its version number, the customer's verdict, and whether a newer
 * version has replaced it. Only files with a row here are ever shown on the
 * public link.
 */
@Entity('quote_proofs')
@Index('uq_quote_proofs_version', ['quoteId', 'version'], { unique: true })
export class QuoteProof extends TenantBaseEntity {
  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId: string;

  @Column({ name: 'attachment_id', type: 'uuid' })
  attachmentId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 30, default: 'PENDING' })
  status: QuoteProofStatus;

  /** What staff want the customer to look at in this version. */
  @Column({ name: 'staff_note', type: 'text', nullable: true })
  staffNote: string | null;

  @Column({ name: 'uploaded_by_id', type: 'uuid', nullable: true })
  uploadedById: string | null;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  /** Typed by the customer; not an account, so never trusted as identity. */
  @Column({ name: 'responded_by_name', type: 'varchar', length: 255, nullable: true })
  respondedByName: string | null;

  @Column({ name: 'response_comment', type: 'text', nullable: true })
  responseComment: string | null;

  @Column({ name: 'responded_ip', type: 'varchar', length: 64, nullable: true })
  respondedIp: string | null;

  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt: Date | null;
}
