import { describe, expect, it } from 'vitest';
import {
  acceptInviteSchema,
  assignRolesSchema,
  createRoleSchema,
  inviteUserSchema,
} from './rbac';

describe('inviteUserSchema', () => {
  const valid = {
    email: 'new@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    roleIds: ['4a2f9c3e-7b1d-4f8a-9c2e-1d3b5a7c9e11'],
  };

  it('accepts a valid invite without a password', () => {
    expect(inviteUserSchema.parse(valid)).toMatchObject({ email: 'new@example.com' });
  });

  it('does not carry a password field (invites are email-based now)', () => {
    const withPassword = inviteUserSchema.parse({ ...valid, password: 'Password123!' });
    // zod strips unknown keys by default, so the parsed result must not contain it.
    expect(withPassword).not.toHaveProperty('password');
  });

  it('normalizes email to lower case', () => {
    const result = inviteUserSchema.parse({ ...valid, email: 'New.User@Example.com' });
    expect(result.email).toBe('new.user@example.com');
  });

  it('requires at least one role', () => {
    const result = inviteUserSchema.safeParse({ ...valid, roleIds: [] });
    expect(result.success).toBe(false);
  });

  it('allows an optional team', () => {
    const result = inviteUserSchema.parse({
      ...valid,
      teamId: '4b2e0d4f-8c2e-4a9f-b3d1-2e4f6a8b0c21',
    });
    expect(result.teamId).toBeTruthy();
  });
});

describe('acceptInviteSchema', () => {
  it('requires a token and a strong password', () => {
    const ok = acceptInviteSchema.safeParse({ token: 'abc123', password: 'Password123!' });
    expect(ok.success).toBe(true);

    const noToken = acceptInviteSchema.safeParse({ token: '', password: 'Password123!' });
    expect(noToken.success).toBe(false);

    const weak = acceptInviteSchema.safeParse({ token: 'abc123', password: 'short' });
    expect(weak.success).toBe(false);
  });
});

describe('role schemas', () => {
  it('createRoleSchema requires a name', () => {
    expect(createRoleSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createRoleSchema.parse({ name: 'Ops' })).toMatchObject({ name: 'Ops' });
  });

  it('assignRolesSchema accepts an empty list only as a value, not as a requirement', () => {
    // The guard is in the service; the schema itself just passes arrays through.
    expect(assignRolesSchema.parse({ roleIds: [] })).toEqual({ roleIds: [] });
  });
});
