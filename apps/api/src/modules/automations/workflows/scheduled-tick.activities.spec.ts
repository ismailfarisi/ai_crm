import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { TenantContextService } from '@/common/context/tenant-context.service';
import type { AutomationWorkflow } from '../entities/automation-workflow.entity';
import { createScheduledTickActivities } from './scheduled-tick.activities';

const TENANT = '11111111-1111-1111-1111-111111111111';
const SCHEDULED_AT = '2026-10-29T05:30:00.000Z';

function workflow(
  overrides: Partial<AutomationWorkflow> = {},
): AutomationWorkflow {
  return {
    id: 'wf-1',
    tenantId: TENANT,
    name: 'Morning digest',
    description: null,
    status: 'ACTIVE',
    triggerType: 'SCHEDULE',
    triggerConfig: {
      schedule: { frequency: 'daily', time: '09:30', timezone: 'Asia/Dubai' },
    },
    nodes: [],
    edges: [],
    webhookSlug: null,
    activatedByUserId: 'owner-1',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('startScheduledRunActivity', () => {
  let tenantContext: TenantContextService;
  let workflows: { findOne: jest.Mock };
  let automations: { triggerExecution: jest.Mock };
  let billing: { restrictionFor: jest.Mock };
  let contextAtLookup: { system: boolean; tenant: string | null }[];
  let contextAtTrigger: { system: boolean; tenant: string | null }[];
  let activity: ReturnType<
    typeof createScheduledTickActivities
  >['startScheduledRunActivity'];

  const input = {
    tenantId: TENANT,
    workflowId: 'wf-1',
    scheduledAt: SCHEDULED_AT,
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true })],
      providers: [TenantContextService],
    }).compile();
    tenantContext = moduleRef.get(TenantContextService);
    contextAtLookup = [];
    contextAtTrigger = [];
    workflows = {
      findOne: jest.fn().mockImplementation(async () => {
        contextAtLookup.push({
          system: tenantContext.isSystem(),
          tenant: tenantContext.getTenantId(),
        });
        return workflow();
      }),
    };
    automations = {
      triggerExecution: jest.fn().mockImplementation(async () => {
        contextAtTrigger.push({
          system: tenantContext.isSystem(),
          tenant: tenantContext.getTenantId(),
        });
        return { id: 'exec-1' };
      }),
    };
    billing = {
      restrictionFor: jest.fn().mockResolvedValue({ restricted: false }),
    };
    activity = createScheduledTickActivities({
      workflows,
      automations,
      billing,
      tenantContext,
    }).startScheduledRunActivity;
  });

  it('starts one run as the owner, keyed by the tick, inside the tenant', async () => {
    await expect(activity(input)).resolves.toEqual({
      started: true,
      executionId: 'exec-1',
    });

    expect(workflows.findOne).toHaveBeenCalledWith({
      where: { id: 'wf-1', tenantId: TENANT },
    });
    expect(contextAtLookup).toEqual([{ system: true, tenant: null }]);
    expect(contextAtTrigger).toEqual([{ system: false, tenant: TENANT }]);
    expect(automations.triggerExecution).toHaveBeenCalledTimes(1);
    expect(automations.triggerExecution).toHaveBeenCalledWith(
      TENANT,
      'wf-1',
      { scheduledAt: SCHEDULED_AT, timezone: 'Asia/Dubai' },
      undefined,
      { failOnStartError: true, idempotencyKey: `schedule:${SCHEDULED_AT}` },
    );
  });

  it.each([
    ['deleted', null, 'not_found'],
    ['paused', workflow({ status: 'PAUSED' }), 'not_active'],
    ['draft', workflow({ status: 'DRAFT' }), 'not_active'],
    ['trigger changed', workflow({ triggerType: 'WEBHOOK' }), 'not_scheduled'],
  ])(
    'a tick for an automation that is %s starts nothing and does not throw',
    async (_label, found, reason) => {
      workflows.findOne.mockResolvedValueOnce(found);
      await expect(activity(input)).resolves.toEqual({
        started: false,
        reason,
      });
      expect(automations.triggerExecution).not.toHaveBeenCalled();
    },
  );

  it('a billing-restricted organisation starts no run (and keeps its schedule)', async () => {
    billing.restrictionFor.mockResolvedValueOnce({ restricted: true });
    await expect(activity(input)).resolves.toEqual({
      started: false,
      reason: 'billing_restricted',
    });
    expect(billing.restrictionFor).toHaveBeenCalledWith(TENANT);
    expect(automations.triggerExecution).not.toHaveBeenCalled();
  });

  it('deleted between the lookup and the start: quiet, no retry loop', async () => {
    automations.triggerExecution.mockRejectedValueOnce(
      new NotFoundException('Workflow wf-1 not found'),
    );
    await expect(activity(input)).resolves.toEqual({
      started: false,
      reason: 'not_found',
    });
  });

  it('a Temporal start failure throws so the activity is retried', async () => {
    automations.triggerExecution.mockRejectedValueOnce(
      new Error('UNAVAILABLE'),
    );
    await expect(activity(input)).rejects.toThrow('UNAVAILABLE');
  });

  it('the same tick delivered twice starts one run', async () => {
    const runs = new Map<string, { id: string }>();
    automations.triggerExecution.mockImplementation(
      async (_t: string, _w: string, _p: unknown, _a: unknown, opts: any) => {
        const existing = runs.get(opts.idempotencyKey);
        if (existing) return existing;
        const exec = { id: `exec-${runs.size + 1}` };
        runs.set(opts.idempotencyKey, exec);
        return exec;
      },
    );

    const first = await activity(input);
    const second = await activity(input);

    expect(runs.size).toBe(1);
    expect(first).toEqual({ started: true, executionId: 'exec-1' });
    expect(second).toEqual({ started: true, executionId: 'exec-1' });
    const keys = automations.triggerExecution.mock.calls.map(
      (c) => c[4].idempotencyKey,
    );
    expect(keys).toEqual([
      `schedule:${SCHEDULED_AT}`,
      `schedule:${SCHEDULED_AT}`,
    ]);
  });

  it('falls back to the default time zone when the stored schedule has none', async () => {
    workflows.findOne.mockResolvedValueOnce(
      workflow({
        triggerConfig: { schedule: { frequency: 'hourly', minute: 0 } },
      }),
    );
    await activity(input);
    expect(automations.triggerExecution.mock.calls[0][2]).toEqual({
      scheduledAt: SCHEDULED_AT,
      timezone: 'Asia/Dubai',
    });
  });
});
