import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PaymentSettingsDto } from '@saas/shared';
import { PaymentsSettingsView } from './payments-settings-view';

const mutate = vi.fn();
let settings: PaymentSettingsDto;

vi.mock('@/hooks/use-online-payments', () => ({
  usePaymentSettings: () => ({ data: settings, isPending: false, isError: false }),
  useSavePaymentSettings: () => ({ mutate, isPending: false }),
  useClearPaymentKeys: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/use-finance', () => ({
  useFinanceAccounts: () => ({
    data: [{ id: 'acc-1', name: 'Card clearing', currency: 'AED' }],
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const base: PaymentSettingsDto = {
  provider: 'STRIPE',
  secretKeySet: true,
  secretKeyHint: '4242',
  webhookSecretSet: true,
  webhookUrl: 'http://localhost:4000/api/public/payments/webhooks/stripe/whk_1',
  financeAccountId: 'acc-1',
  defaultDepositPercent: 30,
  payDeposits: true,
  payInvoices: true,
  ready: true,
  fakeAllowed: true,
};

describe('PaymentsSettingsView', () => {
  beforeEach(() => {
    mutate.mockReset();
    settings = { ...base };
  });

  it('never shows a saved secret, only that one is saved', () => {
    render(<PaymentsSettingsView />);
    const key = screen.getByLabelText('Secret key') as HTMLInputElement;
    expect(key.value).toBe('');
    expect(key.type).toBe('password');
    expect(key.placeholder).toBe('Saved, ends in 4242');
    expect(screen.getByText(base.webhookUrl!)).toBeInTheDocument();
    expect(screen.getByText('Taking payments')).toBeInTheDocument();
  });

  it('keeps saved keys when the key fields are left blank', () => {
    render(<PaymentsSettingsView />);
    fireEvent.change(screen.getByLabelText('Default deposit'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'STRIPE',
        secretKey: undefined,
        webhookSecret: undefined,
        defaultDepositPercent: 50,
        financeAccountId: 'acc-1',
      }),
      expect.anything(),
    );
  });

  it('sends a new key once entered', () => {
    render(<PaymentsSettingsView />);
    fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: ' sk_test_new ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate.mock.calls[0][0].secretKey).toBe('sk_test_new');
  });

  it('hides the test checkout where the server does not allow it', () => {
    settings = { ...base, provider: 'NONE', fakeAllowed: false, ready: false };
    render(<PaymentsSettingsView />);
    expect(screen.queryByRole('option', { name: /Test checkout/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Secret key')).not.toBeInTheDocument();
    expect(screen.getByText('Not taking payments')).toBeInTheDocument();
  });
});
