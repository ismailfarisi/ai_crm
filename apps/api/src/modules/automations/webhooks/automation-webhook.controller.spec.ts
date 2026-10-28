import { Body, Controller, Get, INestApplication, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { ClsModule } from 'nestjs-cls';
import { createHmac } from 'crypto';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '@/common/decorators';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { BillingService } from '../../billing/billing.service';
import { REDIS_CLIENT_TOKEN } from '../../ai/services/redis-budget-guard.service';
import { TemporalService } from '../../temporal/temporal.service';
import { AutomationsService } from '../automations.service';
import { AutomationSchedulesService } from '../schedules/automation-schedules.service';
import { AutomationWorkflow } from '../entities/automation-workflow.entity';
import { AutomationExecution } from '../entities/automation-execution.entity';
import { AutomationWebhookController } from './automation-webhook.controller';
import { AutomationWebhookService } from './automation-webhook.service';
import { configureCorsAndWebhookBodies } from './webhook-http';

const PREFIX = 'api/v1';
const WEB_ORIGIN = 'http://localhost:3000';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const tokenA = 'a'.repeat(43);
const tokenB = 'b'.repeat(43);
const url = (token: string) => `/${PREFIX}/automations/webhook/${token}`;

/** Any other API route, to show the global CORS policy is untouched. */
@Controller('ping')
class PingController {
  @Get()
  ping() {
    return { ok: true };
  }
  @Post()
  echo(@Body() body: unknown) {
    return body;
  }
}

function wf(overrides: Partial<AutomationWorkflow>): AutomationWorkflow {
  return {
    id: 'wf-a',
    tenantId: TENANT_A,
    name: 'Website form',
    description: null,
    status: 'ACTIVE',
    triggerType: 'WEBHOOK',
    triggerConfig: {},
    nodes: [],
    edges: [],
    webhookSlug: tokenA,
    activatedByUserId: 'owner-a',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const matches = (row: Record<string, any>, where: Record<string, any>) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

describe('AutomationWebhookController (HTTP)', () => {
  let app: INestApplication;
  let tenantContext: TenantContextService;
  let workflows: AutomationWorkflow[];
  let executions: AutomationExecution[];
  let starts: { workflowId: string; args: any[] }[];
  let startFailures: number;
  let redisCounts: Map<string, number>;
  let restricted: Set<string>;

  /** Row-level security as the API's NOBYPASSRLS role sees it. */
  const visible = (row: { tenantId: string }) =>
    tenantContext.isSystem() || tenantContext.getTenantId() === row.tenantId;

  const workflowRepo = {
    findOne: jest.fn(
      async ({ where }: { where: Record<string, any> }) =>
        workflows.find((w) => visible(w) && matches(w, where)) ?? null,
    ),
  };

  let nextExecId = 0;
  const executionRepo = {
    create: (dto: Partial<AutomationExecution>) =>
      ({ ...dto }) as AutomationExecution,
    findOne: async ({ where }: { where: Record<string, any> }) =>
      executions.find((e) => visible(e) && matches(e, where)) ?? null,
    save: async (row: AutomationExecution) => {
      if (!visible(row)) throw new Error('RLS: row outside tenant');
      if (!row.id) {
        const clash = executions.find(
          (e) =>
            row.idempotencyKey != null &&
            e.workflowId === row.workflowId &&
            e.idempotencyKey === row.idempotencyKey,
        );
        if (clash) {
          throw Object.assign(new Error('duplicate key'), {
            code: '23505',
            constraint: 'uq_automation_executions_idempotency_key',
          });
        }
        row.id = `exec-${++nextExecId}`;
        row.startedAt = new Date();
        executions.push(row);
      }
      return row;
    },
    update: async (
      where: Record<string, any>,
      patch: Partial<AutomationExecution>,
    ) => {
      for (const e of executions)
        if (matches(e, where)) Object.assign(e, patch);
      return { affected: 1 };
    },
  };

  const temporalClient = {
    workflow: {
      start: jest.fn(
        async (_fn: unknown, opts: { workflowId: string; args: any[] }) => {
          if (startFailures > 0) {
            startFailures--;
            throw new Error('Temporal offline');
          }
          if (starts.some((s) => s.workflowId === opts.workflowId)) {
            throw new WorkflowExecutionAlreadyStartedError(
              'already started',
              opts.workflowId,
              'dynamicDagWorkflow',
            );
          }
          starts.push({ workflowId: opts.workflowId, args: opts.args });
          return { workflowId: opts.workflowId };
        },
      ),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true })],
      controllers: [AutomationWebhookController, PingController],
      providers: [
        AutomationWebhookService,
        AutomationsService,
        TenantContextService,
        {
          provide: getRepositoryToken(AutomationWorkflow),
          useValue: workflowRepo,
        },
        {
          provide: getRepositoryToken(AutomationExecution),
          useValue: executionRepo,
        },
        {
          provide: TemporalService,
          useValue: { getClient: async () => temporalClient },
        },
        // Webhook runs never touch schedules.
        { provide: AutomationSchedulesService, useValue: {} },
        {
          provide: BillingService,
          useValue: {
            restrictionFor: async (tenantId: string) => ({
              restricted: restricted.has(tenantId),
              restrictsAt: null,
              reason: null,
            }),
          },
        },
        {
          provide: REDIS_CLIENT_TOKEN,
          useValue: {
            eval: async (_lua: string, _n: number, key: string) => {
              const n = (redisCounts.get(key) ?? 0) + 1;
              redisCounts.set(key, n);
              return n;
            },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
      logger: false,
    });
    app.setGlobalPrefix(PREFIX);
    // Exactly what main.ts installs.
    configureCorsAndWebhookBodies(app, PREFIX, {
      origin: [WEB_ORIGIN],
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    });
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    tenantContext = moduleRef.get(TenantContextService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    workflows = [
      wf({}),
      wf({
        id: 'wf-b',
        tenantId: TENANT_B,
        webhookSlug: tokenB,
        activatedByUserId: 'owner-b',
        triggerConfig: { redirectUrl: 'https://example.com/thanks' },
      }),
    ];
    executions = [];
    starts = [];
    startFailures = 0;
    redisCounts = new Map();
    restricted = new Set();
    workflowRepo.findOne.mockClear();
    temporalClient.workflow.start.mockClear();
  });

  const post = (token: string) => request(app.getHttpServer()).post(url(token));

  it('is a public route', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(
        IS_PUBLIC_KEY,
        AutomationWebhookController.prototype.receive,
      ),
    ).toBe(true);
  });

  describe('not found', () => {
    it('refuses a badly shaped token with 404 before any lookup', async () => {
      const res = await post('wh_1700000000000_abcde').send({ a: 1 });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        statusCode: 404,
        message: 'Not found',
        error: 'Not Found',
      });
      expect(workflowRepo.findOne).not.toHaveBeenCalled();
    });

    it('gives unknown, draft, paused, non-webhook and billing-restricted the byte-identical 404', async () => {
      const bodies: string[] = [];
      bodies.push((await post('A'.repeat(43)).send({ a: 1 })).text);
      bodies.push((await post('-'.repeat(43)).send({ a: 1 })).text);

      workflows[0].status = 'DRAFT';
      bodies.push((await post(tokenA).send({ a: 1 })).text);
      workflows[0].status = 'PAUSED';
      bodies.push((await post(tokenA).send({ a: 1 })).text);
      workflows[0].status = 'ACTIVE';
      workflows[0].triggerType = 'MANUAL';
      bodies.push((await post(tokenA).send({ a: 1 })).text);
      workflows[0].triggerType = 'WEBHOOK';
      restricted.add(TENANT_A);
      bodies.push((await post(tokenA).send({ a: 1 })).text);

      expect(new Set(bodies)).toEqual(
        new Set([
          '{"statusCode":404,"message":"Not found","error":"Not Found"}',
        ]),
      );
      expect(executions).toHaveLength(0);
      expect(starts).toHaveLength(0);
    });
  });

  describe('accepted', () => {
    it('answers a JSON post with 202 and starts a run as the owner inside the tenant', async () => {
      const res = await post(tokenA).send({
        name: 'Ada',
        event: { actorUserId: 'x' },
      });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ accepted: true });
      expect(executions).toHaveLength(1);
      expect(executions[0].tenantId).toBe(TENANT_A);
      expect(starts).toHaveLength(1);
      const [input] = starts[0].args;
      expect(input.tenantId).toBe(TENANT_A);
      expect(input.ownerUserId).toBe('owner-a');
      expect(input).not.toHaveProperty('actorUserId');
      expect(input.triggerPayload).toEqual({
        payload: { name: 'Ada', event: { actorUserId: 'x' } },
        receivedAt: expect.any(String),
        contentType: 'json',
      });
    });

    it.each([
      ['an array', '[1,2]', [1, 2]],
      ['a string', '"x"', 'x'],
    ])('accepts %s body as the payload', async (_label, raw, expected) => {
      const res = await post(tokenA)
        .set('Content-Type', 'application/json')
        .send(raw);
      expect(res.status).toBe(202);
      expect(starts[0].args[0].triggerPayload.payload).toEqual(expected);
    });

    it('answers a form post with plain text when no redirect is set', async () => {
      const res = await post(tokenA).type('form').send('name=Ada&age=36');
      expect(res.status).toBe(202);
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
      expect(res.text).toBe('Thanks, received.');
      expect(starts[0].args[0].triggerPayload).toMatchObject({
        payload: { name: 'Ada', age: '36' },
        contentType: 'form',
      });
    });

    it('redirects a form post with 303 to the configured address', async () => {
      const res = await post(tokenB).type('form').send('name=Ada');
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('https://example.com/thanks');
      expect(starts).toHaveLength(1);
      expect(starts[0].args[0].ownerUserId).toBe('owner-b');
    });
  });

  describe('refused', () => {
    it('refuses text/plain with 415', async () => {
      const res = await post(tokenA)
        .set('Content-Type', 'text/plain')
        .send('hello');
      expect(res.status).toBe(415);
      expect(starts).toHaveLength(0);
    });

    it('refuses a body over 100 KB with 413 and accepts one of exactly 100 KB', async () => {
      const filler = (n: number) => `{"x":"${'a'.repeat(n - 8)}"}`;
      expect(Buffer.byteLength(filler(100 * 1024))).toBe(100 * 1024);

      const big = await post(tokenA)
        .set('Content-Type', 'application/json')
        .send(filler(100 * 1024 + 1));
      expect(big.status).toBe(413);
      expect(starts).toHaveLength(0);

      const ok = await post(tokenA)
        .set('Content-Type', 'application/json')
        .send(filler(100 * 1024));
      expect(ok.status).toBe(202);
    });

    it('enforces a required signature: missing 401, wrong 401, right 202', async () => {
      workflows[0].triggerConfig = {
        requireSignature: true,
        signatureSecret: 's3cret',
      };
      const raw = '{"a":1}';
      const sig = (secret: string) =>
        `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

      const missing = await post(tokenA)
        .set('Content-Type', 'application/json')
        .send(raw);
      const wrong = await post(tokenA)
        .set('Content-Type', 'application/json')
        .set('X-Kerf-Signature', sig('other'))
        .send(raw);
      const right = await post(tokenA)
        .set('Content-Type', 'application/json')
        .set('X-Kerf-Signature', sig('s3cret'))
        .send(raw);

      expect([missing.status, wrong.status, right.status]).toEqual([
        401, 401, 202,
      ]);
      expect(starts).toHaveLength(1);
    });

    it('refuses the 61st request in a minute with 429', async () => {
      for (let i = 0; i < 60; i++) {
        const res = await post(tokenA).send({ i });
        expect(res.status).toBe(202);
      }
      const res = await post(tokenA).send({ i: 61 });
      expect(res.status).toBe(429);
      expect(starts).toHaveLength(60);
      // Another automation has its own budget.
      expect((await post(tokenB).send({})).status).toBe(202);
    });
  });

  describe('Idempotency-Key', () => {
    it('starts one run for the same key sent twice', async () => {
      const first = await post(tokenA)
        .set('Idempotency-Key', 'order-42')
        .send({ n: 1 });
      const second = await post(tokenA)
        .set('Idempotency-Key', 'order-42')
        .send({ n: 2 });
      expect([first.status, second.status]).toEqual([202, 202]);
      expect(executions).toHaveLength(1);
      expect(starts).toHaveLength(1);
      expect(starts[0].args[0].triggerPayload.payload).toEqual({ n: 1 });
    });

    it('keeps keys separate per automation', async () => {
      await post(tokenA).set('Idempotency-Key', 'order-42').send({});
      await post(tokenB).set('Idempotency-Key', 'order-42').send({});
      expect(executions).toHaveLength(2);
      expect(starts.map((s) => s.args[0].workflowId).sort()).toEqual([
        'wf-a',
        'wf-b',
      ]);
    });

    it('answers 503 when the run cannot start, and a retry with the same key resumes that execution', async () => {
      startFailures = 1;
      const failed = await post(tokenA)
        .set('Idempotency-Key', 'order-43')
        .send({ n: 1 });
      expect(failed.status).toBe(503);
      expect(executions).toHaveLength(1);
      expect(executions[0].status).toBe('FAILED');
      const id = executions[0].id;

      const retried = await post(tokenA)
        .set('Idempotency-Key', 'order-43')
        .send({ n: 1 });
      expect(retried.status).toBe(202);
      expect(executions).toHaveLength(1);
      expect(executions[0]).toMatchObject({ id, status: 'RUNNING' });
      expect(starts).toHaveLength(1);
      expect(starts[0].args[0].executionId).toBe(id);
    });

    it('answers 503 without a key too, leaving the execution FAILED', async () => {
      startFailures = 1;
      const res = await post(tokenA).send({});
      expect(res.status).toBe(503);
      expect(executions.map((e) => e.status)).toEqual(['FAILED']);
    });
  });

  describe('CORS', () => {
    it('allows a preflight from any origin, without credentials', async () => {
      const res = await request(app.getHttpServer())
        .options(url(tokenA))
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,idempotency-key');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
      expect(res.headers['access-control-allow-methods']).toBe('POST,OPTIONS');
      expect(res.headers['access-control-allow-headers']).toMatch(
        /Idempotency-Key/i,
      );
    });

    it('allows the cross-origin POST itself', async () => {
      const res = await post(tokenA)
        .set('Origin', 'https://example.com')
        .send({});
      expect(res.status).toBe(202);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('leaves every other route on the web-origin policy', async () => {
      const foreign = await request(app.getHttpServer())
        .options(`/${PREFIX}/ping`)
        .set('Origin', 'https://example.com')
        .set('Access-Control-Request-Method', 'POST');
      expect(foreign.headers['access-control-allow-origin']).toBeUndefined();

      const own = await request(app.getHttpServer())
        .get(`/${PREFIX}/ping`)
        .set('Origin', WEB_ORIGIN);
      expect(own.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
      expect(own.headers['access-control-allow-credentials']).toBe('true');
    });

    it('still parses JSON normally on other routes', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/ping`)
        .send({ a: 1 });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ a: 1 });
    });
  });
});
