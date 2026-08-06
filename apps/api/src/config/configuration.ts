import { z } from 'zod';

/**
 * Every environment variable the API reads, validated once at boot. A typo in
 * `.env` fails the process immediately instead of surfacing as a mystery 500
 * three screens into the app.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('api/v1'),

  // Database
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5433),
  DB_USERNAME: z.string().default('crm'),
  DB_PASSWORD: z.string().default('crm_dev_password'),
  DB_NAME: z.string().default('crm'),
  DB_SYNCHRONIZE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  DB_LOGGING: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  DB_SSL: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  // Auth
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  // Cookies / CORS
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),

  // Rate limiting
  THROTTLE_TTL: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
  AUTH_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),

  // Mail (see modules/mail — providers are switchable via this enum)
  MAIL_PROVIDER: z.enum(['console', 'ses']).default('console'),
  MAIL_FROM: z.string().default('Relay CRM <no-reply@relay.local>'),
  // Only used when MAIL_PROVIDER=ses. Credentials come from the SDK's default
  // chain (env vars, ~/.aws/credentials, IAM role, ...), never from .env.
  MAIL_REGION: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Values that are fine in local development but must never appear in a
 * production boot. `.env.example` ships with them so `cp .env.example .env`
 * works out of the box; if a deploy reaches `NODE_ENV=production` with them
 * still set, we fail fast instead of signing tokens with publicly known keys.
 */
const DEV_ONLY_PLACEHOLDERS = [
  'dev_only_access_secret_change_me_at_least_32_chars',
  'dev_only_refresh_secret_change_me_at_least_32_chars',
  'crm_dev_password',
] as const;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = result.data;

  if (env.NODE_ENV === 'production') {
    const offending = [
      ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
      ['DB_PASSWORD', env.DB_PASSWORD],
    ].filter(([, value]) =>
      (DEV_ONLY_PLACEHOLDERS as readonly string[]).includes(value),
    );

    if (offending.length) {
      const list = offending.map(([key]) => `  - ${key}`).join('\n');
      throw new Error(
        `Production boot blocked: dev-only placeholder secrets are not allowed.\n${list}\n` +
          'Generate real secrets (e.g. `openssl rand -base64 48`) before deploying.',
      );
    }
  }

  if (env.COOKIE_SAME_SITE === 'none' && !env.COOKIE_SECURE) {
    throw new Error(
      'Invalid environment configuration: COOKIE_SAME_SITE=none requires COOKIE_SECURE=true ' +
        '(browsers reject an insecure cross-site cookie).',
    );
  }

  return env;
}

/**
 * Nest's ConfigService is typed against this shape, so `config.get('jwt.accessSecret')`
 * is checked at compile time.
 */
export function configuration() {
  const env = validateEnv(process.env);

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    apiPrefix: env.API_PREFIX,
    webOrigin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
    database: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      username: env.DB_USERNAME,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      synchronize: env.DB_SYNCHRONIZE,
      logging: env.DB_LOGGING,
      ssl: env.DB_SSL,
    },
    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshSecret: env.JWT_REFRESH_SECRET,
      refreshTtl: env.JWT_REFRESH_TTL,
    },
    security: {
      bcryptRounds: env.BCRYPT_ROUNDS,
    },
    cookies: {
      domain: env.COOKIE_DOMAIN,
      // Forced on in production — an httpOnly session cookie over plain HTTP
      // would be trivially sniffed. Localhost development can keep it false.
      secure: env.COOKIE_SECURE || env.NODE_ENV === 'production',
      sameSite: env.COOKIE_SAME_SITE,
    },
    throttle: {
      ttl: env.THROTTLE_TTL,
      limit: env.THROTTLE_LIMIT,
      authLimit: env.AUTH_THROTTLE_LIMIT,
    },
    mail: {
      provider: env.MAIL_PROVIDER,
      from: env.MAIL_FROM,
      region: env.MAIL_REGION,
    },
  };
}

export type AppConfig = ReturnType<typeof configuration>;
