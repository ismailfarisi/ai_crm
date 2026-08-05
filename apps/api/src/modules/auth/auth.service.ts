import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  SYSTEM_ROLES,
  type ChangePasswordInput,
  type LoginInput,
  type Permission,
  type RegisterInput,
  type SessionDto,
} from '@saas/shared';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { RbacService } from '@/modules/rbac/rbac.service';
import { UsersService } from '@/modules/users/users.service';
import { TokensService, type IssuedTokens } from './tokens.service';

interface RequestContext {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    private readonly users: UsersService,
    private readonly rbac: RbacService,
    private readonly tokens: TokensService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Signup provisions a whole tenant: organization, its five system roles, and
   * the first user as owner. All inside one transaction.
   */
  async register(input: RegisterInput, context: RequestContext): Promise<IssuedTokens & { userId: string }> {
    if (await this.users.emailExists(input.email)) {
      throw new BadRequestException('An account with that email already exists');
    }

    const userId = await this.dataSource.transaction(async (manager) => {
      const orgRepo = manager.getRepository(Organization);

      const organization = await orgRepo.save(
        orgRepo.create({
          name: input.organizationName,
          slug: await this.uniqueSlug(input.organizationName, manager.getRepository(Organization)),
        }),
      );

      const roles = await this.rbac.provisionSystemRoles(organization.id, manager);
      const ownerRole = roles.find((role) => role.slug === SYSTEM_ROLES.OWNER);
      if (!ownerRole) {
        throw new Error('Owner role was not provisioned — aborting signup');
      }

      const user = await this.users.createUser(
        {
          organizationId: organization.id,
          email: input.email,
          password: input.password,
          firstName: input.firstName,
          lastName: input.lastName,
          roles: [ownerRole],
        },
        manager,
      );

      this.logger.log(`Provisioned organization "${organization.name}" (${organization.id})`);
      return user.id;
    });

    const user = await this.users.findByIdForAuth(userId);
    if (!user) {
      throw new Error('User disappeared immediately after signup');
    }

    await this.users.recordLogin(user.id);
    const tokens = await this.tokens.issue(user, context);
    return { ...tokens, userId: user.id };
  }

  async login(input: LoginInput, context: RequestContext): Promise<IssuedTokens & { userId: string }> {
    const user = await this.users.findByEmailWithPassword(input.email);

    // Same message and roughly the same work either way, so the response does
    // not reveal whether the email exists.
    const passwordMatches = user
      ? await this.users.verifyPassword(input.password, user.passwordHash)
      : await this.users.verifyPassword(input.password, DUMMY_HASH);

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    await this.users.recordLogin(user.id);
    const tokens = await this.tokens.issue(user, context);
    return { ...tokens, userId: user.id };
  }

  async refresh(refreshToken: string, context: RequestContext): Promise<IssuedTokens> {
    const { tokens } = await this.tokens.rotate(
      refreshToken,
      (userId) => this.users.findByIdForAuth(userId),
      context,
    );
    return tokens;
  }

  async logout(refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.tokens.revokeByToken(refreshToken);
    }
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.users.findByIdWithPassword(userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    const matches = await this.users.verifyPassword(input.currentPassword, user.passwordHash);
    if (!matches) {
      throw new BadRequestException('Current password is incorrect');
    }

    await this.users.setPassword(userId, input.newPassword);
    // Every other device is signed out; the caller gets a fresh pair.
    await this.tokens.revokeAllForUser(userId);
  }

  /** The full session payload the web app hydrates from. */
  async getSession(userId: string, organizationId: string): Promise<SessionDto> {
    const user = await this.users.findMember(organizationId, userId);
    const organization = await this.organizations.findOne({ where: { id: organizationId } });
    if (!organization) {
      throw new UnauthorizedException('Organization no longer exists');
    }

    const access = await this.rbac.resolveAccess(userId, organizationId);

    return {
      user: this.users.toDto(user),
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt.toISOString(),
      },
      permissions: access.permissions as Permission[],
    };
  }

  /** Same as `getSession`, when the caller only has a user id to hand. */
  async getSessionForUser(userId: string): Promise<SessionDto> {
    const user = await this.users.findByIdForAuth(userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return this.getSession(user.id, user.organizationId);
  }

  /** Used after a password change so the acting device is not signed out. */
  async reissueForUser(userId: string, context: RequestContext): Promise<IssuedTokens> {
    const user = await this.users.findByIdForAuth(userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return this.tokens.issue(user, context);
  }

  private async uniqueSlug(name: string, repo: Repository<Organization>): Promise<string> {
    const base =
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120) || 'org';

    let candidate = base;
    let suffix = 1;
    while (await repo.exists({ where: { slug: candidate } })) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }
}

/**
 * A real bcrypt hash of a value nobody can guess. Comparing against it on the
 * "no such user" path keeps login timing roughly constant.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.6r1kEuNBEfLdxpMYRtQFEqTfaJXQNiG';
