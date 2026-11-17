import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import type {
  PaymentSettingsDto,
  UpdatePaymentSettingsPayload,
} from '@saas/shared';
import type { AppConfig } from '@/config/configuration';
import { ChannelCryptoService } from '../channels/services/channel-crypto.service';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { PaymentSettings } from './entities/payments.entity';
import { paymentsReady } from './payment-readiness';
import type { TenantPaymentCredentials } from './providers/payment-provider';

/**
 * A tenant's payment account. Keys are encrypted at rest the way channel and
 * AI credentials are, and are write-only: nothing here returns them.
 */
@Injectable()
export class PaymentSettingsService {
  constructor(
    @InjectRepository(PaymentSettings)
    private readonly settings: Repository<PaymentSettings>,
    @InjectRepository(FinanceAccount)
    private readonly accounts: Repository<FinanceAccount>,
    private readonly crypto: ChannelCryptoService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  get fakeAllowed(): boolean {
    return Boolean(this.config.get('payments', { infer: true })?.fakeCheckout);
  }

  find(tenantId: string): Promise<PaymentSettings | null> {
    return this.settings.findOne({ where: { tenantId } });
  }

  /** By the key in a webhook URL. Call as system: the tenant is not known yet. */
  findByWebhookKey(webhookKey: string): Promise<PaymentSettings | null> {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(webhookKey ?? '')) return Promise.resolve(null);
    return this.settings.findOne({ where: { webhookKey } });
  }

  credentials(settings: PaymentSettings | null): TenantPaymentCredentials {
    if (!settings?.encryptedCredentials) return {};
    return this.crypto.decrypt(settings.encryptedCredentials) as TenantPaymentCredentials;
  }

  isReady(settings: PaymentSettings | null): boolean {
    return paymentsReady(settings, settings ? this.credentials(settings) : null, this.fakeAllowed);
  }

  async get(tenantId: string): Promise<PaymentSettingsDto> {
    return this.toDto(await this.find(tenantId));
  }

  async update(
    tenantId: string,
    payload: UpdatePaymentSettingsPayload,
  ): Promise<PaymentSettingsDto> {
    if (payload.provider === 'FAKE' && !this.fakeAllowed) {
      throw new BadRequestException('The test checkout is not available here');
    }
    if (payload.financeAccountId) {
      const account = await this.accounts.findOne({
        where: { id: payload.financeAccountId, tenantId },
      });
      if (!account) {
        throw new BadRequestException('Choose one of your bank or clearing accounts');
      }
    }

    const existing =
      (await this.find(tenantId)) ??
      this.settings.create({
        tenantId,
        webhookKey: randomBytes(24).toString('base64url'),
        encryptedCredentials: null,
        secretKeyHint: null,
      });

    const credentials = { ...this.credentials(existing) };
    if (payload.secretKey) credentials.secretKey = payload.secretKey;
    if (payload.webhookSecret) credentials.webhookSecret = payload.webhookSecret;

    existing.provider = payload.provider;
    existing.encryptedCredentials = Object.keys(credentials).length
      ? this.crypto.encrypt(credentials)
      : null;
    existing.secretKeyHint = credentials.secretKey ? credentials.secretKey.slice(-4) : null;
    existing.financeAccountId = payload.financeAccountId;
    existing.defaultDepositPercent = payload.defaultDepositPercent;
    existing.payDeposits = payload.payDeposits;
    existing.payInvoices = payload.payInvoices;

    return this.toDto(await this.settings.save(existing));
  }

  /** Forgets the saved keys, e.g. after rotating them at the provider. */
  async clearKeys(tenantId: string): Promise<PaymentSettingsDto> {
    const existing = await this.find(tenantId);
    if (existing) {
      existing.encryptedCredentials = null;
      existing.secretKeyHint = null;
      await this.settings.save(existing);
    }
    return this.toDto(existing);
  }

  toDto(settings: PaymentSettings | null): PaymentSettingsDto {
    const credentials = this.credentials(settings);
    const api = this.config.get('publicApiUrl', { infer: true });
    return {
      provider: settings?.provider ?? 'NONE',
      secretKeySet: Boolean(credentials.secretKey),
      secretKeyHint: settings?.secretKeyHint ?? null,
      webhookSecretSet: Boolean(credentials.webhookSecret),
      webhookUrl:
        settings && settings.provider === 'STRIPE'
          ? `${api}/public/payments/webhooks/stripe/${settings.webhookKey}`
          : null,
      financeAccountId: settings?.financeAccountId ?? null,
      defaultDepositPercent: Number(settings?.defaultDepositPercent ?? 0),
      payDeposits: settings?.payDeposits ?? false,
      payInvoices: settings?.payInvoices ?? false,
      ready: this.isReady(settings),
      fakeAllowed: this.fakeAllowed,
    };
  }
}
