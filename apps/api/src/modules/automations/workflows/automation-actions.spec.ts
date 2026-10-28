import { ApplicationFailure } from '@temporalio/activity';
import { AUTOMATION_PERMISSIONS, PERMISSIONS } from '@saas/shared';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  createAutomationActions,
  resolveOwner,
  type AutomationActionDeps,
} from './automation-actions';
import { AiBudgetExceededException } from '@/modules/ai/exceptions/ai-budget-exceeded.exception';
import { AiNotConfiguredException } from '@/modules/ai/interfaces/ai-provider.interface';
import type { AutomationActionContext } from './interfaces';

const ctx: AutomationActionContext = {
  tenantId: 't1',
  executionId: 'exec-1',
  ownerUserId: 'u1',
  workflowId: 'w1',
  workflowName: 'Flow',
  nodeId: 'n1',
  aiWritten: false,
} as AutomationActionContext;

function makeDeps(
  overrides: Partial<AutomationActionDeps> = {},
): AutomationActionDeps {
  return {
    users: {
      findMember: jest.fn().mockResolvedValue({
        id: 'u1',
        tenantId: 't1',
        email: 'owner@acme.test',
        firstName: 'Olive',
        lastName: 'Owner',
        isActive: true,
        teamId: 'team-1',
        managerId: null,
      }),
      findActiveEmails: jest.fn(),
    },
    rbac: {
      resolveAccess: jest.fn().mockResolvedValue({
        roles: ['sales'],
        level: 30,
        permissions: [
          AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE,
          'contact:read',
        ],
        isOwner: false,
      }),
    },
    tenantContext: {
      runAsAutomation: jest.fn(
        (_t: string, _e: string, fn: () => Promise<unknown>) => fn(),
      ),
    },
    mail: { name: 'console', sendMail: jest.fn() },
    ai: {
      generateText: jest.fn(),
      isConfigured: jest.fn(),
      getBudgetStatus: jest.fn(),
    },
    contacts: { create: jest.fn(), update: jest.fn() },
    quotes: { sendSignal: jest.fn() },
    audit: { record: jest.fn() },
    idempotency: { runOnce: jest.fn() },
    ...overrides,
  } as unknown as AutomationActionDeps;
}

async function failureOf(p: Promise<unknown>): Promise<ApplicationFailure> {
  try {
    await p;
  } catch (e) {
    return e as ApplicationFailure;
  }
  throw new Error('expected rejection');
}

describe('resolveOwner', () => {
  it('fails non-retryably when the automation has no owner', async () => {
    const err = await failureOf(
      resolveOwner(
        makeDeps(),
        { ...ctx, ownerUserId: undefined },
        'send email',
      ),
    );
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(err.nonRetryable).toBe(true);
    expect(err.message).toBe(
      'This automation has no owner; reactivate it to run send email',
    );
  });

  it('fails non-retryably when the owner is deactivated', async () => {
    const deps = makeDeps();
    (deps.users.findMember as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'owner@acme.test',
      isActive: false,
    });
    const err = await failureOf(resolveOwner(deps, ctx, 'send email'));
    expect(err.nonRetryable).toBe(true);
    expect(err.message).toBe(
      'owner@acme.test can no longer send email; reactivate the automation as someone who can',
    );
  });

  it('fails non-retryably when the owner no longer exists', async () => {
    const deps = makeDeps();
    (deps.users.findMember as jest.Mock).mockRejectedValue(
      new NotFoundException(),
    );
    const err = await failureOf(resolveOwner(deps, ctx, 'send email'));
    expect(err.nonRetryable).toBe(true);
    expect(err.message).toContain('can no longer send email');
  });

  it('does not convert a transient lookup error into a non-retryable failure', async () => {
    const deps = makeDeps();
    const boom = new Error('connection reset');
    (deps.users.findMember as jest.Mock).mockRejectedValue(boom);
    const err = await failureOf(resolveOwner(deps, ctx, 'send email'));
    expect(err).toBe(boom);
    expect(err).not.toBeInstanceOf(ApplicationFailure);
  });

  it('fails non-retryably when the owner lacks automation:execute', async () => {
    const deps = makeDeps();
    (deps.rbac.resolveAccess as jest.Mock).mockResolvedValue({
      roles: ['viewer'],
      level: 90,
      permissions: ['contact:read'],
      isOwner: false,
    });
    const err = await failureOf(resolveOwner(deps, ctx, 'update CRM records'));
    expect(err.nonRetryable).toBe(true);
    expect(err.message).toBe(
      'owner@acme.test can no longer update CRM records (missing automation:execute); reactivate the automation as someone who can',
    );
  });

  it('returns the owner as an AuthenticatedUser with resolved permissions', async () => {
    const deps = makeDeps();
    const user = await resolveOwner(deps, ctx, 'send email');
    expect(deps.users.findMember).toHaveBeenCalledWith('t1', 'u1');
    expect(deps.rbac.resolveAccess).toHaveBeenCalledWith('u1', 't1');
    expect(user).toEqual({
      id: 'u1',
      organizationId: 't1',
      email: 'owner@acme.test',
      firstName: 'Olive',
      lastName: 'Owner',
      roles: ['sales'],
      level: 30,
      permissions: [AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE, 'contact:read'],
      isOwner: false,
      teamId: 'team-1',
      managerId: null,
    });
  });
});

