import { describe, it, expect } from 'vitest';
import { PERMISSIONS, type Permission } from './permissions';
import { SYSTEM_ROLES, SYSTEM_ROLE_DEFINITIONS, type SystemRoleSlug } from './roles';

const grants = (slug: SystemRoleSlug): Permission[] => {
  const definition = SYSTEM_ROLE_DEFINITIONS.find((role) => role.slug === slug);
  if (!definition) throw new Error(`No definition for ${slug}`);
  // Owner is a wildcard — `null` means "everything", not "nothing".
  return definition.permissions ?? [...Object.values(PERMISSIONS)];
};

const can = (slug: SystemRoleSlug, permission: Permission) => grants(slug).includes(permission);

describe('system role definitions', () => {
  /**
   * Regression guard. The quote permissions existed in the catalog but were
   * granted to no role at all, so quoting worked only for the owner — admins
   * could see cost on quotes they could not open. Nothing in the type system
   * catches a permission that is simply never referenced.
   */
  describe('every non-owner role can reach quotes', () => {
    it.each([
      SYSTEM_ROLES.ADMIN,
      SYSTEM_ROLES.MANAGER,
      SYSTEM_ROLES.MEMBER,
      SYSTEM_ROLES.VIEWER,
    ])('%s can read quotes', (slug) => {
      expect(can(slug, PERMISSIONS.QUOTE_READ)).toBe(true);
    });

    it.each([SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.MANAGER, SYSTEM_ROLES.MEMBER])(
      '%s can create and update quotes',
      (slug) => {
        expect(can(slug, PERMISSIONS.QUOTE_CREATE)).toBe(true);
        expect(can(slug, PERMISSIONS.QUOTE_UPDATE)).toBe(true);
      },
    );
  });

  describe('approval is a step up from drafting', () => {
    it('lets admin and manager approve', () => {
      expect(can(SYSTEM_ROLES.ADMIN, PERMISSIONS.QUOTE_APPROVE)).toBe(true);
      expect(can(SYSTEM_ROLES.MANAGER, PERMISSIONS.QUOTE_APPROVE)).toBe(true);
    });

    it('does not let a member approve their own quote', () => {
      expect(can(SYSTEM_ROLES.MEMBER, PERMISSIONS.QUOTE_APPROVE)).toBe(false);
    });

    it('keeps viewer read-only', () => {
      expect(can(SYSTEM_ROLES.VIEWER, PERMISSIONS.QUOTE_CREATE)).toBe(false);
      expect(can(SYSTEM_ROLES.VIEWER, PERMISSIONS.QUOTE_UPDATE)).toBe(false);
      expect(can(SYSTEM_ROLES.VIEWER, PERMISSIONS.QUOTE_APPROVE)).toBe(false);
    });
  });

  /**
   * The whole point of the margin guardrail: being senior enough to approve
   * does not make you senior enough to approve *below the floor*.
   */
  describe('the margin override is narrower than approval', () => {
    it('is held by admin', () => {
      expect(can(SYSTEM_ROLES.ADMIN, PERMISSIONS.QUOTE_APPROVE_BELOW_MARGIN)).toBe(true);
    });

    it('is withheld from manager, who can otherwise approve', () => {
      expect(can(SYSTEM_ROLES.MANAGER, PERMISSIONS.QUOTE_APPROVE)).toBe(true);
      expect(can(SYSTEM_ROLES.MANAGER, PERMISSIONS.QUOTE_APPROVE_BELOW_MARGIN)).toBe(false);
    });

    it('is withheld from member and viewer', () => {
      expect(can(SYSTEM_ROLES.MEMBER, PERMISSIONS.QUOTE_APPROVE_BELOW_MARGIN)).toBe(false);
      expect(can(SYSTEM_ROLES.VIEWER, PERMISSIONS.QUOTE_APPROVE_BELOW_MARGIN)).toBe(false);
    });
  });

  describe('cost visibility', () => {
    it('reaches admin and manager', () => {
      expect(can(SYSTEM_ROLES.ADMIN, PERMISSIONS.QUOTE_VIEW_COST)).toBe(true);
      expect(can(SYSTEM_ROLES.MANAGER, PERMISSIONS.QUOTE_VIEW_COST)).toBe(true);
    });

    // The role the server-side cost stripping actually protects.
    it('is withheld from the rep who builds the quote', () => {
      expect(can(SYSTEM_ROLES.MEMBER, PERMISSIONS.QUOTE_VIEW_COST)).toBe(false);
      expect(can(SYSTEM_ROLES.MEMBER, PERMISSIONS.CATALOG_READ)).toBe(true);
    });

    it('is withheld from viewer', () => {
      expect(can(SYSTEM_ROLES.VIEWER, PERMISSIONS.QUOTE_VIEW_COST)).toBe(false);
    });
  });

  describe('editing the cost model is admin-only', () => {
    it('grants catalog:manage to admin alone', () => {
      expect(can(SYSTEM_ROLES.ADMIN, PERMISSIONS.CATALOG_MANAGE)).toBe(true);
      for (const slug of [SYSTEM_ROLES.MANAGER, SYSTEM_ROLES.MEMBER, SYSTEM_ROLES.VIEWER]) {
        expect(can(slug, PERMISSIONS.CATALOG_MANAGE)).toBe(false);
      }
    });
  });

  /**
   * Catches the original bug in general rather than only for quotes: a
   * permission nobody grants is unreachable for every role except owner, and
   * nothing in the type system notices.
   *
   * The email permissions below are currently in exactly that state — the
   * email client works only for the owner. That is a separate, pre-existing
   * gap and deciding who should hold `email:read_all` is a policy call, so it
   * is recorded here rather than quietly fixed. Pinning the exact set means a
   * NEW orphan still fails this test.
   */
  it('leaves no permission unreachable beyond the known email gap', () => {
    const granted = new Set(
      SYSTEM_ROLE_DEFINITIONS.flatMap((role) => role.permissions ?? []),
    );

    // Owner-only by design: billing is deliberately not delegated.
    const ownerOnly: Permission[] = [PERMISSIONS.ORG_MANAGE_BILLING];

    const orphaned = Object.values(PERMISSIONS).filter(
      (permission) => !granted.has(permission) && !ownerOnly.includes(permission),
    );

    expect(orphaned).toEqual([
      PERMISSIONS.EMAIL_READ,
      PERMISSIONS.EMAIL_READ_ALL,
      PERMISSIONS.EMAIL_SEND,
      PERMISSIONS.EMAIL_MANAGE,
    ]);
  });

  it('grants strictly less access as the role level rises', () => {
    const ordered = [...SYSTEM_ROLE_DEFINITIONS]
      .filter((role) => role.permissions !== null)
      .sort((a, b) => a.level - b.level);

    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i].permissions!.length).toBeLessThanOrEqual(
        ordered[i - 1].permissions!.length,
      );
    }
  });
});
