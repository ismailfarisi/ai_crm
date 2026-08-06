import { validateEnv } from './configuration';

describe('validateEnv', () => {
  const base = {
    NODE_ENV: 'development',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
  };

  it('accepts a valid development configuration', () => {
    expect(() => validateEnv(base)).not.toThrow();
  });

  it('fails when secrets are too short', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET must be at least 32 characters/,
    );
  });

  it('rejects the committed dev placeholder secrets in production', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'dev_only_access_secret_change_me_at_least_32_chars',
      JWT_REFRESH_SECRET: 'dev_only_refresh_secret_change_me_at_least_32_chars',
      DB_PASSWORD: 'crm_dev_password',
    };
    expect(() => validateEnv(production)).toThrow(
      /dev-only placeholder secrets/,
    );
  });

  it('rejects real-looking secrets with the dev DB password in production', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      DB_PASSWORD: 'crm_dev_password',
    };
    expect(() => validateEnv(production)).toThrow(/DB_PASSWORD/);
  });

  it('allows a production configuration with real secrets', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(48),
      JWT_REFRESH_SECRET: 'b'.repeat(48),
      DB_PASSWORD: 'a-real-production-password',
    };
    expect(() => validateEnv(production)).not.toThrow();
  });

  it('rejects sameSite=none without secure cookies', () => {
    expect(() =>
      validateEnv({
        ...base,
        COOKIE_SAME_SITE: 'none',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow(/COOKIE_SAME_SITE=none requires COOKIE_SECURE=true/);
  });

  it('accepts sameSite=none when cookies are secure', () => {
    expect(() =>
      validateEnv({ ...base, COOKIE_SAME_SITE: 'none', COOKIE_SECURE: 'true' }),
    ).not.toThrow();
  });

  it('defaults the mail provider to console', () => {
    const env = validateEnv(base);
    expect(env.MAIL_PROVIDER).toBe('console');
  });

  it('accepts the ses mail provider', () => {
    const env = validateEnv({
      ...base,
      MAIL_PROVIDER: 'ses',
      MAIL_REGION: 'us-east-1',
    });
    expect(env.MAIL_PROVIDER).toBe('ses');
  });
});
