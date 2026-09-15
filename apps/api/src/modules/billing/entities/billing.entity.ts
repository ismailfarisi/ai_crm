import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { BillingInterval, SubscriptionStatus } from '@saas/shared';
import { BaseEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

@Entity('plans')
@Index('uq_plans_code', ['code'], { unique: true })
export class Plan extends BaseEntity {
  @Column({ type: 'varchar', length: 40 })
  code: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({
    name: 'price_per_seat',
    type: 'numeric',
    precision: 12,
    scale: 2,
    transformer: numericTransformer,
  })
  pricePerSeat: number;

  @Column({ type: 'varchar', length: 10, default: 'MONTH' })
  interval: BillingInterval;

  @Column({ name: 'trial_days', type: 'int', default: 14 })
  trialDays: number;

  @Column({ type: 'jsonb', default: [] })
  features: string[];

  /** Overridden by STRIPE_PRICE_IDS when set, so price ids stay out of the database per environment. */
  @Column({
    name: 'provider_price_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  providerPriceId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
}

@Entity('subscriptions')
@Index('uq_subscriptions_tenant', ['tenantId'], { unique: true })
@Index('uq_subscriptions_provider_subscription', ['providerSubscriptionId'], {
  unique: true,
  where: '"provider_subscription_id" IS NOT NULL',
})
export class Subscription extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'plan_id', type: 'uuid', nullable: true })
  planId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'TRIALING' })
  status: SubscriptionStatus;

  @Column({ type: 'int', default: 1 })
  seats: number;

  @Column({ name: 'trial_ends_at', type: 'timestamptz', nullable: true })
  trialEndsAt: Date | null;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ name: 'past_due_since', type: 'timestamptz', nullable: true })
  pastDueSince: Date | null;

  @Column({ name: 'failed_payment_count', type: 'int', default: 0 })
  failedPaymentCount: number;

  @Column({ type: 'varchar', length: 20, default: 'fake' })
  provider: 'fake' | 'stripe';

  @Column({
    name: 'provider_customer_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  providerCustomerId: string | null;

  @Column({
    name: 'provider_subscription_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  providerSubscriptionId: string | null;

  @Column({
    name: 'pending_checkout_id',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  pendingCheckoutId: string | null;

  @Column({ name: 'seats_synced_at', type: 'timestamptz', nullable: true })
  seatsSyncedAt: Date | null;
}

@Entity('subscription_items')
@Index('idx_subscription_items_subscription', ['subscriptionId'])
export class SubscriptionItem extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({
    name: 'provider_item_id',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  providerItemId: string | null;
}

@Entity('billing_events')
@Index('uq_billing_events_provider_event', ['provider', 'providerEventId'], {
  unique: true,
})
export class BillingEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'varchar', length: 20 })
  provider: string;

  @Column({ name: 'provider_event_id', type: 'varchar', length: 200 })
  providerEventId: string;

  @Column({ type: 'varchar', length: 80 })
  type: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;
}
