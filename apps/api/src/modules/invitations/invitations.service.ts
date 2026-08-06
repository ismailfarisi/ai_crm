import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import type { InvitationDto, InviteUserInput } from '@saas/shared';
import type { AppConfig } from '@/config/configuration';
import { MailService } from '@/modules/mail/mail.service';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import type { Role } from '@/modules/rbac/entities/role.entity';
import { RbacService } from '@/modules/rbac/rbac.service';
import { Team } from '@/modules/teams/entities/team.entity';
import { UsersService } from '@/modules/users/users.service';
import { Invitation } from './entities/invitation.entity';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Invitation)
    private readonly invitations: Repository<Invitation>,
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    private readonly rbac: RbacService,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Creates a pending invitation and emails it. Role assignment is validated
   * against the inviter's level exactly like the old direct-create flow, so an
   * admin still cannot invite someone into a role above their own.
   */
  async createInvitation(
    organizationId: string,
    actor: { id: string; level: number; firstName: string; lastName: string },
    input: InviteUserInput,
  ): Promise<InvitationDto> {
    if (await this.users.emailExists(input.email)) {
      throw new BadRequestException(
        'An account with that email already exists',
      );
    }

    const pending = await this.invitations.findOne({
      where: {
        organizationId,
        email: input.email.toLowerCase(),
        acceptedAt: IsNull(),
      },
    });
    if (pending && pending.expiresAt.getTime() > Date.now()) {
      throw new BadRequestException(
        'A pending invite already exists for that email',
      );
    }

    const roles = await this.rbac.findRolesByIds(organizationId, input.roleIds);
    this.assertNoEscalation(actor.level, roles);

    let teamId: string | null = null;
    if (input.teamId) {
      const team = await this.teams.findOne({
        where: { id: input.teamId, organizationId },
      });
      if (!team) {
        throw new NotFoundException('Team not found');
      }
      teamId = team.id;
    }

    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const invitation = await this.invitations.save(
      this.invitations.create({
        organizationId,
        email: input.email.toLowerCase(),
        firstName: input.firstName,
        lastName: input.lastName,
        roleIds: input.roleIds,
        teamId,
        tokenHash: this.hash(rawToken),
        expiresAt,
        invitedById: actor.id,
      }),
    );

    const organization = await this.organizationName(organizationId);
    await this.mail.sendInvite({
      to: invitation.email,
      organizationName: organization,
      inviterName:
        `${actor.firstName} ${actor.lastName}`.trim() || 'A teammate',
      acceptUrl: this.acceptUrl(rawToken),
      expiresAt,
    });

    return this.toDto(invitation);
  }

  /** Re-sends an existing pending invitation's email with a fresh token. */
  async resendInvitation(
    organizationId: string,
    invitationId: string,
    actorName: string,
  ): Promise<InvitationDto> {
    const invitation = await this.findPending(organizationId, invitationId);

    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    invitation.tokenHash = this.hash(rawToken);
    invitation.expiresAt = expiresAt;
    await this.invitations.save(invitation);

    const organization = await this.organizationName(organizationId);
    await this.mail.sendInvite({
      to: invitation.email,
      organizationName: organization,
      inviterName: actorName,
      acceptUrl: this.acceptUrl(rawToken),
      expiresAt,
    });

    return this.toDto(invitation);
  }

  async listPending(organizationId: string): Promise<InvitationDto[]> {
    const invites = await this.invitations.find({
      where: { organizationId, acceptedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    return invites.map((invitation) => this.toDto(invitation));
  }

  async cancelInvitation(
    organizationId: string,
    invitationId: string,
  ): Promise<void> {
    const invitation = await this.findPending(organizationId, invitationId);
    await this.invitations.remove(invitation);
  }

  /**
   * Consumes a raw token. Called by the public accept-invite endpoint. Returns
   * the organization and the roles/team to provision, so the auth flow can
   * create the user and sign them straight in.
   */
  async consume(rawToken: string): Promise<{
    invitation: Invitation;
    roles: Role[];
    organizationId: string;
  }> {
    const invitation = await this.invitations.findOne({
      where: { tokenHash: this.hash(rawToken), acceptedAt: IsNull() },
    });

    if (!invitation) {
      throw new BadRequestException('This invite is not valid');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('This invite has expired');
    }
    if (await this.users.emailExists(invitation.email)) {
      throw new BadRequestException(
        'An account already exists for this email — sign in instead',
      );
    }

    const roles = await this.rbac.findRolesByIds(
      invitation.organizationId,
      invitation.roleIds,
    );
    return { invitation, roles, organizationId: invitation.organizationId };
  }

  /** Marks an invitation accepted once the invitee's account exists. */
  async markAccepted(invitationId: string): Promise<void> {
    await this.invitations.update(
      { id: invitationId },
      { acceptedAt: new Date() },
    );
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private async findPending(
    organizationId: string,
    invitationId: string,
  ): Promise<Invitation> {
    const invitation = await this.invitations.findOne({
      where: { id: invitationId, organizationId, acceptedAt: IsNull() },
    });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    return invitation;
  }

  private async organizationName(organizationId: string): Promise<string> {
    const org = await this.organizations.findOne({
      where: { id: organizationId },
    });
    return org?.name ?? 'the organization';
  }

  private acceptUrl(rawToken: string): string {
    const origin = this.config.get('webOrigin', { infer: true })[0];
    return `${origin}/accept-invite?token=${encodeURIComponent(rawToken)}`;
  }

  private toDto(invitation: Invitation): InvitationDto {
    return {
      id: invitation.id,
      email: invitation.email,
      firstName: invitation.firstName,
      lastName: invitation.lastName,
      roleIds: invitation.roleIds,
      teamId: invitation.teamId,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }

  /** An actor may never invite into a role at or above their own level. */
  private assertNoEscalation(actorLevel: number, roles: Role[]): void {
    if (actorLevel === 0) return; // owner

    const tooPowerful = roles.filter((role) => role.level <= actorLevel);
    if (tooPowerful.length) {
      throw new ForbiddenException(
        `You cannot assign these roles: ${tooPowerful.map((r) => r.name).join(', ')}`,
      );
    }
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
