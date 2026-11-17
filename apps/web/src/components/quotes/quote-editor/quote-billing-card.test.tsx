import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BillingStage, QuoteTotals } from '@saas/shared';
import { QuoteBillingCard } from './quote-billing-card';

const totals = { subtotalAmount: 2000, discountAmount: 0, taxAmount: 100, totalAmount: 2100 } as QuoteTotals;

describe('QuoteBillingCard deposits', () => {
  it('starts a deposit at the default from payment settings', () => {
    const onChange = vi.fn();
    render(
      <QuoteBillingCard schedule={null} onChange={onChange} totals={totals} currency="AED" defaultDepositPercent={40} />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'deposit' } });
    const stages: BillingStage[] = onChange.mock.calls[0][0];
    expect(stages.map((s) => [s.kind, s.percent, s.trigger])).toEqual([
      ['DEPOSIT', 40, 'ON_APPROVAL'],
      ['FINAL', 60, 'MANUAL'],
    ]);
  });

  it('switches a deposit to a fixed amount', () => {
    const onChange = vi.fn();
    const schedule: BillingStage[] = [
      { kind: 'DEPOSIT', label: '30% deposit', percent: 30, trigger: 'ON_APPROVAL' },
      { kind: 'FINAL', label: 'Balance on completion', percent: 70, trigger: 'MANUAL' },
    ];
    render(<QuoteBillingCard schedule={schedule} onChange={onChange} totals={totals} currency="AED" />);

    fireEvent.change(screen.getByLabelText('Deposit as'), { target: { value: 'amount' } });
    const [deposit] = onChange.mock.calls[0][0] as BillingStage[];
    expect(deposit.amount).toBe(630);
  });

  it('shows a fixed deposit as an amount', () => {
    const schedule: BillingStage[] = [
      { kind: 'DEPOSIT', label: 'Deposit', percent: 23.81, amount: 500, trigger: 'ON_APPROVAL' },
      { kind: 'FINAL', label: 'Balance on completion', percent: 76.19, trigger: 'MANUAL' },
    ];
    render(<QuoteBillingCard schedule={schedule} onChange={vi.fn()} totals={totals} currency="AED" />);
    expect((screen.getByLabelText('Deposit') as HTMLInputElement).value).toBe('500');
    expect(screen.getByLabelText('Deposit as')).toHaveValue('amount');
  });
});
