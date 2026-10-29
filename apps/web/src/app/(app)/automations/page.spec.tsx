import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AutomationsListPage from './page';

const state = { approve: true };
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({
    session: { user: { email: 'a@b.co' } },
    can: () => state.approve,
  }),
}));
vi.mock('@/hooks/use-automations', () => ({
  useAutomations: () => ({ data: [], isLoading: false }),
  useAutomationSettings: () => ({ data: { aiEmailToCustomers: false } }),
  useCreateAutomationWorkflow: () => ({ mutateAsync: vi.fn() }),
  useDeleteAutomationWorkflow: () => ({ mutateAsync: vi.fn() }),
}));

describe('AutomationsListPage approvals link', () => {
  it('shows the Approvals link with automation:approve', () => {
    state.approve = true;
    render(<AutomationsListPage />);
    expect(screen.getByTestId('approvals-link').getAttribute('href')).toBe('/automations/approvals');
  });

  it('hides it without automation:approve', () => {
    state.approve = false;
    render(<AutomationsListPage />);
    expect(screen.queryByTestId('approvals-link')).toBeNull();
  });
});
