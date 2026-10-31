import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PERMISSIONS, type RoleDto, type TeamDto, type UserDto } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { TeamView, permissionChange } from './team-view';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, can: () => true, check: () => true }),
}));
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      users: { list: vi.fn(), setActive: vi.fn(), assignRoles: vi.fn(), assignTeam: vi.fn() },
      roles: { list: vi.fn() },
      teams: { list: vi.fn() },
      invitations: { list: vi.fn(), cancel: vi.fn(), resend: vi.fn(), invite: vi.fn() },
    },
  };
});

const role = (id: string, name: string, level: number, permissions: RoleDto['permissions']): RoleDto => ({
  id,
  name,
  slug: id,
  level,
  isSystem: false,
  description: '',
  permissions,
  userCount: 1,
  createdAt: '',
  updatedAt: '',
});

const sales = role('sales', 'Sales', 30, [PERMISSIONS.CONTACT_READ, PERMISSIONS.CONTACT_CREATE]);
const manager = role('manager', 'Sales manager', 20, [
  PERMISSIONS.CONTACT_READ,
  PERMISSIONS.CONTACT_CREATE,
  PERMISSIONS.CONTACT_READ_ALL,
]);
const viewer = role('viewer', 'Viewer', 40, [PERMISSIONS.CONTACT_READ]);

const fatima: UserDto = {
  id: 'u-fatima',
  email: 'fatima@meridian.example',
  firstName: 'Fatima',
  lastName: 'Hassan',
  fullName: 'Fatima Hassan',
  isActive: true,
  lastLoginAt: null,
  createdAt: '',
  roles: [{ id: 'sales', name: 'Sales', slug: 'sales', level: 30, isSystem: false }] as UserDto['roles'],
  teamId: null,
  managerId: null,
};

const production: TeamDto = { id: 't-prod', name: 'Production', lead: null, memberCount: 3, createdAt: '', updatedAt: '' };

const renderTeam = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TeamView />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.mocked(api.users.list).mockResolvedValue([fatima]);
  vi.mocked(api.roles.list).mockResolvedValue([sales, manager, viewer]);
  vi.mocked(api.teams.list).mockResolvedValue([production]);
  vi.mocked(api.invitations.list).mockResolvedValue([]);
  vi.mocked(api.users.assignRoles).mockReset().mockResolvedValue(fatima);
  vi.mocked(api.users.assignTeam).mockReset().mockResolvedValue(fatima);
  vi.mocked(api.users.setActive).mockReset().mockResolvedValue({ ...fatima, isActive: false });
});

describe('permissionChange', () => {
  it('lists what a role change adds and takes away', () => {
    expect(permissionChange(fatima, 'manager', [sales, manager])).toEqual({
      gained: [PERMISSIONS.CONTACT_READ_ALL],
      lost: [],
    });
    expect(permissionChange(fatima, 'viewer', [sales, viewer])).toEqual({
      gained: [],
      lost: [PERMISSIONS.CONTACT_CREATE],
    });
  });
});

describe('TeamView', { timeout: 20_000 }, () => {
  it('asks before changing a role, naming the person and what they gain', async () => {
    renderTeam();
    const select = await screen.findByLabelText('Role for Fatima Hassan');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3));
    fireEvent.change(select, { target: { value: 'manager' } });

    expect(api.users.assignRoles).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Make Fatima Hassan Sales manager?' });
    expect(within(dialog).getByText('They gain (1)')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Change role' }));
    await waitFor(() => expect(api.users.assignRoles).toHaveBeenCalledWith('u-fatima', { roleIds: ['manager'] }));
  });

  it('shows what they lose, and nothing is saved on Cancel', async () => {
    renderTeam();
    const select = await screen.findByLabelText('Role for Fatima Hassan');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(3));
    fireEvent.change(select, { target: { value: 'viewer' } });
    const dialog = screen.getByRole('dialog', { name: 'Make Fatima Hassan Viewer?' });
    expect(within(dialog).getByText('They lose (1)')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.users.assignRoles).not.toHaveBeenCalled();
  });

  it('asks before moving someone to a team', async () => {
    renderTeam();
    const select = await screen.findByLabelText('Team for Fatima Hassan');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
    fireEvent.change(select, { target: { value: 't-prod' } });
    expect(api.users.assignTeam).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Move Fatima Hassan to Production?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move to team' }));
    await waitFor(() => expect(api.users.assignTeam).toHaveBeenCalledWith('u-fatima', 't-prod'));
  });

  it('asks before deactivating, and says what happens', async () => {
    renderTeam();
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    expect(api.users.setActive).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Fatima Hassan?' });
    expect(within(dialog).getByText(/signed out straight away/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(api.users.setActive).toHaveBeenCalledWith('u-fatima', false));
  });
});
