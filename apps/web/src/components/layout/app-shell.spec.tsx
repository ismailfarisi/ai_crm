import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PERMISSIONS } from '@saas/shared';
import { AppShell } from './app-shell';

const state = {
  pathname: '/automations',
  perms: new Set<string>(),
  count: 0,
};

vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/session-context', () => {
  const can = (...p: string[]) => p.every((x) => state.perms.has(x));
  return {
    useSession: () => ({
      session: {
        organization: { name: 'Org' },
        user: { firstName: 'A', lastName: 'B', fullName: 'A B', roles: [] },
      },
      can,
      check: (rule: { permission?: string }) => !rule.permission || state.perms.has(rule.permission),
      logout: vi.fn(),
    }),
  };
});
vi.mock('@/hooks/use-custom-objects', () => ({ useCustomObjects: () => ({ data: [] }) }));
vi.mock('@/hooks/use-automations', () => ({
  useAutomationApprovalCount: (opts?: { enabled?: boolean }) => ({
    data: opts?.enabled === false ? undefined : { count: state.count },
  }),
}));
vi.mock('@/components/assistant/assistant-provider', () => ({
  AssistantProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/assistant/assistant-launcher', () => ({ AssistantLauncher: () => null }));
vi.mock('@/components/assistant/assistant-panel', () => ({ AssistantPanel: () => null }));
vi.mock('./notification-bell', () => ({ NotificationBell: () => null }));
vi.mock('./billing-banner', () => ({ BillingBanner: () => null }));

const renderShell = () =>
  render(
    <AppShell>
      <div />
    </AppShell>,
  );

const current = () =>
  screen
    .queryAllByRole('link')
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.getAttribute('href'));

describe('AppShell navigation', () => {
  beforeEach(() => {
    state.pathname = '/automations';
    state.count = 0;
    state.perms = new Set([PERMISSIONS.AUTOMATION_READ, PERMISSIONS.AUTOMATION_APPROVE]);
  });

  it('marks only Approvals active on /automations/approvals', () => {
    state.pathname = '/automations/approvals';
    renderShell();
    expect(current()).toEqual(['/automations/approvals']);
    expect(screen.getByText('Approvals', { selector: 'span.font-semibold.text-ink' })).toBeTruthy();
  });

  it('marks only Automations active on /automations/abc', () => {
    state.pathname = '/automations/abc';
    renderShell();
    expect(current()).toEqual(['/automations']);
    expect(screen.getByText('Automations', { selector: 'span.font-semibold.text-ink' })).toBeTruthy();
  });

  it('does not highlight Dashboard on /dashboard subroutes', () => {
    state.pathname = '/dashboard/reports';
    renderShell();
    expect(current()).toEqual([]);
  });

  it('hides the Approvals item without automation:approve', () => {
    state.perms = new Set([PERMISSIONS.AUTOMATION_READ]);
    renderShell();
    expect(screen.queryByRole('link', { name: /Approvals/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Automations/ })).toBeTruthy();
  });

  it('hides the badge at 0, shows 3, and caps at 99+', () => {
    const { unmount } = renderShell();
    expect(screen.queryByTestId('nav-badge-automationApprovals')).toBeNull();
    unmount();

    state.count = 3;
    const second = renderShell();
    expect(screen.getByTestId('nav-badge-automationApprovals').textContent).toBe('3');
    second.unmount();

    state.count = 150;
    renderShell();
    expect(screen.getByTestId('nav-badge-automationApprovals').textContent).toBe('99+');
  });
});
