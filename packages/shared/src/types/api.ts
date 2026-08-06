import type { Permission } from '../rbac/permissions';
import type { ContactSource, ContactStatus } from '../schemas/contact';

export interface PaginatedResult<T> {
  items: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface ApiErrorBody {
  statusCode: number;
  message: string;
  error?: string;
  /** Field-level errors keyed by dotted path, produced by the zod pipe. */
  details?: Record<string, string[]>;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface RoleSummaryDto {
  id: string;
  name: string;
  slug: string;
  isSystem: boolean;
  level: number;
}

export interface RoleDto extends RoleSummaryDto {
  description: string;
  permissions: Permission[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: RoleSummaryDto[];
  /** The team this member belongs to, or null when unassigned. */
  teamId: string | null;
  /** Direct reporting line: this member's manager, or null. */
  managerId: string | null;
}

export interface TeamDto {
  id: string;
  name: string;
  lead: ContactOwnerDto | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** What `GET /auth/me` returns — the whole session in one payload. */
export interface SessionDto {
  user: UserDto;
  organization: OrganizationDto;
  /** Flattened union of every permission across the user's roles. */
  permissions: Permission[];
}

export interface ContactOwnerDto {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
}

export interface ContactDto {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  status: ContactStatus;
  source: ContactSource;
  notes: string | null;
  owner: ContactOwnerDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactStatsDto {
  total: number;
  byStatus: Record<ContactStatus, number>;
  createdThisWeek: number;
  createdThisMonth: number;
}

/** A pending invite to join an organization. Created by an admin, accepted by the invitee. */
export interface InvitationDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roleIds: string[];
  /** The team the invitee joins on acceptance, if one was chosen. */
  teamId: string | null;
  expiresAt: string;
  createdAt: string;
}
