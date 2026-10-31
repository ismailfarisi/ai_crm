import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PlanDto, SubscriptionDto } from '@saas/shared';
import { BillingView } from './billing-view';

const mutate = vi.fn();
const mutateAsync = vi.fn(async () => null);
const state: { sub: Partial<SubscriptionDto> } = { sub: {} };

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), message: vi.fn() } }));

const plan = (code: string, name: string): PlanDto => ({
  id: code,
  code,
  name,
  description: null,
  currency: 'AED',
  pricePerSeat: 99,
  interval: 'MONTH' as PlanDto['interval'],
  trialDays: 14,
  features: [],
  purchasable: true,
});

vi.mock('@/hooks/use-platform', () => ({
  useSubscription: () => ({ data: state.sub, isPending: false, isError: false, error: null }),
  usePlans: () => ({ data: [plan('starter', 'Starter'), plan('shop', 'Shop')] }),
  useBillingAction: () => ({ mutate, mutateAsync, isPending: false, variables: undefined }),
}));

const base: Partial<SubscriptionDto> = {
  plan: null,
  seats: 3,
  activeUsers: 3,
  enforced: true,
  trialEndsAt: '2026-11-13T00:00:00Z',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  pastDueSince: null,
  restrictsAt: null,
  restricted: false,
  provider: 'fake' as SubscriptionDto['provider'],
};

describe('BillingView', () => {
  it('shows a trial with the info badge and a single amber plan button', () => {
    state.sub = { ...base, status: 'TRIALING' };
    render(<BillingView />);
    expect(screen.getByText('Free trial').className).toMatch(/bg-info-soft/);
    expect(screen.getByText('Free trial').className).not.toMatch(/accent/);
    const amber = screen.getAllByRole('button').filter((b) => b.className.includes('bg-brand '));
    expect(amber).toHaveLength(1);
    expect(amber[0]).toHaveTextContent('Choose Starter');
  });

  it('asks before cancelling at period end', async () => {
    state.sub = { ...base, status: 'ACTIVE', plan: plan('shop', 'Shop'), currentPeriodEnd: '2026-11-30T00:00:00Z' };
    render(<BillingView />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel at period end' }));
    expect(mutate).not.toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Cancel Shop at the end of this period?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel at period end' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ kind: 'cancel' }));
  });
});
