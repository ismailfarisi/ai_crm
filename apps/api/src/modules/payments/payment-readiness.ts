import type { PaymentSettings } from './entities/payments.entity';

/**
 * Whether a tenant can take a payment right now: a provider, its keys, and
 * an account to record the money into. Pure, so the quote page can ask too.
 */
export function paymentsReady(
  settings: Pick<
    PaymentSettings,
    'provider' | 'encryptedCredentials' | 'financeAccountId' | 'secretKeyHint'
  > | null,
  credentials: { secretKey?: string; webhookSecret?: string } | null,
  fakeAllowed: boolean,
): boolean {
  if (!settings || !settings.financeAccountId) return false;
  if (settings.provider === 'FAKE') return fakeAllowed;
  if (settings.provider === 'STRIPE') {
    return Boolean(credentials?.secretKey && credentials?.webhookSecret);
  }
  return false;
}
