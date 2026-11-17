import { Column, Entity, Index } from 'typeorm';
import type {
  OnlineCheckoutStatus,
  OnlinePaymentPurpose,
  PaymentProviderName,
} from '@saas/shared';
import { TenantBaseEntity } from '@/common/entities/base.entity';
import { numericTransformer } from '../../finance/entities/finance-account.entity';

/**
 * A tenant's own payment account: the provider its customers pay through.
 * One row per tenant. Not Kerf's subscription billing.
 */
@Entity('payment_settings')
@Index('uq_payment_settings_tenant', ['tenantId'], { unique: true })
@Index('uq_payment_settings_webhook_key', ['webhookKey'], { unique: true })
export class PaymentSettings extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 20, default: 'NONE' })
  provider: PaymentProviderName;

  /** AES-256-GCM, by ChannelCryptoService. Never leaves the API. */
  @Column({ name: 'encrypted_credentials', type: 'text', nullable: true })
  encryptedCredentials: string | null;

  @Column({
    name: 'secret_key_hint',
    type: 'varchar',
    length: 8,
    nullable: true,
  })
  secretKeyHint: string | null;

  /**
   * Random, in the webhook URL, so an event can be matched to its tenant
   * before its signature is checked with that tenant's secret.
   */
  @Column({ name: 'webhook_key', type: 'varchar', length: 64 })
  webhookKey: string;

  @Column({ name: 'finance_account_id', type: 'uuid', nullable: true })
  financeAccountId: string | null;

  @Column({
    name: 'default_deposit_percent',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
    transformer: numericTransformer,
  })
  defaultDepositPercent: number;

  @Column({ name: 'pay_deposits', type: 'boolean', default: false })
  payDeposits: boolean;

  @Column({ name: 'pay_invoices', type: 'boolean', default: false })
  payInvoices: boolean;
}

/** One hosted checkout a customer was sent to. A payment is recorded only when it is PAID. */
@Entity('payment_checkouts')
@Index('uq_payment_checkouts_session', ['provider', 'providerSessionId'], {
  unique: true,
})
@Index('idx_payment_checkouts_invoice', ['tenantId', 'invoiceId'])
export class PaymentCheckout extends TenantBaseEntity {
  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ type: 'varchar', length: 20 })
  purpose: OnlinePaymentPurpose;

  @Column({ type: 'varchar', length: 20 })
  provider: PaymentProviderName;

  @Column({ name: 'provider_session_id', type: 'varchar', length: 255 })
  providerSessionId: string;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
    transformer: numericTransformer,
  })
  amount: number;

  @Column({ type: 'varchar', length: 10 })
  currency: string;

  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: OnlineCheckoutStatus;

  @Column({ name: 'invoice_payment_id', type: 'uuid', nullable: true })
  invoicePaymentId: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}

/** Every provider event handled, so a redelivered event is a no-op. */
@Entity('payment_webhook_events')
@Index('uq_payment_webhook_events_event', ['tenantId', 'provider', 'eventId'], {
  unique: true,
})
export class PaymentWebhookEvent extends TenantBaseEntity {
  @Column({ type: 'varchar', length: 20 })
  provider: PaymentProviderName;

  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId: string;

  @Column({ type: 'varchar', length: 100 })
  type: string;
}

/**
 * The customer's pay link for an invoice. Only the SHA-256 of the token is
 * kept; one live link per invoice, replaced each time a new one is issued.
 */
@Entity('invoice_pay_links')
@Index('uq_invoice_pay_links_invoice', ['invoiceId'], { unique: true })
@Index('uq_invoice_pay_links_token', ['tokenHash'], { unique: true })
export class InvoicePayLink extends TenantBaseEntity {
  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;
}
