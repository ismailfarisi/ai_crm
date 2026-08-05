import {
  PERMISSION_DESCRIPTIONS,
  type Permission,
  type SessionDto,
} from '@saas/shared';

/**
 * One way to express "who may see this".
 *
 * The same rule object drives server-side route guards, the `<Can>` component,
 * the `useCan` hook and the sidebar navigation — so a screen, its nav entry and
 * its buttons can never drift apart. Every field is optional; an empty rule
 * allows everyone.
 */
export interface AccessRule {
  /** Must hold ALL of these. */
  permission?: Permission | Permission[];
  /** Must hold AT LEAST ONE of these. */
  anyOf?: Permission[];
  /** Must hold at least one of these role slugs. Prefer permissions. */
  role?: string | string[];
  /** Must hold NONE of these. Useful for "upgrade" prompts. */
  not?: Permission | Permission[];
}

/** The user facts a rule is evaluated against. */
export interface AccessSubject {
  permissions: readonly Permission[];
  roles: readonly string[];
}

const toArray = <T,>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * Pure, dependency-free, and deliberately isomorphic — importable from a server
 * component and a client component alike.
 *
 * This is a UI concern only. The API re-checks every one of these rules on each
 * request; hiding a button is a courtesy, never the security boundary.
 */
export function checkAccess(subject: AccessSubject, rule: AccessRule | undefined): boolean {
  if (!rule) return true;

  const held = new Set(subject.permissions);
  const roles = new Set(subject.roles);

  const required = toArray(rule.permission);
  if (required.length && !required.every((p) => held.has(p))) return false;

  if (rule.anyOf?.length && !rule.anyOf.some((p) => held.has(p))) return false;

  const requiredRoles = toArray(rule.role);
  if (requiredRoles.length && !requiredRoles.some((r) => roles.has(r))) return false;

  const forbidden = toArray(rule.not);
  if (forbidden.length && forbidden.some((p) => held.has(p))) return false;

  return true;
}

/** Narrows a session down to just what `checkAccess` needs. */
export function subjectFromSession(session: SessionDto): AccessSubject {
  return {
    permissions: session.permissions,
    roles: session.user.roles.map((role) => role.slug),
  };
}

export function can(session: SessionDto, rule: AccessRule): boolean {
  return checkAccess(subjectFromSession(session), rule);
}

/**
 * Turns a rule into something worth showing a human, e.g.
 * "View roles and their permissions". Used by the no-access screen so a denial
 * explains itself instead of just saying "forbidden".
 */
export function describeRule(rule: AccessRule): string[] {
  const describe = (permission: Permission) =>
    PERMISSION_DESCRIPTIONS[permission] ?? permission;

  const parts = [
    ...toArray(rule.permission).map(describe),
    ...(rule.anyOf ?? []).map(describe),
  ];

  const roles = toArray(rule.role);
  if (roles.length) {
    parts.push(`the ${roles.join(' or ')} role`);
  }

  return parts;
}
