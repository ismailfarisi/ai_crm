import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import type { AssignRolesInput, RoleSummaryDto, UserDto } from '@saas/shared';
import type { AppConfig } from '@/config/configuration';
import { RbacService } from '@/modules/rbac/rbac.service';
import type { Role } from '@/modules/rbac/entities/role.entity';
import { Team } from '@/modules/teams/entities/team.entity';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    private readonly rbac: RbacService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // ─── Lookups used by auth ───────────────────────────────────────────────────

  /** Includes the (normally hidden) password hash. Only for the login path. */
  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.toLowerCase() })
      .getOne();
  }

  async findByIdForAuth(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  async findByIdWithPassword(id: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
  }

  async emailExists(email: string): Promise<boolean> {
    return this.users.exists({ where: { email: email.toLowerCase() } });
  }

  async recordLogin(userId: string): Promise<void> {
    await this.users.update({ id: userId }, { lastLoginAt: new Date() });
  }

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(
      plain,
      this.config.get('security.bcryptRounds', { infer: true }),
    );
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** Bumping this timestamp invalidates every access token issued so far. */
  async setPassword(userId: string, plainPassword: string): Promise<void> {
    await this.users.update(
      { id: userId },
      {
        passwordHash: await this.hashPassword(plainPassword),
        credentialsChangedAt: new Date(),
      },
    );
  }

  // ─── Team management ────────────────────────────────────────────────────────

  async createUser(
    params: {
      organizationId: string;
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      roles: Role[];
      teamId?: string | null;
    },
    manager?: EntityManager,
  ): Promise<User> {
    const repo = manager ? manager.getRepository(User) : this.users;

    const user = repo.create({
      organizationId: params.organizationId,
      email: params.email.toLowerCase(),
      passwordHash: await this.hashPassword(params.password),
      firstName: params.firstName,
      lastName: params.lastName,
      isActive: true,
      credentialsChangedAt: new Date(),
      roles: params.roles,
      teamId: params.teamId ?? null,
    });

    return repo.save(user);
  }

  async listMembers(organizationId: string): Promise<UserDto[]> {
    const members = await this.users.find({
      where: { organizationId },
      relations: { roles: true },
      order: { createdAt: 'ASC' },
    });

    return members.map((user) => this.toDto(user));
  }

  async getMember(organizationId: string, userId: string): Promise<UserDto> {
    return this.toDto(await this.findMember(organizationId, userId));
  }

  async inviteMember(
    organizationId: string,
    actorLevel: number,
    input: {
      email: string;
      firstName: string;
      lastName: string;
      password: string;
      roleIds: string[];
      teamId?: string | null;
    },
  ): Promise<UserDto> {
    if (await this.emailExists(input.email)) {
      throw new BadRequestException(
        'An account with that email already exists',
      );
    }

    const roles = await this.rbac.findRolesByIds(organizationId, input.roleIds);
    this.assertNoEscalation(actorLevel, roles);

    let teamId: string | null = null;
    if (input.teamId) {
      const team = await this.findTeamInOrg(organizationId, input.teamId);
      teamId = team.id;
    }

    const user = await this.createUser({
      organizationId,
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      roles,
      teamId,
    });

    return this.toDto(await this.findMember(organizationId, user.id));
  }

  async assignRoles(
    organizationId: string,
    actorId: string,
    actorLevel: number,
    userId: string,
    input: AssignRolesInput,
  ): Promise<UserDto> {
    const user = await this.findMember(organizationId, userId);

    if (user.id === actorId) {
      throw new ForbiddenException('You cannot change your own roles');
    }

    const targetLevel = user.roles.length
      ? Math.min(...user.roles.map((r) => r.level))
      : Number.MAX_SAFE_INTEGER;
    if (targetLevel <= actorLevel) {
      throw new ForbiddenException(
        'You cannot modify a user at or above your own level',
      );
    }

    const roles = await this.rbac.findRolesByIds(organizationId, input.roleIds);
    this.assertNoEscalation(actorLevel, roles);

    if (!roles.length) {
      throw new BadRequestException('A user must hold at least one role');
    }

    user.roles = roles;
    await this.users.save(user);
    this.rbac.invalidate(organizationId, user.id);

    return this.toDto(await this.findMember(organizationId, user.id));
  }

  async setActive(
    organizationId: string,
    actorId: string,
    actorLevel: number,
    userId: string,
    isActive: boolean,
  ): Promise<UserDto> {
    const user = await this.findMember(organizationId, userId);

    if (user.id === actorId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }

    const targetLevel = user.roles.length
      ? Math.min(...user.roles.map((r) => r.level))
      : Number.MAX_SAFE_INTEGER;
    if (targetLevel <= actorLevel) {
      throw new ForbiddenException(
        'You cannot modify a user at or above your own level',
      );
    }

    if (!isActive && (await this.isLastActiveOwner(organizationId, user))) {
      throw new BadRequestException(
        'An organization must keep at least one active owner',
      );
    }

    user.isActive = isActive;
    // Deactivating must take effect immediately, not when the access token expires.
    user.credentialsChangedAt = new Date();
    await this.users.save(user);
    this.rbac.invalidate(organizationId, user.id);

    return this.toDto(await this.findMember(organizationId, user.id));
  }

  async updateProfile(
    organizationId: string,
    userId: string,
    input: { firstName?: string; lastName?: string },
  ): Promise<UserDto> {
    const user = await this.findMember(organizationId, userId);
    if (input.firstName) user.firstName = input.firstName;
    if (input.lastName) user.lastName = input.lastName;
    await this.users.save(user);
    return this.toDto(user);
  }

  async findMember(organizationId: string, userId: string): Promise<User> {
    const user = await this.users.findOne({
      where: { id: userId, organizationId },
      relations: { roles: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /** Move a member into a team, or clear their team with null. */
  async assignTeam(
    organizationId: string,
    actorId: string,
    actorLevel: number,
    userId: string,
    teamId: string | null,
  ): Promise<UserDto> {
    const user = await this.findMember(organizationId, userId);

    if (user.id === actorId) {
      throw new ForbiddenException('You cannot change your own team');
    }

    const targetLevel = user.roles.length
      ? Math.min(...user.roles.map((r) => r.level))
      : Number.MAX_SAFE_INTEGER;
    if (targetLevel <= actorLevel) {
      throw new ForbiddenException(
        'You cannot modify a user at or above your own level',
      );
    }

    if (teamId) {
      const team = await this.findTeamInOrg(organizationId, teamId);
      if (team.leadId === user.id) {
        throw new BadRequestException(
          'Reassign the team lead before moving them to another team',
        );
      }
      user.teamId = team.id;
      user.managerId = null;
    } else {
      user.teamId = null;
      user.managerId = null;
    }

    await this.users.save(user);
    return this.toDto(await this.findMember(organizationId, user.id));
  }

  private async findTeamInOrg(
    organizationId: string,
    teamId: string,
  ): Promise<Team> {
    const team = await this.teams.findOne({
      where: { id: teamId, organizationId },
    });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  private async isLastActiveOwner(
    organizationId: string,
    user: User,
  ): Promise<boolean> {
    const isOwner = user.roles.some((role) => role.grantsAllPermissions);
    if (!isOwner) return false;

    const otherActiveOwners = await this.users
      .createQueryBuilder('user')
      .innerJoin('user.roles', 'role')
      .where('user.organizationId = :organizationId', { organizationId })
      .andWhere('user.isActive = true')
      .andWhere('role.grantsAllPermissions = true')
      .andWhere('user.id != :userId', { userId: user.id })
      .getCount();

    return otherActiveOwners === 0;
  }

  /** An actor may never assign a role at or above their own level. */
  private assertNoEscalation(actorLevel: number, roles: Role[]): void {
    if (actorLevel === 0) return; // owner

    const tooPowerful = roles.filter((role) => role.level <= actorLevel);
    if (tooPowerful.length) {
      throw new ForbiddenException(
        `You cannot assign these roles: ${tooPowerful.map((r) => r.name).join(', ')}`,
      );
    }
  }

  toDto(user: User): UserDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
      roles: (user.roles ?? []).map((role): RoleSummaryDto => ({
        id: role.id,
        name: role.name,
        slug: role.slug,
        isSystem: role.isSystem,
        level: role.level,
      })),
      teamId: user.teamId ?? null,
      managerId: user.managerId ?? null,
    };
  }
}
