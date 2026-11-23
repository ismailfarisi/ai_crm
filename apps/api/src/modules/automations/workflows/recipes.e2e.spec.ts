/**
 * Every ready-made recipe, exactly as the gallery creates it
 * (`recipes.fixture.json`, written by the web app's recipes-fixture.spec.ts),
 * run through the real workflow and the real steps with its event's sample
 * payload. Only the edges of the system are stubbed: Temporal's timers, the
 * database, the mailer, the model and the notification store.
 */
jest.mock('@temporalio/workflow', () => {
  const actual = jest.requireActual('@temporalio/workflow');
  return {
    ActivityFailure: actual.ActivityFailure,
    ApplicationFailure: actual.ApplicationFailure,
    CancelledFailure: actual.CancelledFailure,
    ChildWorkflowFailure: actual.ChildWorkflowFailure,
    isCancellation: actual.isCancellation,
    CancellationScope: { nonCancellable: (fn: () => Promise<unknown>) => fn() },
    patched: () => true,
    log: { warn: jest.fn() },
    uuid4: () => 'uuid',
    proxyActivities: () =>
      new Proxy(
        {},
        {
          get:
            (_target, name: string) =>
            (...args: unknown[]) =>
              (global as any).__recipeActivities[name](...args),
        },
      ),
    setHandler: jest.fn(),
    condition: jest.fn(async (predicate: () => boolean) => predicate()),
    sleep: (...args: unknown[]) => (global as any).__recipeSleep(...args),
    defineSignal: (name: string) => ({ name, type: 'signal' }),
    defineQuery: (name: string) => ({ name, type: 'query' }),
    executeChild: jest.fn(),
    getExternalWorkflowHandle: () => ({ signal: jest.fn() }),
    workflowInfo: () => ({ workflowId: 'parent-workflow' }),
  };
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTOMATION_NOTIFY_GROUPS,
  AUTOMATION_PERMISSIONS,
  PERMISSIONS,
  SHOP_EVENTS,
  type AutomationEdge,
  type AutomationNode,
} from '@saas/shared';
import { dynamicDagWorkflow } from './dynamic-dag.workflow';
import { createAutomationActions } from './automation-actions';
import { createShopActions } from './shop-actions';
import { Quote } from '@/modules/quotes/entities/quote.entity';
import { QuoteProof } from '@/modules/quotes/entities/quote-proof.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';

interface Recipe {
  id: string;
  aiEmailToCustomers: boolean;
  triggerType: string;
  trigger: { payload?: Record<string, unknown> } & Record<string, unknown>;
  nodes: AutomationNode[];
  edges: AutomationEdge[];
}

const recipes = JSON.parse(
  readFileSync(join(__dirname, 'recipes.fixture.json'), 'utf8'),
) as Recipe[];

const TENANT = 'tenant-1';
const TEAM_EMAIL = 'owner@shop.ae';
const AI_TEXT = 'Dear customer, invoice INV-2026-0211 is overdue.';

function world(options: { customerAnswered?: boolean } = {}) {
  const mail = {
    name: 'console',
    sendMail: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = {
    notifyHolders: jest.fn().mockResolvedValue(2),
    notifyUsers: jest.fn().mockResolvedValue(1),
  };
  const sleep = jest.fn().mockResolvedValue(undefined);
  const waiting = !options.customerAnswered;
  const repo = (entity: unknown) => ({
    findOne: jest.fn(() => {
      if (entity === Quote) {
        return Promise.resolve({
          id: 'quote-1',
          tenantId: TENANT,
          quoteNumber: 'Q-2026-0142',
          title: '5,000 printed cake boxes',
          customerName: 'Al Noor Bakery',
          customerEmail: 'orders@alnoorbakery.ae',
          totalAmount: '18375.00',
          currency: 'AED',
          status: 'APPROVED',
          acceptanceExpiresAt: null,
          acceptedAt: waiting ? null : new Date(),
          supersededAt: null,
          customerResponse: null,
          validUntil: null,
        });
      }
      if (entity === QuoteProof) {
        return Promise.resolve({
          id: 'proof-1',
          quoteId: 'quote-1',
          version: 1,
          status: waiting ? 'PENDING' : 'APPROVED',
          supersededAt: null,
        });
      }
      if (entity === Organization) {
        return Promise.resolve({ id: TENANT, baseCurrency: 'AED' });
      }
      return Promise.resolve(null);
    }),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(3),
    createQueryBuilder: () => {
      const builder = {
        select: () => builder,
        where: () => builder,
        andWhere: () => builder,
        getRawOne: () => Promise.resolve({ sum: '1200' }),
      };
      return builder;
    },
  });

  const shared = {
    users: {
      findMember: jest.fn().mockResolvedValue({
        id: 'owner-1',
        tenantId: TENANT,
        email: TEAM_EMAIL,
        firstName: 'Omar',
        lastName: 'Owner',
        isActive: true,
      }),
      findActiveEmails: jest.fn().mockResolvedValue([TEAM_EMAIL]),
    },
    rbac: {
      resolveAccess: jest.fn().mockResolvedValue({
        roles: [],
        permissions: [
          ...Object.values(PERMISSIONS),
          ...Object.values(AUTOMATION_PERMISSIONS),
        ],
      }),
    },
    audit: { record: jest.fn().mockResolvedValue(undefined) },
    tenantContext: {
      runAsAutomation: (_t: string, _e: string, fn: () => unknown) => fn(),
    },
    idempotency: {
      runOnce: (_t: string, _k: string, fn: () => unknown) => fn(),
    },
  };
  const ai = {
    isConfigured: jest.fn().mockResolvedValue(true),
    generateText: jest.fn().mockResolvedValue({
      text: AI_TEXT,
      usage: { inputTokens: 10, outputTokens: 10 },
    }),
    getBudgetStatus: jest.fn(),
  };
  const activities = {
    ...createAutomationActions({
      ...shared,
      mail,
      ai,
      contacts: {},
      quotes: {},
    } as never),
    ...createShopActions({
      ...shared,
      dataSource: { getRepository: repo },
      channels: { sendMessage: jest.fn() },
      notifications,
    } as never),
    recordNodeResultActivity: jest.fn().mockResolvedValue({ recorded: true }),
    recordRunFinishedActivity: jest.fn().mockResolvedValue(undefined),
  };
  (global as any).__recipeActivities = activities;
  (global as any).__recipeSleep = sleep;
  return { mail, notifications, sleep, ai };
}

async function run(recipe: Recipe, options: { testRun?: boolean } = {}) {
  return dynamicDagWorkflow({
    executionId: `exec-${recipe.id}`,
    workflowId: `wf-${recipe.id}`,
    workflowName: recipe.id,
    tenantId: TENANT,
    ownerUserId: 'owner-1',
    nodes: recipe.nodes,
    edges: recipe.edges,
    triggerPayload: recipe.trigger,
    triggerType: recipe.triggerType as never,
    ...options,
  });
}

/** Nothing a person reads may carry an unfilled placeholder. */
function expectFilledIn(text: unknown) {
  expect(typeof text).toBe('string');
  expect(text).not.toMatch(/\{\{|\}\}|undefined|\[object/);
  expect((text as string).trim().length).toBeGreaterThan(0);
}

describe('ready-made recipes, end to end', () => {
  it('has a recipe for each thing asked for', () => {
    expect(recipes.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        'quote-follow-up',
        'deposit-paid-start-job',
        'proof-reminder',
        'order-ready-customer',
        'stock-low-buyer',
        'invoice-overdue-reminder',
        'daily-summary',
      ]),
    );
  });

  it('starts only from events the API publishes', () => {
    const published = new Set<string>([
      ...SHOP_EVENTS.map((event) => event.value),
      // Published before the shop events existed.
      'quote.accepted',
      'invoice.overdue',
    ]);
    for (const recipe of recipes) {
      if (recipe.triggerType !== 'CRM_EVENT') continue;
      expect(published).toContain(recipe.trigger.eventType);
    }
  });

  describe.each(
    recipes.map(
      (r) =>
        [`${r.id}${r.aiEmailToCustomers ? ' (to customers)' : ''}`, r] as const,
    ),
  )('%s', (_name, recipe) => {
    it('runs every step and reaches someone with a filled-in message', async () => {
      const { mail, notifications, ai } = world();
      ai.getBudgetStatus.mockResolvedValue({
        automationAiEmailToCustomers: recipe.aiEmailToCustomers,
      });

      const state = await run(recipe);

      expect(state.errorMessage ?? null).toBeNull();
      expect(state.status).toBe('COMPLETED');
      for (const node of recipe.nodes) {
        expect(state.nodeResults[node.id]?.status).toBe('SUCCESS');
      }

      const emails = mail.sendMail.mock.calls.map(
        ([m]) => m as { to: string; subject: string; text: string },
      );
      const alerts = notifications.notifyHolders.mock.calls;
      expect(emails.length + alerts.length).toBeGreaterThan(0);

      for (const email of emails) {
        expectFilledIn(email.to);
        expectFilledIn(email.subject);
        expectFilledIn(email.text);
      }
      for (const [tenantId, permission, input] of alerts) {
        expect(tenantId).toBe(TENANT);
        expect(AUTOMATION_NOTIFY_GROUPS.map((g) => g.permission)).toContain(
          permission,
        );
        // An alert about something Kerf already alerts on is filed with
        // that alert, against the same record, so nobody gets two.
        const joinsBuiltIn =
          /^(quote|proof)\.(changes_requested|declined|approved)$/.test(
            recipe.trigger.eventType,
          );
        expect(input.type).toBe(
          !joinsBuiltIn
            ? 'AUTOMATION'
            : recipe.trigger.eventType.startsWith('proof.')
              ? 'QUOTE_PROOF_RESPONSE'
              : 'QUOTE_CUSTOMER_RESPONSE',
        );
        expect(Boolean(input.entityId)).toBe(joinsBuiltIn);
        expectFilledIn(input.title);
        expectFilledIn(input.body);
        expect(input.link).toMatch(/^\/[a-z]/);
        expectFilledIn(input.link);
      }
    });
  });

  it.each(['quote-follow-up', 'proof-reminder'])(
    '%s waits, then says nothing if the customer has answered meanwhile',
    async (id) => {
      const recipe = recipes.find((r) => r.id === id)!;
      const { mail, sleep } = world({ customerAnswered: true });
      const state = await run(recipe);
      expect(state.status).toBe('COMPLETED');
      expect(sleep).toHaveBeenCalledWith(
        id === 'quote-follow-up' ? '3 days' : '2 days',
      );
      expect(state.nodeResults['check-1'].output).toEqual({ result: false });
      expect(mail.sendMail).not.toHaveBeenCalled();
    },
  );

  it('a test run skips the wait and still shows what would be sent', async () => {
    const recipe = recipes.find((r) => r.id === 'quote-follow-up')!;
    const { mail, sleep } = world();
    const state = await run(recipe, { testRun: true });
    expect(sleep).not.toHaveBeenCalled();
    expect(state.nodeResults['delay-1'].output).toEqual({
      delayed: false,
      skippedInTestRun: true,
      duration: '3 days',
    });
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    expect(mail.sendMail.mock.calls[0][0].to).toBe('orders@alnoorbakery.ae');
  });

  it('a test run tells the steps it is one, so a look-up of the invented record can answer', async () => {
    const recipe = recipes.find((r) => r.id === 'quote-follow-up')!;
    world();
    const state = await run(recipe, { testRun: true });
    expect(state.nodeResults['lookup-1'].output).toMatchObject({
      sampleRecord: true,
      awaitingCustomer: true,
    });
  });

  it('the overdue reminder keeps AI text inside the team unless the organisation allows customers', async () => {
    const [toTeam, toCustomer] = recipes.filter(
      (r) => r.id === 'invoice-overdue-reminder',
    );
    let w = world();
    w.ai.getBudgetStatus.mockResolvedValue({
      automationAiEmailToCustomers: false,
    });
    await run(toTeam);
    expect(w.mail.sendMail.mock.calls[0][0].to).toBe(TEAM_EMAIL);

    // The customer variant with the setting off is refused by the email step.
    w = world();
    w.ai.getBudgetStatus.mockResolvedValue({
      automationAiEmailToCustomers: false,
    });
    const refused = await run(toCustomer).catch((err: Error) => err);
    expect(w.mail.sendMail).not.toHaveBeenCalled();
    expect(refused instanceof Error || refused.status === 'FAILED').toBe(true);
  });

  it('the morning summary emails the numbers', async () => {
    const recipe = recipes.find((r) => r.id === 'daily-summary')!;
    const { mail } = world();
    await run(recipe);
    const email = mail.sendMail.mock.calls[0][0];
    expect(email.to).toBe(TEAM_EMAIL);
    expect(email.text).toContain('Quotes waiting on customers: 3');
    expect(email.text).toContain('Payments received yesterday: AED 1,200.00');
  });
});
