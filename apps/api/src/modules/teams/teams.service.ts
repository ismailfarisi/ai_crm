import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PERMISSIONS,
  type CreateTeamInput,
  type TeamDto,
  type UpdateTeamInput,
  type UserDto,
} from '@saas/shared';
import type { RbacActor } from '@/modules/rbac/rbac.service';
import { User } from '@/modules/users/entities/user.entity';
import { Team } from './entities/team.entity';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async listTeams(organizationId: string): Promise<TeamDto[]> {
    const teams = await this.teams.find({
      where: { organizationId },
      relations: { lead: true },
      order: { name: 'ASC' },
    });

    // A single count query avoids an N+1 over the members relation.
    const memberCounts = await this.users
      .createQueryBuilder('user')
      .select('user.teamId', 'teamId')
      .addSelect('COUNT(*)', 'count')
      .where('user.organizationId = :organizationId', { organizationId })
      .andWhere('user.teamId IS NOT NULL')
      .groupBy('user.teamId')
      .getRawMany<{ teamId: string; count: string }>();

    const counts = new Map(
      memberCounts.map((row) => [row.teamId, Number(row.count)]),
    );

    return teams.map((team) => this.toDto(team, counts.get(team.id) ?? 0));
  }

  async getTeam(organizationId: string, teamId: string): Promise<TeamDto> {
    const team = await this.findTeam(organizationId, teamId);
    const memberCount = await this.users.count({
      where: { organizationId, teamId: team.id },
    });
    return this.toDto(team, memberCount);
  }

  async createTeam(
    organizationId: string,
    actor: RbacActor,
    input: CreateTeamInput,
  ): Promise<TeamDto> {
    this.assertCanManageTeams(actor);

    await this.ensureUniqueName(organizationId, input.name);

    let lead: User | null = null;
    if (input.leadId) {
      lead = await this.findMemberInOrg(organizationId, input.leadId);
    }

    const team = this.teams.create({
      organizationId,
      name: input.name.trim(),
      leadId: lead?.id ?? null,
    });
    const saved = await this.teams.save(team);

    // The lead is a member of their own team and reports to nobody below admin.
    if (lead) {
      await this.users.update(
        { id: lead.id },
        { teamId: saved.id, managerId: null },
      );
    }

    return this.getTeam(organizationId, saved.id);
  }

  async updateTeam(
    organizationId: string,
    actor: RbacActor,
    teamId: string,
    input: UpdateTeamInput,
  ): Promise<TeamDto> {
    this.assertCanManageTeams(actor);
    const team = await this.findTeam(organizationId, teamId);

    if (input.name !== undefined && input.name.trim() !== team.name) {
      await this.ensureUniqueName(organizationId, input.name, teamId);
      team.name = input.name.trim();
    }

    if (input.leadId !== undefined) {
      if (input.leadId === null) {
        // Clear the lead; they stay a member of the team.
        team.leadId = null;
        team.lead = null;
      } else {
        const newLead = await this.findMemberInOrg(
          organizationId,
          input.leadId,
        );
        team.leadId = newLead.id;
        team.lead = newLead;
        // New lead joins the team; the previous lead stays a member.
        await this.users.update(
          { id: newLead.id },
          { teamId: team.id, managerId: null },
        );
      }
    }

    const saved = await this.teams.save(team);
    return this.getTeam(organizationId, saved.id);
  }

  async deleteTeam(
    organizationId: string,
    actor: RbacActor,
    teamId: string,
  ): Promise<void> {
    this.assertCanManageTeams(actor);
    const team = await this.findTeam(organizationId, teamId);

    // Soft delete; members keep existing, their teamId is cleared so nobody is
    // stranded in a deleted team.
    await this.users.update(
      { organizationId, teamId: team.id },
      { teamId: null, managerId: null },
    );
    await this.teams.softRemove(team);
  }

  /** Assign a member to a team, or clear it with null. Returns the updated user. */
  async setMemberTeam(
    organizationId: string,
    actor: RbacActor,
    userId: string,
    teamId: string | null,
  ): Promise<UserDto> {
    const user = await this.findMemberInOrg(organizationId, userId);

    // A team lead can move members within their own team; owners/admins can move anyone.
    const managingOwnTeam =
      teamId !== null && (await this.isLeadOf(organizationId, actor, teamId));
    if (!managingOwnTeam) {
      this.assertCanManageTeams(actor);
    }

    if (teamId) {
      const team = await this.findTeam(organizationId, teamId);
      if (team.leadId === user.id) {
        throw new BadRequestException(
          'Reassign the team lead before moving them to another team',
        );
      }
      await this.users.update(
        { id: user.id },
        { teamId: team.id, managerId: null },
      );
    } else {
      await this.users.update(
        { id: user.id },
        { teamId: null, managerId: null },
      );
    }

    return this.toUserDto(await this.findMemberInOrg(organizationId, user.id));
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async findTeam(
    organizationId: string,
    teamId: string,
  ): Promise<Team> {
    const team = await this.teams.findOne({
      where: { id: teamId, organizationId },
      relations: { lead: true },
    });
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  private async findMemberInOrg(
    organizationId: string,
    userId: string,
  ): Promise<User> {
    const user = await this.users.findOne({
      where: { id: userId, organizationId },
      relations: { roles: true },
    });
    if (!user) {
      throw new NotFoundException('User not found in this organization');
    }
    return user;
  }

  private async ensureUniqueName(
    organizationId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const trimmed = name.trim();
    const qb = this.teams
      .createQueryBuilder('team')
      .where('team.organizationId = :organizationId', { organizationId })
      .andWhere('LOWER(team.name) = LOWER(:name)', { name: trimmed });
    if (excludeId) {
      qb.andWhere('team.id != :excludeId', { excludeId });
    }
    if (await qb.getExists()) {
      throw new BadRequestException(`A team named "${trimmed}" already exists`);
    }
  }

  /** Owner, or anyone holding `user:update`, can manage teams. */
  private assertCanManageTeams(actor: RbacActor): void {
    if (actor.isOwner) return;
    if (!actor.permissions.includes(PERMISSIONS.USER_UPDATE)) {
      throw new ForbiddenException('You cannot manage teams');
    }
  }

  /** Whether the given actor leads the given team. */
  private async isLeadOf(
    organizationId: string,
    actor: RbacActor,
    teamId: string,
  ): Promise<boolean> {
    const team = await this.findTeam(organizationId, teamId);
    return team.leadId !== null && team.leadId === actor.id;
  }

  private toDto(team: Team, memberCount: number): TeamDto {
    return {
      id: team.id,
      name: team.name,
      lead: team.lead
        ? {
            id: team.lead.id,
            firstName: team.lead.firstName,
            lastName: team.lead.lastName,
            fullName: `${team.lead.firstName} ${team.lead.lastName}`.trim(),
            email: team.lead.email,
          }
        : null,
      memberCount,
      createdAt: team.createdAt.toISOString(),
      updatedAt: team.updatedAt.toISOString(),
    };
  }

  private toUserDto(user: User): UserDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
      roles: (user.roles ?? []).map((role) => ({
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
