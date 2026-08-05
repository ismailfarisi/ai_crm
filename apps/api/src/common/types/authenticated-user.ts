import type { Permission } from '@saas/shared';
import type { Request } from 'express';

/** What the JWT strategy attaches to `req.user`. */
export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Slugs of every role the user holds. */
  roles: string[];
  /** Most powerful (lowest) role level the user holds. */
  level: number;
  /** Effective permissions, resolved fresh from the database on each request. */
  permissions: Permission[];
  /** True when any of the user's roles is the all-powerful owner role. */
  isOwner: boolean;
  /** The team the user belongs to, or null. Team leaders see their team's contacts. */
  teamId: string | null;
  /** The user this member reports to, or null. */
  managerId: string | null;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
