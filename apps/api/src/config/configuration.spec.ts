import { validateEnv } from './configuration';
import { pgConnectionOptions } from './database-options';

describe('validateEnv', () => {
  const base = {
    NODE_ENV: 'development',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
  };

  it('accepts a valid development configuration', () => {
    expect(() => validateEnv(base)).not.toThrow();
  });

  it('rejects an invalid production check-in window', () => {
    expect(() =>
      validateEnv({
        ...base,
        PRODUCTION_CHECK_IN_START_HOUR_UTC: '19',
        PRODUCTION_CHECK_IN_END_HOUR_UTC: '7',
      }),
    ).toThrow(/PRODUCTION_CHECK_IN_END_HOUR_UTC must be later/);
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

  describe('database durability settings', () => {
    it('defaults to a bounded pool and generous server-side timeouts', () => {
      const env = validateEnv(base);
      expect(env.DB_POOL_MAX).toBe(10);
      expect(env.DB_STATEMENT_TIMEOUT_MS).toBe(30_000);
      expect(env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(60_000);
      // Unchanged from before the setting existed: TLS is not verified.
      expect(env.DB_SSL_REJECT_UNAUTHORIZED).toBe(false);
    });

    it('reads the pool and timeout settings from the environment', () => {
      const env = validateEnv({
        ...base,
        DB_POOL_MAX: '25',
        DB_STATEMENT_TIMEOUT_MS: '0',
        DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '120000',
        DB_SSL_REJECT_UNAUTHORIZED: 'true',
      });
      expect(env.DB_POOL_MAX).toBe(25);
      expect(env.DB_STATEMENT_TIMEOUT_MS).toBe(0);
      expect(env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS).toBe(120_000);
      expect(env.DB_SSL_REJECT_UNAUTHORIZED).toBe(true);
    });

    it('rejects a zero-sized pool', () => {
      expect(() => validateEnv({ ...base, DB_POOL_MAX: '0' })).toThrow(
        /DB_POOL_MAX/,
      );
    });

    it('defaults the event outbox dispatcher on with sane limits', () => {
      const env = validateEnv(base);
      expect(env.EVENT_OUTBOX_DISPATCHER).toBe(true);
      expect(env.EVENT_OUTBOX_POLL_MS).toBe(1000);
      expect(env.EVENT_OUTBOX_BATCH_SIZE).toBe(50);
      expect(env.EVENT_OUTBOX_MAX_ATTEMPTS).toBe(10);
    });
  });

  describe('pgConnectionOptions', () => {
    const tuning = {
      ssl: false,
      sslRejectUnauthorized: false,
      poolMax: 10,
      statementTimeoutMs: 30_000,
      idleInTransactionTimeoutMs: 60_000,
    };

    it('passes the pool size and timeouts to node-postgres', () => {
      expect(pgConnectionOptions(tuning)).toEqual({
        ssl: false,
        extra: {
          max: 10,
          statement_timeout: 30_000,
          idle_in_transaction_session_timeout: 60_000,
        },
      });
    });

    it('omits a timeout set to zero so the server default applies', () => {
      const { extra } = pgConnectionOptions({
        ...tuning,
        statementTimeoutMs: 0,
        idleInTransactionTimeoutMs: 0,
      });
      expect(extra).toEqual({ max: 10 });
    });

    it('keeps TLS unverified unless asked to verify', () => {
      expect(pgConnectionOptions({ ...tuning, ssl: true }).ssl).toEqual({
        rejectUnauthorized: false,
      });
      expect(
        pgConnectionOptions({
          ...tuning,
          ssl: true,
          sslRejectUnauthorized: true,
        }).ssl,
      ).toEqual({ rejectUnauthorized: true });
    });
  });
});
