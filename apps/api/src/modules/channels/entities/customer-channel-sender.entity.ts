import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A sender on a channel (a WhatsApp number, an email address, a chat id) that
 * a member of staff has confirmed belongs to a customer.
 *
 * It is what lets a customer agent answer "where is my order" for someone
 * whose number is not the one on the customer's record. Only staff create a
 * row; nothing a sender writes can.
 */
@Entity('customer_channel_senders')
@Index(
  'uq_customer_channel_senders_identifier',
  ['organizationId', 'provider', 'identifier'],
  { unique: true },
)
@Index('idx_customer_channel_senders_customer', ['customerId'])
export class CustomerChannelSender {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  organizationId: string;

  @Column({ type: 'uuid' })
  customerId: string;

  @Column({ type: 'varchar', length: 30 })
  provider: string;

  /** In the canonical form `canonicalSender` gives, so lookups are exact. */
  @Column({ type: 'varchar', length: 255 })
  identifier: string;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