describe('createAutomationActions', () => {
  it('exposes the three action activities, each run in the automation tenant context', async () => {
    const deps = makeDeps();
    const actions = createAutomationActions(deps);
    expect(Object.keys(actions).sort()).toEqual([
      'executeAiPromptActivity',
      'executeCrmMutationActivity',
      'executeEmailActivity',
    ]);
    await expect(
      actions.executeAiPromptActivity({ prompt: '' }, ctx),
    ).rejects.toThrow('The AI prompt is empty');
    expect(deps.tenantContext.runAsAutomation).toHaveBeenCalledWith(
      't1',
      'exec-1',
      expect.any(Function),
    );
  });
});

const REFUSAL =
  "Your admin hasn't allowed automations to email AI-written text to customers. Send it to your team, or ask an admin to turn this on in Settings → AI.";

describe('executeEmailActivity', () => {
  function mailDeps(extra: Partial<AutomationActionDeps> = {}) {
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const done = new Map<string, unknown>();
    const runOnce = jest.fn(
      async (_t: string, key: string, fn: () => Promise<unknown>) => {
        if (done.has(key)) return done.get(key);
        const r = await fn();
        done.set(key, r);
        return r;
      },
    );
    const deps = makeDeps({
      mail: { name: 'console', sendMail },
      idempotency: { runOnce },
      ...extra,
    } as Partial<AutomationActionDeps>);
    return { deps, sendMail, runOnce };
  }
  const run = (deps: AutomationActionDeps, to: string, c = ctx, body = 'b') =>
    createAutomationActions(deps).executeEmailActivity(
      { to, subject: 'Hello', body },
      c,
    );

  it('sends one mail per recipient with text body and escaped html', async () => {
    const { deps, sendMail } = mailDeps();
    await run(deps, 'a@x.com', ctx, 'Hi <b>\nThere');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      to: 'a@x.com',
      subject: 'Hello',
      text: 'Hi <b>\nThere',
      html: 'Hi &lt;b&gt;<br>There',
    });
  });

  it('escapes ampersands and quotes in the html part', async () => {
    const { deps, sendMail } = mailDeps();
    await run(deps, 'a@x.com', ctx, `a & "b" 'c'`);
    expect(sendMail.mock.calls[0][0].html).toBe(
      'a &amp; &quot;b&quot; &#39;c&#39;',
    );
  });

  it('normalises recipients', async () => {
    const { deps, sendMail } = mailDeps();
    const res = await run(deps, 'a@x.com, ,A@x.com');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe('a@x.com');
    expect(res).toEqual({ sent: ['a@x.com'], provider: 'console' });
  });

  it('fails before sending when more than 10 recipients', async () => {
    const { deps, sendMail } = mailDeps();
    const to = Array.from({ length: 11 }, (_, i) => `u${i}@x.com`).join(',');
    const err = await failureOf(run(deps, to));
    expect(err.nonRetryable).toBe(true);
    expect(err.message).toContain('10');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('fails before sending on an invalid address', async () => {
    const { deps, sendMail } = mailDeps();
    const err = await failureOf(run(deps, 'a@x.com, nope'));
    expect(err.nonRetryable).toBe(true);
    expect(err.message).toContain('nope');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('treats a null recipient as no recipients', async () => {
    const { deps, sendMail } = mailDeps();
    const err = await failureOf(
      createAutomationActions(deps).executeEmailActivity(
        { to: null, subject: 'Hello', body: 'b' } as never,
        ctx,
      ),
    );
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(err.nonRetryable).toBe(true);
    expect(err.message).toBe('Send email has no recipients');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends a non-text body and subject as text', async () => {
    const { deps, sendMail } = mailDeps();
    await createAutomationActions(deps).executeEmailActivity(
      { to: 'a@x.com', subject: 7, body: 42 } as never,
      ctx,
    );
    expect(sendMail).toHaveBeenCalledWith({
      to: 'a@x.com',
      subject: '7',
      text: '42',
      html: '42',
    });
  });

  it('does not resend recipients already sent on retry', async () => {
    const { deps, sendMail, runOnce } = mailDeps();
    sendMail
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('smtp down'));
    await expect(run(deps, 'a@x.com,b@x.com')).rejects.toThrow('smtp down');
    expect(runOnce).toHaveBeenCalledWith(
      't1',
      'automation:exec-1:n1:mail:a@x.com',
      expect.any(Function),
    );
    const res = await run(deps, 'a@x.com,b@x.com');
    expect(sendMail.mock.calls.map((c) => c[0].to)).toEqual([
      'a@x.com',
      'b@x.com',
      'b@x.com',
    ]);
    expect(res.sent).toEqual(['a@x.com', 'b@x.com']);
  });

  describe('AI-written text', () => {
    const aiCtx = { ...ctx, aiWritten: true };
    const withSetting = (on: boolean) =>
      mailDeps({
        ai: {
          generateText: jest.fn(),
          isConfigured: jest.fn(),
          getBudgetStatus: jest
            .fn()
            .mockResolvedValue({ automationAiEmailToCustomers: on }),
        },
        users: {
          findMember: jest.fn().mockResolvedValue({
            id: 'u1',
            tenantId: 't1',
            email: 'owner@acme.test',
            firstName: 'O',
            lastName: 'O',
            isActive: true,
            teamId: null,
            managerId: null,
          }),
          findActiveEmails: jest.fn().mockResolvedValue(['ana@team.com']),
        },
      } as unknown as Partial<AutomationActionDeps>);

    it('refuses AI-written email to a customer when the setting is off', async () => {
      const { deps, sendMail } = withSetting(false);
      const err = await failureOf(
        run(deps, 'ana@team.com, cust@out.com', aiCtx),
      );
      expect(err.nonRetryable).toBe(true);
      expect(err.message).toBe(REFUSAL);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('sends AI-written email to a team member with the setting off', async () => {
      const { deps, sendMail } = withSetting(false);
      await run(deps, 'ana@team.com', aiCtx);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('classifies team members case-insensitively', async () => {
      const { deps, sendMail } = withSetting(false);
      await run(deps, 'Ana@Team.com', aiCtx);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('sends AI-written email to a customer with the setting on', async () => {
      const { deps, sendMail } = withSetting(true);
      await run(deps, 'cust@out.com', aiCtx);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('does not look up budget or members when the text is not AI-written', async () => {
      const { deps } = withSetting(false);
      await run(deps, 'cust@out.com');
      expect(deps.ai.getBudgetStatus).not.toHaveBeenCalled();
      expect(deps.users.findActiveEmails).not.toHaveBeenCalled();
    });
  });
});

describe('executeAiPromptActivity', () => {
  const NOT_CONFIGURED =
    "AI isn't set up for this organisation. Add a provider in Settings → AI.";
  function aiDeps(ai: Partial<AutomationActionDeps['ai']> = {}) {
    return makeDeps({
      ai: {
        isConfigured: jest.fn().mockResolvedValue(true),
        generateText: jest.fn().mockResolvedValue({
          text: 'Hello there',
          model: 'm-1',
          stopReason: 'end_turn',
          usage: {
            inputTokens: 5,
            outputTokens: 7,
            cacheReadInputTokens: 1,
          },
        }),
        getBudgetStatus: jest.fn(),
        ...ai,
      },
    } as Partial<AutomationActionDeps>);
  }
  const run = (deps: AutomationActionDeps, prompt = 'Say hi') =>
    createAutomationActions(deps).executeAiPromptActivity({ prompt }, ctx);

  it('calls generateText as the owner', async () => {
    const deps = aiDeps();
    const result = await run(deps);
    expect(deps.ai.generateText).toHaveBeenCalledWith(
      'automation.prompt',
      { messages: [{ role: 'user', content: 'Say hi' }] },
      { organizationId: 't1', userId: 'u1' },
    );
    expect(result).toEqual({
      text: 'Hello there',
      model: 'm-1',
      usage: { inputTokens: 5, outputTokens: 7 },
    });
  });

  it('treats a null prompt as empty', async () => {
    const deps = aiDeps();
    const f = await failureOf(
      createAutomationActions(deps).executeAiPromptActivity(
        { prompt: null } as never,
        ctx,
      ),
    );
    expect(f).toBeInstanceOf(ApplicationFailure);
    expect(f.nonRetryable).toBe(true);
    expect(f.message).toBe('The AI prompt is empty');
    expect(deps.ai.generateText).not.toHaveBeenCalled();
  });

  it('sends a non-text prompt as text', async () => {
    const deps = aiDeps();
    await createAutomationActions(deps).executeAiPromptActivity(
      { prompt: 42 } as never,
      ctx,
    );
    expect(deps.ai.generateText).toHaveBeenCalledWith(
      'automation.prompt',
      { messages: [{ role: 'user', content: '42' }] },
      expect.anything(),
    );
  });

  it('fails clearly when AI is not configured', async () => {
    const deps = aiDeps({ isConfigured: jest.fn().mockResolvedValue(false) });
    const f = await failureOf(run(deps));
    expect(f.nonRetryable).toBe(true);
    expect(f.message).toBe(NOT_CONFIGURED);
    expect(deps.ai.generateText).not.toHaveBeenCalled();
  });

  it('maps a not-configured error from the provider to the same failure', async () => {
    const deps = aiDeps({
      generateText: jest.fn().mockRejectedValue(new AiNotConfiguredException()),
    });
    const f = await failureOf(run(deps));
    expect(f.nonRetryable).toBe(true);
    expect(f.message).toBe(NOT_CONFIGURED);
  });

  it('surfaces budget exhaustion as a non-retryable failure', async () => {
    const err = new AiBudgetExceededException('t1', 12, 10);
    const deps = aiDeps({ generateText: jest.fn().mockRejectedValue(err) });
    const f = await failureOf(run(deps));
    expect(f.nonRetryable).toBe(true);
    expect(f.message).toBe(err.message);
  });

  it('rethrows other provider errors so Temporal retries them', async () => {
    const boom = new Error('503 upstream');
    const deps = aiDeps({ generateText: jest.fn().mockRejectedValue(boom) });
    await expect(run(deps)).rejects.toBe(boom);
  });

  it.each(['', '   \n '])('empty prompt %j fails', async (prompt) => {
    const deps = aiDeps();
    const f = await failureOf(run(deps, prompt));
    expect(f.nonRetryable).toBe(true);
    expect(f.message).toBe('The AI prompt is empty');
    expect(deps.ai.isConfigured).not.toHaveBeenCalled();
    expect(deps.ai.generateText).not.toHaveBeenCalled();
  });
});

describe('executeCrmMutationActivity', () => {
  const C1 = '5f0c8a7e-2b1d-4c3e-9a8f-1e2d3c4b5a69';
  const Q1 = '9b2e4d6f-8a1c-4e3b-b5d7-2f4a6c8e0b13';
  const ALL = [
    AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE,
    PERMISSIONS.CONTACT_CREATE,
    PERMISSIONS.CONTACT_UPDATE,
    PERMISSIONS.QUOTE_APPROVE,
  ];
  const contactBefore = {
    id: C1,
    firstName: 'Ada',
    lastName: 'Lovelace',
    fullName: 'Ada Lovelace',
    jobTitle: null,
    status: 'qualified',
  };
  const contactAfter = { ...contactBefore, jobTitle: 'CTO' };
  const quoteRow = (status: string) => ({
    id: Q1,
    quoteNumber: 'QT-2026-0007',
    status,
    updatedAt: new Date('2026-10-28T10:00:00.000Z'),
  });

  function crmDeps(permissions: string[] = ALL) {
    const done = new Map<string, unknown>();
    const runOnce = jest.fn(
      async (_t: string, key: string, fn: () => Promise<unknown>) => {
        if (done.has(key)) return done.get(key);
        const r = await fn();
        done.set(key, r);
        return r;
      },
    );
    const deps = makeDeps({
      rbac: {
        resolveAccess: jest.fn().mockResolvedValue({
          roles: ['sales'],
          level: 30,
          permissions,
          isOwner: false,
        }),
      },
      contacts: {
        create: jest.fn().mockResolvedValue({ ...contactBefore, id: 'c9' }),
        update: jest.fn().mockResolvedValue(contactAfter),
        findOne: jest.fn().mockResolvedValue(contactBefore),
      },
      quotes: {
        sendSignal: jest.fn().mockResolvedValue(quoteRow('APPROVED')),
        findQuoteById: jest
          .fn()
          .mockResolvedValueOnce(quoteRow('AWAITING_APPROVAL'))
          .mockResolvedValue(quoteRow('APPROVED')),
      },
      idempotency: { runOnce },
    } as unknown as Partial<AutomationActionDeps>);
    return { deps, runOnce };
  }
  const run = (deps: AutomationActionDeps, config: Record<string, unknown>) =>
    createAutomationActions(deps).executeCrmMutationActivity(
      config as never,
      ctx,
    );
  const owner = expect.objectContaining({
    id: 'u1',
    email: 'owner@acme.test',
    permissions: ALL,
  });

  describe('contacts', () => {
    it('creates a contact via ContactsService.create(owner, parsed)', async () => {
      const { deps } = crmDeps();
      const res = await run(deps, {
        entity: 'contact',
        action: 'create',
        fields: {
          firstName: ' Ada ',
          lastName: 'Lovelace',
          email: 'ADA@X.COM',
        },
      });
      expect(deps.contacts.create).toHaveBeenCalledWith(
        owner,
        expect.objectContaining({
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@x.com',
          status: 'lead',
        }),
      );
      expect(res).toEqual({
        entity: 'contact',
        action: 'create',
        recordId: 'c9',
        record: { ...contactBefore, id: 'c9' },
      });
    });

    it('updates a contact via update(owner, recordId, parsed), changing only the named fields', async () => {
      const { deps } = crmDeps();
      const res = await run(deps, {
        entity: 'contact',
        action: 'update',
        recordId: C1,
        fields: { jobTitle: ' CTO ' },
      });
      // The partial schema would otherwise default status/source back to
      // lead/other on every update.
      expect(deps.contacts.update).toHaveBeenCalledWith(owner, C1, {
        jobTitle: 'CTO',
      });
      expect(res).toEqual({
        entity: 'contact',
        action: 'update',
        recordId: C1,
        record: contactAfter,
      });
    });

    it('unknown field "deal" fails the step', async () => {
      const { deps } = crmDeps();
      const f = await failureOf(
        run(deps, {
          entity: 'contact',
          action: 'update',
          recordId: C1,
          fields: { jobTitle: 'CTO', deal: 'big' },
        }),
      );
      expect(f).toBeInstanceOf(ApplicationFailure);
      expect(f.nonRetryable).toBe(true);
      expect(f.message).toContain('"deal"');
      expect(deps.contacts.update).not.toHaveBeenCalled();
    });

    it('an invalid value fails the step naming the field', async () => {
      const { deps } = crmDeps();
      const f = await failureOf(
        run(deps, {
          entity: 'contact',
          action: 'create',
          fields: { firstName: 'Ada', lastName: 'L', email: 'nope' },
        }),
      );
      expect(f.nonRetryable).toBe(true);
      expect(f.message).toContain('email');
      expect(deps.contacts.create).not.toHaveBeenCalled();
    });

    it('an update with no fields fails the step', async () => {
      const { deps } = crmDeps();
      const f = await failureOf(
        run(deps, { entity: 'contact', action: 'update', recordId: C1 }),
      );
      expect(f.nonRetryable).toBe(true);
      expect(deps.contacts.update).not.toHaveBeenCalled();
    });

    it("rep cannot update another rep's contact", async () => {
      const { deps } = crmDeps();
      const C2 = '3d7a1c5e-9f2b-4a6d-8c1e-7b5f3a9d2e40';
      const notFound = new NotFoundException(`Contact ${C2} not found`);
      (deps.contacts.findOne as jest.Mock).mockRejectedValue(notFound);
      (deps.contacts.update as jest.Mock).mockRejectedValue(notFound);
      const f = await failureOf(
        run(deps, {
          entity: 'contact',
          action: 'update',
          recordId: C2,
          fields: { jobTitle: 'CTO' },
        }),
      );
      expect(f).toBeInstanceOf(ApplicationFailure);
      expect(f.nonRetryable).toBe(true);
      expect(f.message).toBe(`Contact ${C2} not found`);
      expect(deps.audit.record).not.toHaveBeenCalled();
    });

    it("hands ownerId to the service's own reassignment rules", async () => {
      const { deps } = crmDeps();
      (deps.contacts.update as jest.Mock).mockRejectedValue(
        new ForbiddenException('You cannot reassign contacts'),
      );
      const other = '55555555-5555-4555-8555-555555555555';
      const f = await failureOf(
        run(deps, {
          entity: 'contact',
          action: 'update',
          recordId: C1,
          fields: { ownerId: other },
        }),
      );
      expect(deps.contacts.update).toHaveBeenCalledWith(owner, C1, {
        ownerId: other,
      });
      expect(f.nonRetryable).toBe(true);
      expect(f.message).toBe('You cannot reassign contacts');
      expect(deps.audit.record).not.toHaveBeenCalled();
    });

    it('missing permission fails with the permission name', async () => {
      const { deps } = crmDeps([
        AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE,
        PERMISSIONS.CONTACT_CREATE,
      ]);
      const f = await failureOf(
        run(deps, {
          entity: 'contact',
          action: 'update',
          recordId: C1,
          fields: { jobTitle: 'CTO' },
        }),
      );
      expect(f.nonRetryable).toBe(true);
      expect(f.message).toBe(
        `owner@acme.test can no longer update contacts (missing ${PERMISSIONS.CONTACT_UPDATE}); reactivate the automation as someone who can`,
      );
      expect(f.message).toContain('contact:update');
      expect(deps.contacts.findOne).not.toHaveBeenCalled();
      expect(deps.contacts.update).not.toHaveBeenCalled();
    });

    it('rethrows transient service errors so Temporal retries them', async () => {
      const { deps } = crmDeps();
      const boom = new Error('connection reset');
      (deps.contacts.update as jest.Mock).mockRejectedValue(boom);
      const err = await failureOf(
        run(deps, {
          entity: 'contact',
          action: 'update',
          recordId: C1,
          fields: { jobTitle: 'CTO' },
        }),
      );
      expect(err).toBe(boom);
    });
  });

  describe('quotes', () => {
    it('approves a quote as automated', async () => {
      const { deps } = crmDeps();
      const res = await run(deps, {
        entity: 'quote',
        action: 'approve',
        recordId: Q1,
      });
      expect(deps.quotes.sendSignal).toHaveBeenCalledWith(
        't1',
        Q1,
        'APPROVE',
        undefined,
        'u1',
        { automated: true },
      );
      // JSON-safe: Temporal payloads and idempotency storage.
      expect(res).toEqual({
        entity: 'quote',
        action: 'approve',
        recordId: Q1,
        record: {
          id: Q1,
          quoteNumber: 'QT-2026-0007',
          status: 'APPROVED',
          updatedAt: '2026-10-28T10:00:00.000Z',
        },
      });
    });

    it('rejects with reason', async () => {
      const { deps } = crmDeps();
      await run(deps, {
        entity: 'quote',
        action: 'reject',
        recordId: Q1,
        reason: 'Too thin',
      });
      expect(deps.quotes.sendSignal).toHaveBeenCalledWith(
        't1',
        Q1,
        'REJECT',
        { reason: 'Too thin' },
        'u1',
        { automated: true },
      );
    });

    it('fails non-retryably when the margin floor refuses the approval', async () => {
      const { deps } = crmDeps();
      (deps.quotes.sendSignal as jest.Mock).mockRejectedValue(
        new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          message: 'Margin is 4.0%, below the 20.0% floor',
          violations: [],
        }),
      );
      const f = await failureOf(
        run(deps, { entity: 'quote', action: 'approve', recordId: Q1 }),
      );
      expect(f.nonRetryable).toBe(true);
      expect(f.message).toBe('Margin is 4.0%, below the 20.0% floor');
      expect(deps.audit.record).not.toHaveBeenCalled();
    });

    it('missing permission fails with the permission name', async () => {
      const { deps } = crmDeps([AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE]);
      const f = await failureOf(
        run(deps, { entity: 'quote', action: 'reject', recordId: Q1 }),
      );
      expect(f.nonRetryable).toBe(true);
      expect(f.message).toBe(
        `owner@acme.test can no longer reject quotes (missing ${PERMISSIONS.QUOTE_APPROVE}); reactivate the automation as someone who can`,
      );
      expect(deps.quotes.sendSignal).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['contact', 'update'],
    ['quote', 'approve'],
    ['quote', 'reject'],
  ])('missing recordId for %s %s fails', async (entity, action) => {
    const { deps } = crmDeps();
    const f = await failureOf(
      run(deps, { entity, action, fields: { jobTitle: 'CTO' } }),
    );
    expect(f.nonRetryable).toBe(true);
    expect(f.message).toContain('record');
    expect(deps.contacts.update).not.toHaveBeenCalled();
    expect(deps.quotes.sendSignal).not.toHaveBeenCalled();
  });

  it.each([
    ['contact', 'approve'],
    ['quote', 'create'],
    ['deal', 'update'],
  ])('unsupported entity/action pair %s %s fails', async (entity, action) => {
    const { deps } = crmDeps();
    const f = await failureOf(
      run(deps, { entity, action, recordId: 'x1', fields: {} }),
    );
    expect(f.nonRetryable).toBe(true);
    expect(f.message).toContain(entity);
    expect(f.message).toContain(action);
    expect(deps.contacts.create).not.toHaveBeenCalled();
    expect(deps.contacts.update).not.toHaveBeenCalled();
    expect(deps.quotes.sendSignal).not.toHaveBeenCalled();
  });

  it('fails with the owner message before checking the step', async () => {
    const { deps } = crmDeps();
    (deps.users.findMember as jest.Mock).mockResolvedValue({
      id: 'u1',
      email: 'owner@acme.test',
      isActive: false,
    });
    const f = await failureOf(
      run(deps, { entity: 'quote', action: 'approve', recordId: Q1 }),
    );
    expect(f.message).toBe(
      'owner@acme.test can no longer approve quotes; reactivate the automation as someone who can',
    );
  });

  it('writes one audit row', async () => {
    const { deps } = crmDeps();
    await run(deps, {
      entity: 'contact',
      action: 'update',
      recordId: C1,
      fields: { jobTitle: 'CTO' },
    });
    expect(deps.audit.record).toHaveBeenCalledTimes(1);
    expect(deps.audit.record).toHaveBeenCalledWith({
      tenantId: 't1',
      action: 'automation.contact.update',
      subjectType: 'CONTACT',
      subjectId: C1,
      actorId: 'u1',
      actorName: 'Olive Owner',
      origin: 'HUMAN',
      channel: 'SYSTEM',
      messageId: 'automation:exec-1:n1',
      summary: 'Automation "Flow" updated contact Ada Lovelace',
      before: contactBefore,
      after: contactAfter,
    });
  });

  it('audits a created contact with no before snapshot', async () => {
    const { deps } = crmDeps();
    await run(deps, {
      entity: 'contact',
      action: 'create',
      fields: { firstName: 'Ada', lastName: 'Lovelace' },
    });
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'automation.contact.create',
        subjectId: 'c9',
        summary: 'Automation "Flow" created contact Ada Lovelace',
        before: null,
      }),
    );
  });

  it('audits a quote decision with before and after snapshots', async () => {
    const { deps } = crmDeps();
    await run(deps, { entity: 'quote', action: 'approve', recordId: Q1 });
    expect(deps.audit.record).toHaveBeenCalledTimes(1);
    expect(deps.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'automation.quote.approve',
        subjectType: 'QUOTE',
        subjectId: Q1,
        summary: 'Automation "Flow" approved quote QT-2026-0007',
        before: expect.objectContaining({ status: 'AWAITING_APPROVAL' }),
        after: expect.objectContaining({ status: 'APPROVED' }),
      }),
    );
  });

  it('runs once per (executionId, nodeId)', async () => {
    const { deps, runOnce } = crmDeps();
    const config = {
      entity: 'contact',
      action: 'update',
      recordId: C1,
      fields: { jobTitle: 'CTO' },
    };
    const first = await run(deps, config);
    const second = await run(deps, config);
    expect(runOnce).toHaveBeenCalledWith(
      't1',
      'automation:exec-1:n1:crm',
      expect.any(Function),
    );
    expect(deps.contacts.update).toHaveBeenCalledTimes(1);
    expect(deps.audit.record).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it.each([
    ['contact', 'update', 'Ada Lovelace'],
    ['quote', 'approve', 'QT-2026-0007'],
    ['quote', 'reject', '12'],
  ])('a %s %s with a record id that is not a UUID fails', async (entity, action, recordId) => {
    const { deps } = crmDeps();
    const f = await failureOf(
      run(deps, { entity, action, recordId, fields: { jobTitle: 'CTO' } }),
    );
    expect(f).toBeInstanceOf(ApplicationFailure);
    expect(f.nonRetryable).toBe(true);
    expect(f.message).toBe(`Record ID "${recordId}" is not a valid ID`);
    expect(deps.contacts.findOne).not.toHaveBeenCalled();
    expect(deps.contacts.update).not.toHaveBeenCalled();
    expect(deps.quotes.findQuoteById).not.toHaveBeenCalled();
    expect(deps.quotes.sendSignal).not.toHaveBeenCalled();
  });

  it('accepts a record id that arrives as a padded UUID', async () => {
    const { deps } = crmDeps();
    await run(deps, {
      entity: 'contact',
      action: 'update',
      recordId: `  ${C1} `,
      fields: { jobTitle: 'CTO' },
    });
    expect(deps.contacts.update).toHaveBeenCalledWith(owner, C1, {
      jobTitle: 'CTO',
    });
  });
});
