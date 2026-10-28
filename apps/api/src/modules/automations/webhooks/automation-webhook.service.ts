import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import type Redis from 'ioredis';
import { Repository } from 'typeorm';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { BillingService } from '../../billing/billing.service';
import { REDIS_CLIENT_TOKEN } from '../../ai/services/redis-budget-guard.service';
import { AutomationsService, WEBHOOK_TOKEN_RE } from '../automations.service';
import { AutomationWorkflow } from '../entities/automation-workflow.entity';

export interface WebhookRequest {
  /** The `Content-Type` header, parameters and all. */
  contentType: string;
  /** The exact bytes received: what a signature is computed over. */
  rawBody: Buffer;
  /** The `X-Kerf-Signature` header. */
  signature?: string;
  /** The `Idempotency-Key` header. */
  idempotencyKey?: string;
}

export type WebhookOutcome =
  | { kind: 'accepted'; contentType: WebhookContentType }
  | { kind: 'redirect'; url: string };

type WebhookContentType = 'json' | 'form';

const WEBHOOK_RATE_LIMIT = 60;
const RATE_WINDOW_SECONDS = 60;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

/** One atomic fixed-window counter: the first hit in a window sets its expiry. */
const RATE_LIMIT_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return n
`;

const SIGNATURE_RE = /^sha256=([0-9a-f]{64})$/i;

/**
 * Every refusal that comes before the signature check uses this one response,
 * so the endpoint cannot be probed for which tokens exist, are paused, or
 * belong to a lapsed organisation.
 */
const notFound = () => new NotFoundException('Not found');

/**
 * Receives a POST to an automation's secret webhook address and starts a run
 * as the automation's owner.
 *
 * The request carries no identity: the token is the only credential, and the
 * body is untrusted. It is handed to the run wrapped as
 * `$trigger = { payload, receivedAt, contentType }`, so nothing in it can name
 * the actor, the owner or the tenant.
 */
@Injectable()
export class AutomationWebhookService {
  private readonly logger = new Logger(AutomationWebhookService.name);

  constructor(
    @InjectRepository(AutomationWorkflow)
    private readonly workflows: Repository<AutomationWorkflow>,
    private readonly automations: AutomationsService,
    private readonly billing: BillingService,
    private readonly tenantContext: TenantContextService,
    @Optional()
    @Inject(REDIS_CLIENT_TOKEN)
    private readonly redis: Redis | null,
  ) {}

  async receive(token: string, req: WebhookRequest): Promise<WebhookOutcome> {
    // Cheap shape check first: a malformed token never reaches the database.
    if (!WEBHOOK_TOKEN_RE.test(token)) throw notFound();

    // No tenant is known yet, so this one read bypasses row-level security.
    const wf = await this.tenantContext.runAsSystem(() =>
      this.workflows.findOne({ where: { webhookSlug: token } }),
    );
    if (!wf || wf.status !== 'ACTIVE' || wf.triggerType !== 'WEBHOOK') {
      throw notFound();
    }

    return this.tenantContext.runWithTenant(wf.tenantId, async () => {
      // Nobody is signed in, so BillingGuard let this through: a lapsed
      // organisation's automations stop receiving here instead.
      const { restricted } = await this.billing.restrictionFor(wf.tenantId);
      if (restricted) throw notFound();

      this.verifySignature(wf, req);
      await this.enforceRateLimit(token);
      const contentType = webhookContentType(req.contentType);
      const payload = parseBody(contentType, req.rawBody);
      const idempotencyKey = checkIdempotencyKey(req.idempotencyKey);

      const trigger = {
        payload,
        receivedAt: new Date().toISOString(),
        contentType,
      };

      try {
        await this.automations.triggerExecution(
          wf.tenantId,
          wf.id,
          trigger,
          undefined,
          {
            failOnStartError: true,
            ...(idempotencyKey
              ? { idempotencyKey: `webhook:${idempotencyKey}` }
              : {}),
          },
        );
      } catch (err: unknown) {
        // Deleted between the lookup and the start: same answer as unknown.
        if (err instanceof NotFoundException) throw notFound();
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Webhook run for automation ${wf.id} not started: ${msg}`,
        );
        throw new ServiceUnavailableException(
          'The automation could not start. Please try again.',
        );
      }

      const redirectUrl = httpsUrl(wf.triggerConfig?.redirectUrl);
      if (contentType === 'form' && redirectUrl) {
        return { kind: 'redirect', url: redirectUrl };
      }
      return { kind: 'accepted', contentType };
    });
  }

  private verifySignature(wf: AutomationWorkflow, req: WebhookRequest): void {
    if (wf.triggerConfig?.requireSignature !== true) return;
    const secret: unknown = wf.triggerConfig.signatureSecret;
    const match = SIGNATURE_RE.exec((req.signature ?? '').trim());
    if (typeof secret !== 'string' || !secret || !match) {
      throw new UnauthorizedException('Invalid signature');
    }
    const expected = createHmac('sha256', secret).update(req.rawBody).digest();
    const given = Buffer.from(match[1], 'hex');
    if (!timingSafeEqual(expected, given)) {
      throw new UnauthorizedException('Invalid signature');
    }
  }

  /**
   * 60 requests a minute per token, counted in Redis. If Redis cannot be
   * reached the request is let through with a warning: the global per-IP
   * throttle still applies, and refusing every webhook during a Redis outage
   * would lose the senders' data.
   */
  private async enforceRateLimit(token: string): Promise<void> {
    if (!this.redis) {
      this.logger.warn('Webhook rate limit unavailable: no Redis client');
      return;
    }
    let count: number;
    try {
      count = Number(
        await this.redis.eval(
          RATE_LIMIT_LUA,
          1,
          `automation:webhook:rl:${token}`,
          String(RATE_WINDOW_SECONDS),
        ),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Webhook rate limit unavailable, request allowed: ${msg}`,
      );
      return;
    }
    if (count > WEBHOOK_RATE_LIMIT) {
      throw new HttpException(
        {
          message: 'Too many requests to this webhook. Try again in a minute.',
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

function webhookContentType(header: string): WebhookContentType {
  const mediaType = header.split(';')[0].trim().toLowerCase();
  if (mediaType === 'application/json') return 'json';
  if (mediaType === 'application/x-www-form-urlencoded') return 'form';
  throw new UnsupportedMediaTypeException(
    'Send application/json or application/x-www-form-urlencoded',
  );
}

/**
 * JSON of any shape (object, array, scalar) is kept as sent. Form fields are
 * strings; a field sent more than once becomes a list of strings.
 */
function parseBody(contentType: WebhookContentType, raw: Buffer): unknown {
  const text = raw.toString('utf8');
  if (contentType === 'form') {
    const fields = new Map<string, string | string[]>();
    for (const [key, value] of new URLSearchParams(text)) {
      const seen = fields.get(key);
      fields.set(
        key,
        seen === undefined ? value : ([] as string[]).concat(seen, value),
      );
    }
    // fromEntries defines own properties, so a `__proto__` field stays data.
    return Object.fromEntries(fields);
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BadRequestException('The body is not valid JSON');
  }
}

function checkIdempotencyKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BadRequestException(
      `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    );
  }
  return key;
}

/** The configured redirect, only if it is https (also validated on save). */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}
