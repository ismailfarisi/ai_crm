import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Invitation } from './entities/invitation.entity';
import { InvitationsService } from './invitations.service';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const TEAM_ID = '22222222-2222-2222-2222-222222222222';

const adminRole = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Admin',
  level: 10,
};
const ownerRole = {
  id: '55555555-5555-5555-5555-555555555555',
  name: 'Owner',
  level: 0,
};

const configStub = {
  get: jest.fn((key: string) => {
    if (key === 'webOrigin') return ['http://localhost:3000'];
    return undefined;
  }),
} as unknown as ConfigService;

const mail = {
  sendInvite: jest.fn().mockResolvedValue(undefined),
  name: 'console',
};

function makeService(
  overrides: Partial<
    Record<
      'invitations' | 'teams' | 'organizations' | 'rbac' | 'users',
      unknown
    >
  > = {},
) {
  const invitations = (overrides.invitations ?? {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (inv) => ({
      id: 'id-1',
      createdAt: new Date(),
      ...inv,
    })),
    create: jest.fn((inv) => inv),
    find: jest.fn().mockResolvedValue([]),
    remove: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    manager: {},
  }) as unknown as Repository<Invitation>;

  const teams = (overrides.teams ?? {
    findOne: jest.fn().mockResolvedValue({ id: TEAM_ID }),
  }) as unknown as Repository<never>;

  const organizations = (overrides.organizations ?? {
    findOne: jest.fn().mockResolvedValue({ name: 'Acme' }),
  }) as unknown as Repository<never>;

  const rbac = (overrides.rbac ?? {
    findRolesByIds: jest.fn().mockResolvedValue([adminRole]),
  }) as unknown as Parameters<
    ConstructorParameters<typeof InvitationsService>[0]
  >[3];

  const users = (overrides.users ?? {
    emailExists: jest.fn().mockResolvedValue(false),
  }) as unknown as Parameters<
    ConstructorParameters<typeof InvitationsService>[0]
  >[4];

  return new InvitationsService(
    invitations,
    teams,
    organizations,
    rbac,
    users,
    mail as never,
    configStub,
  );
}

describe('InvitationsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createInvitation', () => {
    const actor = {
      id: 'actor-1',
      level: 0,
      firstName: 'Ada',
      lastName: 'Owner',
    };
    const input = {
      email: 'new@example.com',
      firstName: 'New',
      lastName: 'Person',
      roleIds: [adminRole.id],
      teamId: null,
    };

    it('creates a pending invitation and emails it', async () => {
      const service = makeService();
      const dto = await service.createInvitation(ORG_ID, actor, input);

      expect(dto.email).toBe('new@example.com');
      expect(dto.expiresAt).toBeTruthy();
      expect(mail.sendInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'new@example.com',
          organizationName: 'Acme',
          acceptUrl: expect.stringContaining(
            'http://localhost:3000/accept-invite?token=',
          ),
        }),
      );
    });

    it('rejects when the email already has an account', async () => {
      const users = { emailExists: jest.fn().mockResolvedValue(true) };
      const service = makeService({ users });
      await expect(
        service.createInvitation(ORG_ID, actor, input),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mail.sendInvite).not.toHaveBeenCalled();
    });

    it('blocks inviting someone into a role at or above the actor level', async () => {
      const rbac = { findRolesByIds: jest.fn().mockResolvedValue([ownerRole]) };
      const service = makeService({ rbac });
      // An admin (level 10) trying to invite someone into Owner (level 0).
      await expect(
        service.createInvitation(ORG_ID, { ...actor, level: 10 }, input),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an unknown team', async () => {
      const teams = { findOne: jest.fn().mockResolvedValue(null) };
      const service = makeService({ teams });
      await expect(
        service.createInvitation(ORG_ID, actor, { ...input, teamId: TEAM_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('consume', () => {
    const invitation = {
      id: 'inv-1',
      email: 'new@example.com',
      firstName: 'New',
      lastName: 'Person',
      roleIds: [adminRole.id],
      teamId: null,
      organizationId: ORG_ID,
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash: 'hash',
    };

    it('returns the invitation and roles for a valid token', async () => {
      const invitations = {
        findOne: jest.fn().mockResolvedValue(invitation),
      } as unknown as Repository<Invitation>;
      const users = { emailExists: jest.fn().mockResolvedValue(false) };
      const rbac = { findRolesByIds: jest.fn().mockResolvedValue([adminRole]) };
      const service = makeService({ invitations, users, rbac });

      const result = await service.consume('valid-token');
      expect(result.invitation.id).toBe('inv-1');
      expect(result.roles).toHaveLength(1);
    });

    it('rejects an unknown token', async () => {
      const invitations = {
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as Repository<Invitation>;
      const service = makeService({ invitations });
      await expect(service.consume('nope')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an expired invite', async () => {
      const invitations = {
        findOne: jest.fn().mockResolvedValue({
          ...invitation,
          expiresAt: new Date(Date.now() - 1000),
        }),
      } as unknown as Repository<Invitation>;
      const service = makeService({ invitations });
      await expect(service.consume('expired')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when an account already exists for the invitee email', async () => {
      const invitations = {
        findOne: jest.fn().mockResolvedValue(invitation),
      } as unknown as Repository<Invitation>;
      const users = { emailExists: jest.fn().mockResolvedValue(true) };
      const service = makeService({ invitations, users });
      await expect(service.consume('taken')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
