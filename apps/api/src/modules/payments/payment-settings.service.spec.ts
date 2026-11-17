import { BadRequestException } from '@nestjs/common';
import { ChannelCryptoService } from '../channels/services/channel-crypto.service';
import { PaymentSettingsService } from './payment-settings.service';
import type { PaymentSettings } from './entities/payments.entity';

const tenantId = 'org-1';
const accountId = '11111111-1111-4111-8111-111111111111';

function setup({ fakeCheckout = true, account = true } = {}) {
  let row: PaymentSettings | null = null;
  const repo = {
    findOne: jest.fn(() => Promise.resolve(row)),
    create: jest.fn(
      (v: Partial<PaymentSettings>) => ({ ...v }) as PaymentSettings,
    ),
    save: jest.fn((v: PaymentSettings) => {
      row = { ...v };
      return Promise.resolve(row);
    }),
  };
  const accounts = {
    findOne: jest.fn(() => Promise.resolve(account ? { id: accountId } : null)),
  };
  const crypto = new ChannelCryptoService(
    'test-secret-test-secret-test-secret',
  );
  const config = {
    get: jest.fn((key: string) =>
      key === 'payments' ? { fakeCheckout } : 'https://api.test',
    ),
  };
  const service = new PaymentSettingsService(
    repo as never,
    accounts as never,
    crypto,
    config as never,
  );
  return { service, saved: () => row, crypto };
}

const payload = {
  provider: 'STRIPE' as const,
  secretKey: 'sk_test_51abcdEFGH',
  webhookSecret: 'whsec_test_abc',
  financeAccountId: accountId,
  defaultDepositPercent: 30,
  payDeposits: true,
  payInvoices: true,
};

describe('PaymentSettingsService', () => {
  it('stores keys encrypted and never returns them', async () => {
    const { service, saved, crypto } = setup();
    const dto = await service.update(tenantId, payload);

    const stored = saved()!;
    expect(stored.encryptedCredentials).not.toContain('sk_test_51abcdEFGH');
    expect(crypto.decrypt(stored.encryptedCredentials!)).toEqual({
      secretKey: 'sk_test_51abcdEFGH',
      webhookSecret: 'whsec_test_abc',
    });
    expect(JSON.stringify(dto)).not.toContain('sk_test_51abcdEFGH');
    expect(JSON.stringify(dto)).not.toContain('whsec_test_abc');
    expect(dto).toEqual(
      expect.objectContaining({
        provider: 'STRIPE',
        secretKeySet: true,
        secretKeyHint: 'EFGH',
        webhookSecretSet: true,
        ready: true,
        defaultDepositPercent: 30,
      }),
    );
    expect(dto.webhookUrl).toMatch(
      /^https:\/\/api\.test\/public\/payments\/webhooks\/stripe\/[A-Za-z0-9_-]{32}$/,
    );
  });

  it('keeps saved keys when a later save leaves them blank', async () => {
    const { service, crypto, saved } = setup();
    await service.update(tenantId, payload);
    await service.update(tenantId, {
      ...payload,
      secretKey: undefined,
      webhookSecret: undefined,
      defaultDepositPercent: 50,
    });
    expect(crypto.decrypt(saved()!.encryptedCredentials!)).toEqual({
      secretKey: 'sk_test_51abcdEFGH',
      webhookSecret: 'whsec_test_abc',
    });
    expect(saved()!.defaultDepositPercent).toBe(50);
  });

  it('is not ready without a webhook secret or an account', async () => {
    const { service } = setup();
    expect(
      (await service.update(tenantId, { ...payload, webhookSecret: undefined }))
        .ready,
    ).toBe(false);
    const { service: other } = setup();
    expect(
      (await other.update(tenantId, { ...payload, financeAccountId: null }))
        .ready,
    ).toBe(false);
  });

  it('forgets the keys on request', async () => {
    const { service } = setup();
    await service.update(tenantId, payload);
    const dto = await service.clearKeys(tenantId);
    expect(dto).toEqual(
      expect.objectContaining({
        secretKeySet: false,
        webhookSecretSet: false,
        ready: false,
      }),
    );
  });

  it('refuses the test checkout where it is switched off', async () => {
    const { service } = setup({ fakeCheckout: false });
    await expect(
      service.update(tenantId, { ...payload, provider: 'FAKE' }),
    ).rejects.toThrow(BadRequestException);
  });

  it("refuses another tenant's account", async () => {
    const { service } = setup({ account: false });
    await expect(service.update(tenantId, payload)).rejects.toThrow(
      BadRequestException,
    );
  });
});
