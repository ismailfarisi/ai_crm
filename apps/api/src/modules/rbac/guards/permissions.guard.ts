import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@saas/shared';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  PERMISSIONS_MODE_KEY,
  ROLES_KEY,
  type PermissionsMode,
} from '@/common/decorators';
import type { AuthenticatedRequest } from '@/common/types/authenticated-user';

/**
 * Runs after the JWT guard. The user object already carries permissions resolved
 * from the database for this request, so nothing here trusts the token's claims.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length && !requiredRoles?.length) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    if (requiredRoles?.length) {
      const hasRole = requiredRoles.some((role) => user.roles.includes(role));
      if (!hasRole) {
        throw new ForbiddenException(`Requires one of these roles: ${requiredRoles.join(', ')}`);
      }
    }

    if (required?.length) {
      const mode =
        this.reflector.getAllAndOverride<PermissionsMode>(PERMISSIONS_MODE_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) ?? 'all';

      const held = new Set(user.permissions);
      const granted =
        mode === 'any' ? required.some((p) => held.has(p)) : required.every((p) => held.has(p));

      if (!granted) {
        const missing = required.filter((p) => !held.has(p));
        throw new ForbiddenException(
          mode === 'any'
            ? `Requires one of: ${required.join(', ')}`
            : `Missing permission(s): ${missing.join(', ')}`,
        );
      }
    }

    return true;
  }
}
