import { describe, it, expect } from 'vitest';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_DOMAINS,
  PERMISSION_GROUPS,
} from './index';

/**
 * Guards for the composed catalog.
 *
 * The catalog is spread together from one file per feature area, which buys
 * conflict-free merges at the cost of one new failure mode: two domain files
 * can declare the same permission string, or the same constant name, and the
 * spread silently keeps whichever came last. Nothing else would notice — the
 * permission would simply stop being grantable through one of its groups.
 */
describe('permission catalog composition', () => {
  it('has no duplicate permission values across domains', () => {
    const seen = new Map<string, string[]>();
    for (const domain of PERMISSION_DOMAINS) {
      for (const value of Object.values(domain.permissions)) {
        seen.set(value, [...(seen.get(value) ?? []), domain.key]);
      }
    }
    const duplicates = [...seen.entries()].filter(([, domains]) => domains.length > 1);
    expect(duplicates, `declared in more than one domain: ${JSON.stringify(duplicates)}`).toEqual([]);
  });

  it('has no duplicate constant names across domains', () => {
    const names = PERMISSION_DOMAINS.flatMap((d) => Object.keys(d.permissions));
    expect(names.length, 'a repeated constant name would be silently overwritten by the spread')
      .toBe(new Set(names).size);
  });

  it('exposes every domain permission on PERMISSIONS', () => {
    const fromDomains = PERMISSION_DOMAINS.flatMap((d) => Object.values(d.permissions)).sort();
    expect([...ALL_PERMISSIONS].sort()).toEqual(fromDomains);
  });

  it('describes every permission', () => {
    const undescribed = ALL_PERMISSIONS.filter((p) => !PERMISSION_DESCRIPTIONS[p]);
    expect(undescribed).toEqual([]);
  });

  it('only puts real permissions in groups', () => {
    const catalog = new Set<string>(ALL_PERMISSIONS);
    const unknown = PERMISSION_GROUPS.flatMap((g) => g.permissions).filter((p) => !catalog.has(p));
    expect(unknown).toEqual([]);
  });

  it('only grants real permissions to system roles', () => {
    const catalog = new Set<string>(ALL_PERMISSIONS);
    const unknown = PERMISSION_DOMAINS.flatMap((d) =>
      Object.values(d.grants).flat().filter((p) => !catalog.has(p as string)),
    );
    expect(unknown).toEqual([]);
  });

  it('never grants a domain permission from a different domain', () => {
    for (const domain of PERMISSION_DOMAINS) {
      const own = new Set<string>(Object.values(domain.permissions));
      const foreign = Object.values(domain.grants)
        .flat()
        .filter((p) => !own.has(p as string));
      expect(foreign, `${domain.key} grants permissions it does not own`).toEqual([]);
    }
  });

  it('gives every group a unique key', () => {
    const keys = PERMISSION_GROUPS.map((g) => g.key);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('keeps every permission string in <subject>:<action> shape', () => {
    const malformed = ALL_PERMISSIONS.filter((p) => !/^[a-z_]+:[a-z_]+$/.test(p));
    expect(malformed).toEqual([]);
  });

  it('does not grant anything to owner, which holds everything implicitly', () => {
    const ownerGrants = PERMISSION_DOMAINS.flatMap((d) => d.grants.owner ?? []);
    expect(ownerGrants).toEqual([]);
  });

  it('still resolves the constants call sites use', () => {
    expect(PERMISSIONS.QUOTE_APPROVE_BELOW_MARGIN).toBe('quote:approve_below_margin');
    expect(PERMISSIONS.CONTACT_READ_ALL).toBe('contact:read_all');
    expect(PERMISSIONS.ORG_MANAGE_BILLING).toBe('org:manage_billing');
  });
});
