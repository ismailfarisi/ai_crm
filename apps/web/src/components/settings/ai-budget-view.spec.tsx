import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AiBudgetStatusDto } from '@saas/shared';
import { AiBudgetView } from './ai-budget-view';
import { useAiBudgetStatus, useAiUsage, useUpsertAiBudget } from '@/hooks/use-ai';

vi.mock('@/hooks/use-ai', () => ({
  useAiBudgetStatus: vi.fn(),
  useAiUsage: vi.fn(),
  useUpsertAiBudget: vi.fn(),
}));

// AiBudgetView gates its edit form behind <Can>, which reads session context —
// not relevant to what this component renders given its own props/data, so
// always allow, same as PageGuard already enforcing this server-side.
vi.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseAiBudgetStatus = vi.mocked(useAiBudgetStatus);
const mockUseAiUsage = vi.mocked(useAiUsage);
const mockUseUpsertAiBudget = vi.mocked(useUpsertAiBudget);

function statusFixture(overrides: Partial<AiBudgetStatusDto> = {}): AiBudgetStatusDto {
  return {
    budget: {
      organizationId: 'org-1',
      monthlyBudgetUsd: 100,
      alertThresholdPercent: 80,
      isEnabled: true,
      automationAiEmailToCustomers: false,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    },
    periodStart: '2026-08-01T00:00:00Z',
    periodEnd: '2026-08-15T00:00:00Z',
    currentSpendUsd: 0,
    percentage: 0,
    isNearLimit: false,
    isOverBudget: false,
    automationAiEmailToCustomers: false,
    ...overrides,
  };
}

describe('AiBudgetView', () => {
  let mutateAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseAiUsage.mockReturnValue({ data: [], isPending: false } as any);
    mockUseUpsertAiBudget.mockReturnValue({ mutateAsync, isPending: false } as any);
  });

  it('renders "On Track" when spend is well under the threshold', () => {
    mockUseAiBudgetStatus.mockReturnValue({
      data: statusFixture({ currentSpendUsd: 20, percentage: 20 }),
      isPending: false,
    } as any);

    render(<AiBudgetView />);
    expect(screen.getByText(/20% spent/i)).toBeInTheDocument();
  });

  it('renders "Near cap" once spend crosses the alert threshold', () => {
    mockUseAiBudgetStatus.mockReturnValue({
      data: statusFixture({ currentSpendUsd: 85, percentage: 85, isNearLimit: true }),
      isPending: false,
    } as any);

    render(<AiBudgetView />);
    expect(screen.getByText(/near cap/i)).toBeInTheDocument();
  });

  it('renders an over-budget warning and blocked-calls message when the cap is hit', () => {
    mockUseAiBudgetStatus.mockReturnValue({
      data: statusFixture({ currentSpendUsd: 100, percentage: 100, isOverBudget: true }),
      isPending: false,
    } as any);

    render(<AiBudgetView />);
    expect(screen.getByText(/AI calls are being blocked/i)).toBeInTheDocument();
  });

  it('renders the empty state when no budget is configured', () => {
    mockUseAiBudgetStatus.mockReturnValue({
      data: statusFixture({ budget: null, percentage: null }),
      isPending: false,
    } as any);

    render(<AiBudgetView />);
    expect(screen.getByText(/no ai budget configured/i)).toBeInTheDocument();
  });

  it('saves the automation AI-email checkbox, defaulting to unchecked', () => {
    mockUseAiBudgetStatus.mockReturnValue({
      data: statusFixture(),
      isPending: false,
    } as any);

    render(<AiBudgetView />);

    const box = screen.getByLabelText('Allow automations to email AI-written text to customers');
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: /save budget/i }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ automationAiEmailToCustomers: true }),
    );
  });

  it('shows the checkbox checked when the organisation has opted in', () => {
    mockUseAiBudgetStatus.mockReturnValue({
      data: statusFixture({ automationAiEmailToCustomers: true }),
      isPending: false,
    } as any);

    render(<AiBudgetView />);
    expect(
      screen.getByLabelText('Allow automations to email AI-written text to customers'),
    ).toBeChecked();
  });

  it('submits the edit form with the entered budget and threshold', () => {
    mockUseAiBudgetStatus.mockReturnValue({
      data: statusFixture({ currentSpendUsd: 20, percentage: 20 }),
      isPending: false,
    } as any);

    render(<AiBudgetView />);

    const budgetInput = screen.getByLabelText(/monthly budget/i);
    fireEvent.change(budgetInput, { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: /save budget/i }));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ monthlyBudgetUsd: 250, alertThresholdPercent: 80, isEnabled: true }),
    );
  });
});
