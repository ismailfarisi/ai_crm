'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { FinanceAccountDto, PaymentProviderName, PaymentSettingsDto } from '@saas/shared';
import { useFinanceAccounts } from '@/hooks/use-finance';
import {
  useClearPaymentKeys,
  usePaymentSettings,
  useSavePaymentSettings,
} from '@/hooks/use-online-payments';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Alert, Badge, PageHeader, Skeleton } from '@/components/ui/primitives';

/** A card per DESIGN.md: solid surface, 1rem corners, hairline, Whisper. */
const CARD = 'rounded-2xl border border-border/60 bg-surface p-5 shadow-[0_2px_10px_rgba(0,0,0,0.015)]';

interface FormState {
  provider: PaymentProviderName;
  secretKey: string;
  webhookSecret: string;
  financeAccountId: string;
  defaultDepositPercent: string;
  payDeposits: boolean;
  payInvoices: boolean;
}

const fromDto = (dto: PaymentSettingsDto): FormState => ({
  provider: dto.provider,
  secretKey: '',
  webhookSecret: '',
  financeAccountId: dto.financeAccountId ?? '',
  defaultDepositPercent: String(dto.defaultDepositPercent),
  payDeposits: dto.payDeposits,
  payInvoices: dto.payInvoices,
});

/**
 * Where a tenant connects its own payment account, so customers can pay
 * deposits and invoices online. Kerf's own subscription is under Billing.
 */
export function PaymentsSettingsView() {
  const { data: settings, isPending, isError } = usePaymentSettings();
  const { data: accounts = [] } = useFinanceAccounts();

  if (isError) return <Alert>Payment settings could not be loaded.</Alert>;
  if (isPending || !settings) return <Skeleton className="h-96 w-full" />;
  // Remounts after each save, so the key fields clear and the form shows what was stored.
  return <PaymentsSettingsForm key={JSON.stringify(settings)} settings={settings} accounts={accounts} />;
}

function PaymentsSettingsForm({
  settings,
  accounts,
}: {
  settings: PaymentSettingsDto;
  accounts: FinanceAccountDto[];
}) {
  const save = useSavePaymentSettings();
  const clearKeys = useClearPaymentKeys();
  const [form, setForm] = useState<FormState>(() => fromDto(settings));

  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  const providers = [
    { value: 'NONE', label: 'Off' },
    { value: 'STRIPE', label: 'Stripe' },
    ...(settings.fakeAllowed || settings.provider === 'FAKE'
      ? [{ value: 'FAKE', label: 'Test checkout (no money moves)' }]
      : []),
  ];

  const submit = () =>
    save.mutate(
      {
        provider: form.provider,
        secretKey: form.secretKey.trim() || undefined,
        webhookSecret: form.webhookSecret.trim() || undefined,
        financeAccountId: form.financeAccountId || null,
        defaultDepositPercent: Number(form.defaultDepositPercent) || 0,
        payDeposits: form.payDeposits,
        payInvoices: form.payInvoices,
      },
      {
        onSuccess: () => toast.success('Payment settings saved'),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not save'),
      },
    );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Online payments"
        description="Let customers pay deposits and invoices by card. Money goes to your own payment account."
        actions={
          <Badge tone={settings.ready ? 'success' : 'neutral'}>
            {settings.ready ? 'Taking payments' : 'Not taking payments'}
          </Badge>
        }
      />

      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <section className={CARD} aria-labelledby="provider-heading">
          <h2 id="provider-heading" className="mb-4 text-sm font-semibold text-ink">
            Payment account
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Provider"
              value={form.provider}
              onChange={(e) => set({ provider: e.target.value as PaymentProviderName })}
              options={providers}
            />
            <Select
              label="Record payments into"
              value={form.financeAccountId}
              onChange={(e) => set({ financeAccountId: e.target.value })}
              placeholder="Choose an account"
              options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))}
              hint="Usually a clearing account for card payouts. Reconcile it like any bank account."
            />
          </div>

          {form.provider === 'STRIPE' && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Input
                label="Secret key"
                type="password"
                autoComplete="off"
                value={form.secretKey}
                onChange={(e) => set({ secretKey: e.target.value })}
                placeholder={settings.secretKeySet ? `Saved, ends in ${settings.secretKeyHint ?? '····'}` : 'sk_live_…'}
                hint="Leave blank to keep the saved key."
              />
              <Input
                label="Webhook signing secret"
                type="password"
                autoComplete="off"
                value={form.webhookSecret}
                onChange={(e) => set({ webhookSecret: e.target.value })}
                placeholder={settings.webhookSecretSet ? 'Saved' : 'whsec_…'}
                hint="Leave blank to keep the saved secret."
              />
              {settings.webhookUrl && (
                <div className="sm:col-span-2">
                  <p className="mb-1 text-sm font-medium text-ink">Webhook address</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-xl bg-surface-muted px-3 py-2 text-xs text-ink-muted">
                      {settings.webhookUrl}
                    </code>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(settings.webhookUrl ?? '')
                          .then(() => toast.success('Copied'))
                      }
                    >
                      <Copy className="size-4" />
                      Copy
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    In Stripe, add this address for the checkout.session events, then paste its signing secret above.
                  </p>
                </div>
              )}
              {(settings.secretKeySet || settings.webhookSecretSet) && (
                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    loading={clearKeys.isPending}
                    onClick={() => clearKeys.mutate(undefined, { onSuccess: () => toast.success('Keys removed') })}
                  >
                    Remove saved keys
                  </Button>
                </div>
              )}
            </div>
          )}

          {form.provider === 'FAKE' && (
            <p className="mt-4 text-sm text-warning">
              Test checkout shows a Pay button that records a payment without charging a card. Use it to try the flow.
            </p>
          )}
        </section>

        <section className={CARD} aria-labelledby="documents-heading">
          <h2 id="documents-heading" className="mb-4 text-sm font-semibold text-ink">
            Deposits and Pay buttons
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Default deposit"
              type="number"
              inputMode="decimal"
              min={0}
              max={99}
              step="any"
              value={form.defaultDepositPercent}
              onChange={(e) => set({ defaultDepositPercent: e.target.value })}
              hint="Percent of the quote total. New quotes start with this deposit; 0 means none."
            />
          </div>
          <fieldset className="mt-4 space-y-3">
            <legend className="mb-2 text-sm font-medium text-ink">Show a Pay button on</legend>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.payDeposits}
                onChange={(e) => set({ payDeposits: e.target.checked })}
              />
              <span>
                Accepted quotes, for the deposit
                <span className="block text-xs text-ink-subtle">
                  The customer accepts, then pays the deposit invoice raised for it.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.payInvoices}
                onChange={(e) => set({ payInvoices: e.target.checked })}
              />
              <span>
                Invoices
                <span className="block text-xs text-ink-subtle">
                  Invoice emails include a pay link for the balance due.
                </span>
              </span>
            </label>
          </fieldset>
        </section>

        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
