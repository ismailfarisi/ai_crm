import { ApplicationFailure } from '@temporalio/activity';
import { AUTOMATION_PERMISSIONS } from '@saas/shared';
import { NotFoundException } from '@nestjs/common';
import {
  createAutomationActions,
  resolveOwner,
  type AutomationActionDeps,
} from './automation-actions';
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

function makeDeps(overrides: Partial<AutomationActionDeps> = {}): AutomationActionDeps {
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
        permissions: [AUTOMATION_PERMISSIONS.AUTOMATION_EXECUTE, 'contact:read'],
        isOwner: false,
      }),
    },
    tenantContext: {
      runAsAutomation: jest.fn((_t: string, _e: string, fn: () => Promise<unknown>) => fn()),
    },
    mail: { name: 'console', sendMail: jest.fn() },
    ai: { generateText: jest.fn(), isConfigured: jest.fn(), getBudgetStatus: jest.fn() },
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
      resolveOwner(makeDeps(), { ...ctx, ownerUserId: undefined }, 'send email'),
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
    (deps.users.findMember as jest.Mock).mockRejectedValue(new NotFoundException());
    const err = await failureOf(resolveOwner(deps, ctx, 'send email'));
    expect(err.nonRetryable).toBe(true);
    expect(err.message).toContain('can no longer send email');
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
      'owner@acme.test can no longer update CRM records; reactivate the automation as someone who can',
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
      actions.executeEmailActivity({ to: 'a@b.co', subject: 's', body: 'b' }, ctx),
    ).rejects.toThrow('not implemented');
    expect(deps.tenantContext.runAsAutomation).toHaveBeenCalledWith(
      't1',
      'exec-1',
      expect.any(Function),
    );
  });
});
