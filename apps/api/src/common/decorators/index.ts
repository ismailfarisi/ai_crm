import {
  SetMetadata,
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { Permission } from '@saas/shared';
import type {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '@/common/types/authenticated-user';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const CREDENTIAL_ROUTE_KEY = 'throttle:credentialRoute';
export const PERMISSIONS_KEY = 'rbac:permissions';
export const PERMISSIONS_MODE_KEY = 'rbac:permissionsMode';
export const ROLES_KEY = 'rbac:roles';

export type PermissionsMode = 'all' | 'any';

/** Opt a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Marks a route that takes a credential, and so deserves the tight rate limit
 * a password-guessing attempt would run into.
 *
 * It has to be opt-in. A named throttler applies to every route in the
 * application unless it skips, so a second "auth" throttler configured
 * alongside the default silently caps the whole API at the login limit —
 * which is exactly what happened here: ten requests a minute, for everything.
 */
export const CredentialRoute = () => SetMetadata(CREDENTIAL_ROUTE_KEY, true);

/** Route requires ALL of the listed permissions. */
export const RequirePermissions = (...permissions: Permission[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    SetMetadata(PERMISSIONS_MODE_KEY, 'all' satisfies PermissionsMode),
  );

/** Route requires AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    SetMetadata(PERMISSIONS_MODE_KEY, 'any' satisfies PermissionsMode),
  );

/** Route requires one of the listed role slugs. Prefer permissions where you can. */
export const RequireRoles = (...roles: string[]) =>
  SetMetadata(ROLES_KEY, roles);

/** Injects the authenticated user, or one of its properties. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return data ? request.user?.[data] : request.user;
  },
);
