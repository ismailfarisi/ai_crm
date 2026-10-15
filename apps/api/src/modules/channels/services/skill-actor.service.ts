import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { UsersService } from '@/modules/users/users.service';
import { RbacService } from '@/modules/rbac/rbac.service';

/**
 * The acting user, shaped like `req.user`, for skill code that runs outside an
 * HTTP request (a Temporal activity). Mirrors `JwtStrategy.validate` so owner-
 * scoped services (ContactsService.scoped) see exactly what the web app would.
 */
@Injectable()
export class SkillActorService {
  constructor(
    private readonly users: UsersService,
    private readonly rbac: RbacService,
  ) {}

  async forContext(ctx: { organizationId: string; userId: string }): Promise<AuthenticatedUser> {
    const user = await this.users.findByIdForAuth(ctx.userId);
    if (!user || !user.isActive || user.tenantId !== ctx.organizationId) {
      throw new ForbiddenException('The acting user is not active in this organization');
    }
    const access = await this.rbac.resolveAccess(user.id, user.tenantId);
    return {
      id: user.id,
      organizationId: user.tenantId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: access.roles,
      level: access.level,
      permissions: access.permissions,
      isOwner: access.isOwner,
      teamId: user.teamId ?? null,
      managerId: user.managerId ?? null,
    };
  }
}
