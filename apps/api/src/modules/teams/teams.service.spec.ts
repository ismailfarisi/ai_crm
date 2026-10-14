import { PERMISSIONS } from '@saas/shared';
import { TeamsService } from './teams.service';

const tenantId = '11111111-1111-1111-1111-111111111111';
const admin = {
  id: 'user-admin',
  isOwner: false,
  permissions: [PERMISSIONS.USER_UPDATE],
} as any;

function makeService() {
  const now = new Date('2026-10-01T10:00:00Z');
  const team: any = {
    id: 'team-1',
    tenantId,
    name: 'Print',
    leadId: null,
    lead: null,
    createdAt: now,
    updatedAt: now,
  };
  const lead: any = {
    id: 'user-lead',
    tenantId,
    firstName: 'Lee',
    lastName: 'Dee',
    email: 'lee@example.test',
    roles: [],
  };

  const existsBuilder = () => {
    const b: any = {
      where: () => b,
      andWhere: () => b,
      getExists: async () => false,
    };
    return b;
  };

  // Writes made inside the transaction. The outer repositories' write methods
  // are there only so a test can show they were *not* used.
  const txTeams = {
    create: jest.fn((dto: any) => ({ ...dto })),
    save: jest.fn(async (row: any) => ({
      ...row,
      id: row.id ?? 'team-new',
      createdAt: now,
      updatedAt: now,
    })),
    softRemove: jest.fn(async (row: any) => row),
  };
  const txUsers = { update: jest.fn(async () => ({ affected: 1 })) };
  const txManager = {
    getRepository: jest.fn((entity: any) =>
      entity?.name === 'Team' ? txTeams : txUsers,
    ),
  };

  const teams = {
    findOne: jest.fn(async ({ where }: any) =>
      where.tenantId === tenantId ? { ...team, id: where.id } : null,
    ),
    create: jest.fn((dto: any) => ({ ...dto })),
    save: jest.fn(),
    softRemove: jest.fn(),
    createQueryBuilder: jest.fn(existsBuilder),
    manager: { transaction: jest.fn(async (cb: any) => cb(txManager)) },
  };
  const users = {
    findOne: jest.fn(async ({ where }: any) =>
      where.id === lead.id && where.tenantId === tenantId ? lead : null,
    ),
    count: jest.fn(async () => 1),
    update: jest.fn(),
  };

  const service = new TeamsService(teams as any, users as any);
  return { service, teams, users, txTeams, txUsers };
}

describe('TeamsService', () => {
  it('saves a new team and moves its lead into it in one transaction', async () => {
    // Separately, a failure after the team was saved left a team whose lead
    // was not a member of it.
    const { service, teams, users, txTeams, txUsers } = makeService();

    await service.createTeam(tenantId, admin, {
      name: 'Finishing',
      leadId: 'user-lead',
    } as any);

    expect(teams.manager.transaction).toHaveBeenCalledTimes(1);
    expect(txTeams.save).toHaveBeenCalled();
    expect(txUsers.update).toHaveBeenCalledWith(
      { id: 'user-lead', tenantId },
      { teamId: 'team-new', managerId: null },
    );
    expect(teams.save).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('changes a team lead and their membership in one transaction', async () => {
    const { service, teams, users, txTeams, txUsers } = makeService();

    await service.updateTeam(tenantId, admin, 'team-1', {
      leadId: 'user-lead',
    } as any);

    expect(teams.manager.transaction).toHaveBeenCalledTimes(1);
    expect(txUsers.update).toHaveBeenCalledWith(
      { id: 'user-lead', tenantId },
      { teamId: 'team-1', managerId: null },
    );
    expect(txTeams.save).toHaveBeenCalled();
    expect(teams.save).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('releases the members and removes the team in one transaction', async () => {
    // Separately, a failed remove after the members were released left a
    // live team with nobody in it.
    const { service, teams, users, txTeams, txUsers } = makeService();

    await service.deleteTeam(tenantId, admin, 'team-1');

    expect(teams.manager.transaction).toHaveBeenCalledTimes(1);
    expect(txUsers.update).toHaveBeenCalledWith(
      { tenantId, teamId: 'team-1' },
      { teamId: null, managerId: null },
    );
    expect(txTeams.softRemove).toHaveBeenCalled();
    expect(teams.softRemove).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });
});
