import { describe, expect, it } from 'vitest';
import { emailSchema, passwordSchema } from './auth';

describe('emailSchema', () => {
  it('accepts valid emails and normalizes case', () => {
    expect(emailSchema.parse('A@B.com')).toBe('a@b.com');
  });

  it('rejects invalid emails', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('').success).toBe(false);
  });
});

describe('passwordSchema', () => {
  it('requires length, lowercase, uppercase and a digit', () => {
    expect(passwordSchema.safeParse('Password123!').success).toBe(true);
    expect(passwordSchema.safeParse('password123').success).toBe(false); // no upper
    expect(passwordSchema.safeParse('PASSWORD123').success).toBe(false); // no lower
    expect(passwordSchema.safeParse('Passwordabc').success).toBe(false); // no digit
    expect(passwordSchema.safeParse('Short1!').success).toBe(false); // too short
  });

  it('caps at 128 characters', () => {
    expect(passwordSchema.safeParse('Aa1!'.repeat(40)).success).toBe(false);
  });
});
