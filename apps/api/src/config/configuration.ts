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

  // Public URL the API is reachable at — used to build webhook URLs (e.g. for
  // Telegram's setWebhook). Point this at your ngrok/tunnel URL in local dev,
  // or your real API domain in production. Falls back to localhost, which
  // works for display purposes but isn't reachable from Telegram's servers.
  PUBLIC_API_URL: z.string().optional(),

  // How many proxies sit in front of the API, counted from the API outwards.
  // req.ip is taken from X-Forwarded-For by skipping exactly this many hops,
  // so it must match the deployment: 1 for a single reverse proxy, 2 behind a
  // CDN such as Cloudflare in front of that proxy. Too low and every visitor
  // shares the CDN edge's identity — one rate-limit bucket, and an audit
  // trail full of the CDN's addresses. Too high and a visitor can spoof their
  // own address by sending an X-Forwarded-For header.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

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

  // Subscription billing (see modules/billing)
  BILLING_PROVIDER: z.enum(['fake', 'stripe']).default('fake'),
  // The fake provider lets anyone with org:manage_billing mark a checkout as
  // paid. Off in production unless a staging deploy opts in explicitly.
  BILLING_FAKE_CHECKOUT: z.string().optional(),
  // Restrict writes for lapsed trials and unresolved failed payments.
  BILLING_ENFORCE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // plan code → Stripe price id, e.g. "starter:price_123,growth:price_456"
  STRIPE_PRICE_IDS: z.string().optional(),

  // AI — DEAD as of the per-org AiConfig table (see modules/ai/entities/ai-config.entity.ts).
  // AiService now resolves provider credentials from the DB only, per organization;
  // these env vars are unread. Left here rather than removed to avoid touching
  // .env.example/docker-compose env passthrough in the same change — remove once
  // every environment has migrated to configuring a provider via Settings > AI.
  // File attachments (see modules/storage — the same shape as MAIL_PROVIDER)
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  // Where the local driver writes. A mounted volume in Docker; unused for s3.
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  STORAGE_S3_BUCKET: z.string().optional(),
  // Credentials come from the SDK's default chain, never from .env.
  STORAGE_S3_REGION: z.string().optional(),
  // How long a download link stays valid. Long enough to click, short enough
  // that a link pasted into a chat is useless by the time anyone reads it.
  STORAGE_URL_TTL: z.coerce.number().int().min(30).max(3600).default(300),

  AI_PROVIDER: z.enum(['anthropic']).default('anthropic'),
  AI_ANTHROPIC_API_KEY: z.string().optional(),
  AI_ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
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

  if (env.STORAGE_PROVIDER === 's3' && !env.STORAGE_S3_BUCKET) {
    throw new Error(
      'Invalid environment configuration: STORAGE_PROVIDER=s3 requires STORAGE_S3_BUCKET.',
    );
  }

  if (
    env.BILLING_PROVIDER === 'stripe' &&
    (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET)
  ) {
    throw new Error(
      'Invalid environment configuration: BILLING_PROVIDER=stripe requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.',
    );
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
    publicApiUrl:
      env.PUBLIC_API_URL?.replace(/\/$/, '') ??
      `http://localhost:${env.PORT}/${env.API_PREFIX}`,
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
    trustProxyHops: env.TRUST_PROXY_HOPS,
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
    storage: {
      provider: env.STORAGE_PROVIDER,
      localDir: env.STORAGE_LOCAL_DIR,
      bucket: env.STORAGE_S3_BUCKET,
      region: env.STORAGE_S3_REGION,
      urlTtlSeconds: env.STORAGE_URL_TTL,
      // Download links are signed with the access-token secret: same lifetime
      // assumptions, same rotation, one fewer secret to manage.
      signingSecret: env.JWT_ACCESS_SECRET,
    },
    billing: {
      provider: env.BILLING_PROVIDER,
      fakeCheckout:
        env.BILLING_FAKE_CHECKOUT === undefined
          ? env.NODE_ENV !== 'production'
          : env.BILLING_FAKE_CHECKOUT === 'true',
      enforce: env.BILLING_ENFORCE,
      stripeSecretKey: env.STRIPE_SECRET_KEY,
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
      stripePriceIds: Object.fromEntries(
        (env.STRIPE_PRICE_IDS ?? '')
          .split(',')
          .map((pair) => pair.split(':').map((part) => part.trim()))
          .filter((pair) => pair.length === 2 && pair[0] && pair[1]),
      ) as Record<string, string>,
    },
    ai: {
      provider: env.AI_PROVIDER,
      anthropicApiKey: env.AI_ANTHROPIC_API_KEY,
      anthropicModel: env.AI_ANTHROPIC_MODEL,
    },
  };
}

export type AppConfig = ReturnType<typeof configuration>;
