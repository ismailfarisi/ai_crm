import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERMISSIONS, PERMISSION_DESCRIPTIONS, type RoleDto } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { RolesView } from './roles-view';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({
    session: { user: { id: 'me', roles: [{ level: 0 }] } },
    can: () => true,
    check: () => true,
    refresh: vi.fn(async () => undefined),
  }),
  useCan: () => true,
}));
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: { ...original.api, roles: { list: vi.fn(), update: vi.fn(), create: vi.fn(), remove: vi.fn() } },
  };
});

const role = (id: string, name: string, userCount: number, permissions: RoleDto['permissions']): RoleDto => ({
  id,
  name,
  slug: id,
  level: 30,
  isSystem: false,
  description: '',
  permissions,
  userCount,
  createdAt: '',
  updatedAt: '',
});

const estimator = role('estimator', 'Estimator', 2, [PERMISSIONS.CONTACT_READ]);
const storekeeper = role('storekeeper', 'Storekeeper', 0, []);

const renderRoles = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RolesView />
    </QueryClientProvider>,
  );
};

const tick = (permission: keyof typeof PERMISSION_DESCRIPTIONS) =>
  fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(PERMISSION_DESCRIPTIONS[permission]) }));

beforeEach(() => {
  vi.mocked(api.roles.list).mockResolvedValue([estimator, storekeeper]);
  vi.mocked(api.roles.remove).mockReset().mockResolvedValue(undefined as never);
});

// The first render pulls in the whole permission catalogue; give it room under a busy runner.
describe('RolesView', { timeout: 20_000 }, () => {
  it('counts unsaved changes in the sticky save bar', async () => {
    renderRoles();
    const bar = await screen.findByTestId('role-save-bar', {}, { timeout: 10_000 });
    expect(bar).toHaveTextContent('No unsaved changes');
    tick(PERMISSIONS.CONTACT_CREATE);
    expect(bar).toHaveTextContent('1 unsaved change to Estimator');
    expect(within(bar).getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
  });

  it('asks before switching roles throws away unsaved ticks', async () => {
    renderRoles();
    await screen.findByTestId('role-save-bar', {}, { timeout: 10_000 });
    tick(PERMISSIONS.CONTACT_CREATE);
    fireEvent.click(screen.getByRole('button', { name: /Storekeeper/ }));

    const dialog = screen.getByRole('dialog', { name: 'Discard changes to Estimator?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('role-save-bar')).toHaveTextContent('1 unsaved change to Estimator');

    fireEvent.click(screen.getByRole('button', { name: /Storekeeper/ }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Discard changes to Estimator?' })).getByRole('button', {
        name: 'Discard changes',
      }),
    );
    await waitFor(() => expect(screen.getByTestId('role-save-bar')).toHaveTextContent('No unsaved changes'));
    expect(screen.getByRole('button', { name: /Storekeeper/ })).toHaveAttribute('aria-current', 'true');
  });

  it('switches straight away when nothing is unsaved', async () => {
    renderRoles();
    await screen.findByTestId('role-save-bar', {}, { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: /Storekeeper/ }));
    expect(screen.queryByRole('dialog', { name: /Discard changes/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Storekeeper/ })).toHaveAttribute('aria-current', 'true');
  });

  it('asks before deleting a role', async () => {
    renderRoles();
    await screen.findByTestId('role-save-bar', {}, { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: /Storekeeper/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.roles.remove).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Delete the Storekeeper role?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete role' }));
    await waitFor(() => expect(api.roles.remove).toHaveBeenCalledWith('storekeeper'));
  });
});
