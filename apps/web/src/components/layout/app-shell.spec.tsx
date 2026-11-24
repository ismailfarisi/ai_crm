import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PERMISSIONS } from '@saas/shared';
import { AppShell } from './app-shell';

const state = {
  pathname: '/automations',
  perms: new Set<string>(),
  count: 0,
};

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push }),
}));
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
      check: (rule: { permission?: string; anyOf?: string[] }) =>
        (!rule.permission || state.perms.has(rule.permission)) &&
        (!rule.anyOf || rule.anyOf.some((p) => state.perms.has(p))),
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
  });

  it('marks only Automations active on /automations/abc', () => {
    state.pathname = '/automations/abc';
    renderShell();
    expect(current()).toEqual(['/automations']);
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

  it('groups the menu by job, in order, and shows a group only when something in it is allowed', () => {
    state.perms = new Set([
      PERMISSIONS.QUOTE_READ,
      PERMISSIONS.CUSTOMER_READ,
      PERMISSIONS.SALES_ORDER_READ,
      PERMISSIONS.INVOICE_READ,
      PERMISSIONS.CHANNEL_READ,
    ]);
    renderShell();
    const headings = screen
      .getAllByRole('button', { expanded: true })
      .map((b) => b.textContent);
    expect(headings).toEqual(['Sell', 'Make', 'Money', 'Messages']);
    expect(screen.queryByRole('link', { name: /Purchase orders/ })).toBeNull();
  });

  it('collapses a group and keeps Settings closed until you are on a settings page', () => {
    state.perms = new Set([PERMISSIONS.QUOTE_READ, PERMISSIONS.ORG_READ]);
    const { unmount } = renderShell();
    expect(screen.queryByRole('link', { name: /Company/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }));
    expect(screen.queryByRole('link', { name: /Quotes/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('link', { name: /Company/ })).toBeTruthy();
    unmount();

    state.pathname = '/settings/company';
    renderShell();
    expect(current()).toEqual(['/settings/company']);
  });

  it('search finds pages by name or purpose, settings included, and Enter opens the first', () => {
    state.perms = new Set([PERMISSIONS.BILL_READ, PERMISSIONS.ORG_MANAGE_BILLING, PERMISSIONS.CHANNEL_READ]);
    renderShell();
    const box = screen.getByRole('searchbox', { name: 'Find a page' });

    fireEvent.change(box, { target: { value: 'bill' } });
    const results = within(screen.getByRole('list', { name: 'Matching pages' }));
    expect(results.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/purchasing/bills',
      '/settings/billing',
    ]);

    fireEvent.change(box, { target: { value: 'whatsapp' } });
    expect(screen.getByRole('link', { name: /Inbox/ })).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/inbox');
    expect((box as HTMLInputElement).value).toBe('');
  });

  it('search never shows a page the user may not open', () => {
    state.perms = new Set([PERMISSIONS.AUTOMATION_READ]);
    renderShell();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a page' }), { target: { value: 'approv' } });
    expect(screen.queryByRole('link', { name: /Approvals/ })).toBeNull();
    expect(screen.getByText(/No page matches/)).toBeTruthy();
  });

  it('the mobile drawer has the same grouped menu and search, and closes when you pick a page', () => {
    state.perms = new Set([PERMISSIONS.QUOTE_READ]);
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));
    expect(screen.getAllByRole('searchbox', { name: 'Find a page' })).toHaveLength(2);
    const quoteLinks = screen.getAllByRole('link', { name: /Quotes/ });
    expect(quoteLinks).toHaveLength(2);
    fireEvent.click(quoteLinks[1]);
    expect(screen.getAllByRole('searchbox', { name: 'Find a page' })).toHaveLength(1);
  });
});
