import {
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsModule } from 'nestjs-cls';
import { createHash, createHmac } from 'crypto';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { BillingService } from '../../billing/billing.service';
import { REDIS_CLIENT_TOKEN } from '../../ai/services/redis-budget-guard.service';
import { AutomationsService } from '../automations.service';
import { AutomationWorkflow } from '../entities/automation-workflow.entity';
import { AutomationWebhookService } from './automation-webhook.service';

const TOKEN = 'A'.repeat(43);
const TENANT = '11111111-1111-1111-1111-111111111111';

function workflow(
  overrides: Partial<AutomationWorkflow> = {},
): AutomationWorkflow {
  return {
    id: 'wf-1',
    tenantId: TENANT,
    name: 'Website form',
    description: null,
    status: 'ACTIVE',
    triggerType: 'WEBHOOK',
    triggerConfig: {},
    nodes: [],
    edges: [],
    webhookSlug: TOKEN,
    activatedByUserId: 'owner-1',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const json = (body: unknown) => ({
  contentType: 'application/json',
  rawBody: Buffer.from(JSON.stringify(body)),
});

describe('AutomationWebhookService', () => {
  let service: AutomationWebhookService;
  let tenantContext: TenantContextService;
  let workflows: { findOne: jest.Mock };
  let automations: { triggerExecution: jest.Mock };
  let billing: { restrictionFor: jest.Mock };
  let redis: { eval: jest.Mock } | null;
  let contextAtLookup: { system: boolean; tenant: string | null }[];
  let contextAtTrigger: { system: boolean; tenant: string | null }[];

  async function build(): Promise<void> {
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true })],
      providers: [
        AutomationWebhookService,
        TenantContextService,
        {
          provide: getRepositoryToken(AutomationWorkflow),
          useValue: workflows,
        },
        { provide: AutomationsService, useValue: automations },
        { provide: BillingService, useValue: billing },
        { provide: REDIS_CLIENT_TOKEN, useValue: redis },
      ],
    }).compile();
    service = moduleRef.get(AutomationWebhookService);
    tenantContext = moduleRef.get(TenantContextService);
  }

  beforeEach(async () => {
    contextAtLookup = [];
    contextAtTrigger = [];
    workflows = {
      findOne: jest.fn(async () => {
        contextAtLookup.push({
          system: tenantContext.isSystem(),
          tenant: tenantContext.getTenantId(),
        });
        return workflow();
      }),
    };
    automations = {
      triggerExecution: jest.fn(async () => {
        contextAtTrigger.push({
          system: tenantContext.isSystem(),
          tenant: tenantContext.getTenantId(),
        });
        return { id: 'exec-1' };
      }),
    };
    billing = {
      restrictionFor: jest.fn().mockResolvedValue({
        restricted: false,
        restrictsAt: null,
        reason: null,
      }),
    };
    redis = { eval: jest.fn().mockResolvedValue(1) };
    await build();
  });

  async function notFoundBody(promise: Promise<unknown>): Promise<unknown> {
    const err = await promise.then(
      () => {
        throw new Error('expected a 404');
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(NotFoundException);
    return (err as NotFoundException).getResponse();
  }

  describe('refusals before the signature check', () => {
    it.each([
      ['too short', 'A'.repeat(42)],
      ['too long', 'A'.repeat(44)],
      ['outside base64url', `${'A'.repeat(42)}=`],
      ['an old-format slug', 'wh_1700000000000_abcde'],
      ['empty', ''],
    ])(
      'a token that is %s is refused without touching the database',
      async (_label, token) => {
        const body = await notFoundBody(service.receive(token, json({})));
        expect(body).toEqual(new NotFoundException('Not found').getResponse());
        expect(workflows.findOne).not.toHaveBeenCalled();
        expect(billing.restrictionFor).not.toHaveBeenCalled();
        expect(redis!.eval).not.toHaveBeenCalled();
      },
    );

    it('looks the token up as the system, outside any tenant', async () => {
      await service.receive(TOKEN, json({}));
      expect(workflows.findOne).toHaveBeenCalledWith({
        where: { webhookSlug: TOKEN },
      });
      expect(contextAtLookup).toEqual([{ system: true, tenant: null }]);
    });

    it('answers unknown, draft, paused, non-webhook and billing-restricted with the same 404 and no run', async () => {
      const bodies: unknown[] = [];

      workflows.findOne.mockResolvedValueOnce(null);
      bodies.push(await notFoundBody(service.receive(TOKEN, json({}))));

      workflows.findOne.mockResolvedValueOnce(workflow({ status: 'DRAFT' }));
      bodies.push(await notFoundBody(service.receive(TOKEN, json({}))));

      workflows.findOne.mockResolvedValueOnce(workflow({ status: 'PAUSED' }));
      bodies.push(await notFoundBody(service.receive(TOKEN, json({}))));

      workflows.findOne.mockResolvedValueOnce(
        workflow({ triggerType: 'SCHEDULE' }),
      );
      bodies.push(await notFoundBody(service.receive(TOKEN, json({}))));

      billing.restrictionFor.mockResolvedValueOnce({
        restricted: true,
        restrictsAt: new Date(),
        reason: 'past_due',
      });
      bodies.push(await notFoundBody(service.receive(TOKEN, json({}))));

      expect(bodies).toHaveLength(5);
      for (const b of bodies) {
        expect(JSON.stringify(b)).toBe(JSON.stringify(bodies[0]));
      }
      expect(bodies[0]).toMatchObject({ message: 'Not found' });
      expect(billing.restrictionFor).toHaveBeenCalledWith(TENANT);
      expect(automations.triggerExecution).not.toHaveBeenCalled();
    });

    it('refuses an unknown token with 404 even when the content type is wrong', async () => {
      workflows.findOne.mockResolvedValueOnce(null);
      await expect(
        service.receive(TOKEN, {
          contentType: 'text/plain',
          rawBody: Buffer.from('x'),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('starting the run', () => {
    it('starts the run inside the workflow tenant, as the owner, with the body wrapped in $trigger', async () => {
      const before = Date.now();
      const out = await service.receive(TOKEN, json({ name: 'Ada' }));

      expect(out).toEqual({ kind: 'accepted', contentType: 'json' });
      expect(contextAtTrigger).toEqual([{ system: false, tenant: TENANT }]);
      const [tenantId, workflowId, trigger, actor, options] =
        automations.triggerExecution.mock.calls[0];
      expect(tenantId).toBe(TENANT);
      expect(workflowId).toBe('wf-1');
      expect(actor).toBeUndefined();
      expect(options).toEqual({
        failOnStartError: true,
        triggerSource: 'webhook',
      });
      expect(Object.keys(trigger).sort()).toEqual([
        'contentType',
        'payload',
        'receivedAt',
      ]);
      expect(trigger.payload).toEqual({ name: 'Ada' });
      expect(trigger.contentType).toBe('json');
      expect(Date.parse(trigger.receivedAt)).toBeGreaterThanOrEqual(before - 1);
      expect(new Date(trigger.receivedAt).toISOString()).toBe(
        trigger.receivedAt,
      );
    });

    it('a body naming an actor cannot select one', async () => {
      await service.receive(TOKEN, json({ event: { actorUserId: 'x' } }));
      const [, , trigger, actor] = automations.triggerExecution.mock.calls[0];
      expect(actor).toBeUndefined();
      expect(trigger.event).toBeUndefined();
      expect(trigger.payload).toEqual({ event: { actorUserId: 'x' } });
    });

    it.each([
      ['an array', [1, 2]],
      ['a string', 'x'],
      ['a number', 42],
      ['null', null],
    ])('accepts %s as the payload, stored as-is', async (_label, body) => {
      await service.receive(TOKEN, json(body));
      expect(automations.triggerExecution.mock.calls[0][2].payload).toEqual(
        body,
      );
    });

    it('treats an empty JSON body as an empty object', async () => {
      await service.receive(TOKEN, {
        contentType: 'application/json; charset=utf-8',
        rawBody: Buffer.alloc(0),
      });
      expect(automations.triggerExecution.mock.calls[0][2].payload).toEqual({});
    });

    it('rejects malformed JSON with 400', async () => {
      await expect(
        service.receive(TOKEN, {
          contentType: 'application/json',
          rawBody: Buffer.from('{"a":'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(automations.triggerExecution).not.toHaveBeenCalled();
    });

    it('turns a form body into strings, repeated fields into lists', async () => {
      const out = await service.receive(TOKEN, {
        contentType: 'application/x-www-form-urlencoded',
        rawBody: Buffer.from(
          'name=Ada+Lovelace&age=36&topic=a&topic=b&__proto__=x&note=%E2%9C%93',
        ),
      });
      expect(out).toEqual({ kind: 'accepted', contentType: 'form' });
      const trigger = automations.triggerExecution.mock.calls[0][2];
      expect(trigger.contentType).toBe('form');
      expect(trigger.payload).toEqual({
        name: 'Ada Lovelace',
        age: '36',
        topic: ['a', 'b'],
        ['__proto__']: 'x',
        note: '✓',
      });
      expect(Object.getPrototypeOf(trigger.payload)).toBe(Object.prototype);
    });

    it('redirects a form post to the configured https address', async () => {
      workflows.findOne.mockResolvedValueOnce(
        workflow({
          triggerConfig: { redirectUrl: 'https://example.com/thanks' },
        }),
      );
      const out = await service.receive(TOKEN, {
        contentType: 'application/x-www-form-urlencoded',
        rawBody: Buffer.from('a=1'),
      });
      expect(out).toEqual({
        kind: 'redirect',
        url: 'https://example.com/thanks',
      });
    });

    it('does not redirect a JSON post, nor to a non-https address', async () => {
      workflows.findOne.mockResolvedValue(
        workflow({
          triggerConfig: { redirectUrl: 'https://example.com/thanks' },
        }),
      );
      expect(await service.receive(TOKEN, json({}))).toEqual({
        kind: 'accepted',
        contentType: 'json',
      });
      workflows.findOne.mockResolvedValue(
        workflow({
          triggerConfig: { redirectUrl: 'http://example.com/thanks' },
        }),
      );
      expect(
        await service.receive(TOKEN, {
          contentType: 'application/x-www-form-urlencoded',
          rawBody: Buffer.from('a=1'),
        }),
      ).toEqual({ kind: 'accepted', contentType: 'form' });
    });

    it('refuses other content types with 415', async () => {
      for (const contentType of [
        'text/plain',
        'multipart/form-data; boundary=x',
        '',
      ]) {
        await expect(
          service.receive(TOKEN, { contentType, rawBody: Buffer.from('a') }),
        ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
      }
      expect(automations.triggerExecution).not.toHaveBeenCalled();
    });

    it('scopes the Idempotency-Key to webhooks, and refuses one over 200 characters', async () => {
      await service.receive(TOKEN, {
        ...json({}),
        idempotencyKey: 'k'.repeat(200),
      });
      expect(automations.triggerExecution.mock.calls[0][4]).toEqual({
        failOnStartError: true,
        triggerSource: 'webhook',
        idempotencyKey: `webhook:${'k'.repeat(200)}`,
      });

      await expect(
        service.receive(TOKEN, {
          ...json({}),
          idempotencyKey: 'k'.repeat(201),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(automations.triggerExecution).toHaveBeenCalledTimes(1);
    });

    it('answers 503 when the run cannot start', async () => {
      automations.triggerExecution.mockRejectedValueOnce(
        new Error('Temporal offline'),
      );
      await expect(service.receive(TOKEN, json({}))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('answers the same 404 if the automation vanished before the run started', async () => {
      automations.triggerExecution.mockRejectedValueOnce(
        new NotFoundException('Workflow wf-1 not found'),
      );
      const body = await notFoundBody(service.receive(TOKEN, json({})));
      expect(body).toEqual(new NotFoundException('Not found').getResponse());
    });
  });

  describe('signature', () => {
    const secret = 'top-secret';
    const signed = { requireSignature: true, signatureSecret: secret };
    const raw = Buffer.from('{"a":1}');
    const sign = (s: string, body: Buffer) =>
      `sha256=${createHmac('sha256', s).update(body).digest('hex')}`;

    beforeEach(() => {
      workflows.findOne.mockResolvedValue(workflow({ triggerConfig: signed }));
    });

    it.each([
      ['missing', undefined],
      ['signed with another secret', sign('other', raw)],
      ['over another body', sign(secret, Buffer.from('{"a":2}'))],
      ['without the sha256= prefix', sign(secret, raw).slice(7)],
      ['truncated', sign(secret, raw).slice(0, -2)],
      ['not hex', `sha256=${'z'.repeat(64)}`],
    ])(
      'refuses a signature that is %s with 401 and no run',
      async (_label, signature) => {
        await expect(
          service.receive(TOKEN, {
            contentType: 'application/json',
            rawBody: raw,
            signature,
          }),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect(automations.triggerExecution).not.toHaveBeenCalled();
      },
    );

    it('accepts the right signature, in either hex case', async () => {
      await service.receive(TOKEN, {
        contentType: 'application/json',
        rawBody: raw,
        signature: sign(secret, raw),
      });
      await service.receive(TOKEN, {
        contentType: 'application/json',
        rawBody: raw,
        signature: `sha256=${sign(secret, raw).slice(7).toUpperCase()}`,
      });
      expect(automations.triggerExecution).toHaveBeenCalledTimes(2);
    });

    it('checks the signature before the content type and the rate limit', async () => {
      await expect(
        service.receive(TOKEN, { contentType: 'text/plain', rawBody: raw }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(redis!.eval).not.toHaveBeenCalled();
    });

    it('refuses when a signature is required but no secret is stored', async () => {
      workflows.findOne.mockResolvedValue(
        workflow({ triggerConfig: { requireSignature: true } }),
      );
      await expect(
        service.receive(TOKEN, {
          contentType: 'application/json',
          rawBody: raw,
          signature: sign('', raw),
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('rate limit', () => {
    it('counts per token in a 60-second window and refuses the 61st with 429', async () => {
      redis!.eval.mockResolvedValueOnce(60);
      await service.receive(TOKEN, json({}));
      // Keyed on a hash of the token: the token itself never sits in Redis.
      const hashed = createHash('sha256').update(TOKEN).digest('hex');
      expect(redis!.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'),
        1,
        `automation:webhook:rl:${hashed}`,
        '60',
      );
      expect(JSON.stringify(redis!.eval.mock.calls)).not.toContain(TOKEN);

      redis!.eval.mockResolvedValueOnce(61);
      const err = await service
        .receive(TOKEN, json({}))
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(429);
      expect(automations.triggerExecution).toHaveBeenCalledTimes(1);
    });

    it('lets the request through with a warning when Redis fails', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      redis!.eval.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
      await expect(service.receive(TOKEN, json({}))).resolves.toEqual({
        kind: 'accepted',
        contentType: 'json',
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('rate limit unavailable'),
      );
      warn.mockRestore();
    });

    it('lets the request through with a warning when no Redis client is configured', async () => {
      redis = null;
      await build();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await expect(service.receive(TOKEN, json({}))).resolves.toMatchObject({
        kind: 'accepted',
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('rate limit unavailable'),
      );
      warn.mockRestore();
    });
  });
});
