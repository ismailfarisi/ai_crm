import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClsModule } from 'nestjs-cls';
import {
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
} from '@temporalio/client';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { TemporalService } from '../../temporal/temporal.service';
import { AutomationWorkflow } from '../entities/automation-workflow.entity';
import {
  AutomationSchedulesService,
  SCHEDULE_UPDATE_FAILED,
  scheduleIdFor,
  toScheduleSpec,
} from './automation-schedules.service';
import { scheduledTickWorkflow } from '../workflows/scheduled-tick.workflow';

const TENANT = '11111111-1111-1111-1111-111111111111';
const DAILY = { frequency: 'daily', time: '09:30', timezone: 'Asia/Dubai' };

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
    triggerConfig: { schedule: DAILY },
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

async function* listOf(ids: string[]) {
  for (const scheduleId of ids) yield { scheduleId };
}

describe('toScheduleSpec', () => {
  it('hourly: every hour at the minute', () => {
    expect(
      toScheduleSpec({ frequency: 'hourly', minute: 15, timezone: 'UTC' }),
    ).toEqual({
      calendars: [{ minute: 15, hour: '*' }],
      timezone: 'UTC',
    });
  });

  it('daily: at the wall-clock time in the schedule time zone', () => {
    expect(toScheduleSpec(DAILY as any)).toEqual({
      calendars: [{ minute: 30, hour: 9 }],
      timezone: 'Asia/Dubai',
    });
  });

  it('weekly: maps 1 = Monday … 7 = Sunday onto Temporal day names', () => {
    expect(
      toScheduleSpec({
        frequency: 'weekly',
        time: '07:05',
        daysOfWeek: [7],
        timezone: 'Europe/London',
      }),
    ).toEqual({
      calendars: [{ minute: 5, hour: 7, dayOfWeek: ['SUNDAY'] }],
      timezone: 'Europe/London',
    });
  });

  it('weekly: several days, in week order', () => {
    expect(
      toScheduleSpec({
        frequency: 'weekly',
        time: '18:00',
        daysOfWeek: [5, 1, 3],
        timezone: 'Asia/Dubai',
      }).calendars,
    ).toEqual([
      { minute: 0, hour: 18, dayOfWeek: ['MONDAY', 'WEDNESDAY', 'FRIDAY'] },
    ]);
    expect(
      toScheduleSpec({
        frequency: 'weekly',
        time: '18:00',
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        timezone: 'Asia/Dubai',
      }).calendars?.[0].dayOfWeek,
    ).toEqual([
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
      'SUNDAY',
    ]);
  });

  it('monthly: on the day of the month', () => {
    expect(
      toScheduleSpec({
        frequency: 'monthly',
        time: '23:59',
        dayOfMonth: 28,
        timezone: 'Asia/Dubai',
      }),
    ).toEqual({
      calendars: [{ minute: 59, hour: 23, dayOfMonth: 28 }],
      timezone: 'Asia/Dubai',
    });
  });
});

describe('AutomationSchedulesService', () => {
  let service: AutomationSchedulesService;
  let tenantContext: TenantContextService;
  let handle: { update: jest.Mock; delete: jest.Mock };
  let client: {
    schedule: { create: jest.Mock; getHandle: jest.Mock; list: jest.Mock };
  };
  let temporal: { getClient: jest.Mock };
  let workflows: { find: jest.Mock; findOne: jest.Mock };
  let lookups: { system: boolean }[];

  beforeEach(async () => {
    handle = {
      update: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    client = {
      schedule: {
        create: jest.fn().mockResolvedValue(handle),
        getHandle: jest.fn().mockReturnValue(handle),
        list: jest.fn().mockImplementation(() => listOf([])),
      },
    };
    temporal = { getClient: jest.fn().mockReturnValue(client) };
    lookups = [];
    workflows = {
      find: jest.fn().mockImplementation(async () => {
        lookups.push({ system: tenantContext.isSystem() });
        return [];
      }),
      findOne: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [ClsModule.forRoot({ global: true })],
      providers: [
        AutomationSchedulesService,
        TenantContextService,
        { provide: TemporalService, useValue: temporal },
        {
          provide: getRepositoryToken(AutomationWorkflow),
          useValue: workflows,
        },
      ],
    }).compile();
    service = moduleRef.get(AutomationSchedulesService);
    tenantContext = moduleRef.get(TenantContextService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('sync', () => {
    it('activating creates the schedule: tick workflow, SKIP overlap, 1 hour catch-up', async () => {
      await service.sync(workflow());

      expect(client.schedule.create).toHaveBeenCalledTimes(1);
      const options = client.schedule.create.mock.calls[0][0];
      expect(options.scheduleId).toBe('automation-schedule-wf-1');
      expect(scheduleIdFor('wf-1')).toBe('automation-schedule-wf-1');
      expect(options.spec).toEqual({
        calendars: [{ minute: 30, hour: 9 }],
        timezone: 'Asia/Dubai',
      });
      expect(options.action).toEqual(
        expect.objectContaining({
          type: 'startWorkflow',
          workflowType: scheduledTickWorkflow,
          taskQueue: 'automations-queue',
          args: [{ tenantId: TENANT, workflowId: 'wf-1' }],
        }),
      );
      expect(options.policies).toEqual({
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: '1 hour',
      });
      expect(handle.update).not.toHaveBeenCalled();
      expect(handle.delete).not.toHaveBeenCalled();
    });

    it('editing the schedule while active updates the existing schedule', async () => {
      client.schedule.create.mockRejectedValueOnce(
        new ScheduleAlreadyRunning('exists', 'automation-schedule-wf-1'),
      );
      const weekly = {
        frequency: 'weekly',
        time: '08:00',
        daysOfWeek: [7],
        timezone: 'Europe/London',
      };

      await service.sync(workflow({ triggerConfig: { schedule: weekly } }));

      expect(client.schedule.getHandle).toHaveBeenCalledWith(
        'automation-schedule-wf-1',
      );
      expect(handle.update).toHaveBeenCalledTimes(1);
      const updateFn = handle.update.mock.calls[0][0];
      const updated = updateFn({ state: { paused: false } });
      expect(updated.spec).toEqual({
        calendars: [{ minute: 0, hour: 8, dayOfWeek: ['SUNDAY'] }],
        timezone: 'Europe/London',
      });
      expect(updated.action.workflowType).toBe(scheduledTickWorkflow);
      expect(updated.action.args).toEqual([
        { tenantId: TENANT, workflowId: 'wf-1' },
      ]);
      expect(updated.policies).toEqual({
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: '1 hour',
      });
      expect(updated.state.paused).toBe(false);
    });

    it.each([
      ['pausing', { status: 'PAUSED' as const }],
      ['back to draft', { status: 'DRAFT' as const }],
      ['changing the trigger type', { triggerType: 'WEBHOOK' as const }],
    ])('%s deletes the schedule', async (_label, overrides) => {
      await service.sync(workflow(overrides));

      expect(client.schedule.getHandle).toHaveBeenCalledWith(
        'automation-schedule-wf-1',
      );
      expect(handle.delete).toHaveBeenCalledTimes(1);
      expect(client.schedule.create).not.toHaveBeenCalled();
    });

    it('ignores a schedule that is already gone', async () => {
      handle.delete.mockRejectedValueOnce(
        new ScheduleNotFoundError('gone', 'automation-schedule-wf-1'),
      );
      await expect(
        service.sync(workflow({ status: 'PAUSED' })),
      ).resolves.toBeUndefined();
    });

    it('does not call Temporal when the automation never had a schedule and still does not need one', async () => {
      await service.sync(workflow({ triggerType: 'WEBHOOK' }), {
        hadSchedule: false,
      });
      expect(temporal.getClient).not.toHaveBeenCalled();
    });

    it('still deletes when the automation had a schedule before this save', async () => {
      await service.sync(workflow({ status: 'PAUSED' }), { hadSchedule: true });
      expect(handle.delete).toHaveBeenCalledTimes(1);
    });

    it('a Temporal error becomes the save-blocking message', async () => {
      client.schedule.create.mockRejectedValueOnce(new Error('UNAVAILABLE'));
      await expect(service.sync(workflow())).rejects.toThrow(
        new ServiceUnavailableException(SCHEDULE_UPDATE_FAILED),
      );
      expect(SCHEDULE_UPDATE_FAILED).toBe(
        "Couldn't update the automation's schedule. Try again in a minute.",
      );
    });

    it('a Temporal client that is offline also blocks the save', async () => {
      temporal.getClient.mockImplementation(() => {
        throw new Error('Temporal client is not initialized');
      });
      await expect(service.sync(workflow())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('an error while deleting blocks the save', async () => {
      handle.delete.mockRejectedValueOnce(new Error('UNAVAILABLE'));
      await expect(
        service.sync(workflow({ status: 'PAUSED' })),
      ).rejects.toThrow(
        new ServiceUnavailableException(SCHEDULE_UPDATE_FAILED),
      );
    });
  });

  describe('deleteFor', () => {
    it('deletes the schedule of a SCHEDULE automation, ignoring not-found', async () => {
      handle.delete.mockRejectedValueOnce(
        new ScheduleNotFoundError('gone', 'automation-schedule-wf-1'),
      );
      await expect(service.deleteFor(workflow())).resolves.toBeUndefined();
      expect(client.schedule.getHandle).toHaveBeenCalledWith(
        'automation-schedule-wf-1',
      );
    });

    it('leaves Temporal alone for other trigger types', async () => {
      await service.deleteFor(workflow({ triggerType: 'MANUAL' }));
      expect(temporal.getClient).not.toHaveBeenCalled();
    });

    it('refuses on a Temporal error', async () => {
      handle.delete.mockRejectedValueOnce(new Error('UNAVAILABLE'));
      await expect(service.deleteFor(workflow())).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('reconcile', () => {
    it('creates missing schedules, updates existing ones and deletes orphans', async () => {
      const missing = workflow({ id: 'wf-new' });
      const existing = workflow({ id: 'wf-old' });
      workflows.find.mockImplementation(async (opts: any) => {
        lookups.push({ system: tenantContext.isSystem() });
        expect(opts.where).toEqual({
          status: 'ACTIVE',
          triggerType: 'SCHEDULE',
        });
        return [missing, existing];
      });
      client.schedule.create.mockImplementation(async (o: any) => {
        if (o.scheduleId === 'automation-schedule-wf-old') {
          throw new ScheduleAlreadyRunning('exists', o.scheduleId);
        }
        return handle;
      });
      client.schedule.list.mockImplementation(() =>
        listOf([
          'automation-schedule-wf-old',
          'automation-schedule-wf-new',
          'automation-schedule-wf-deleted',
          'someone-elses-schedule',
        ]),
      );
      const handles = new Map<string, typeof handle>();
      client.schedule.getHandle.mockImplementation((id: string) => {
        const h = {
          update: jest.fn().mockResolvedValue(undefined),
          delete: jest.fn().mockResolvedValue(undefined),
        };
        handles.set(id, h);
        return h;
      });

      await service.reconcile();

      expect(lookups).toEqual([{ system: true }]);
      expect(client.schedule.create).toHaveBeenCalledTimes(2);
      expect(
        handles.get('automation-schedule-wf-old')?.update,
      ).toHaveBeenCalled();
      expect(
        handles.get('automation-schedule-wf-deleted')?.delete,
      ).toHaveBeenCalledTimes(1);
      expect(handles.has('someone-elses-schedule')).toBe(false);
      expect(handles.get('automation-schedule-wf-new')?.delete).toBeUndefined();
    });

    it('skips an active automation whose schedule is invalid, with a warning, and does not delete its schedule', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      workflows.find.mockResolvedValue([
        workflow({
          id: 'wf-bad',
          triggerConfig: { schedule: { frequency: 'daily' } },
        }),
      ]);
      client.schedule.list.mockImplementation(() =>
        listOf(['automation-schedule-wf-bad']),
      );

      await service.reconcile();

      expect(client.schedule.create).not.toHaveBeenCalled();
      expect(handle.delete).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('wf-bad'));
    });

    it('survives a Temporal error: logs and keeps going', async () => {
      workflows.find.mockResolvedValue([
        workflow({ id: 'wf-a' }),
        workflow({ id: 'wf-b' }),
      ]);
      client.schedule.create
        .mockRejectedValueOnce(new Error('UNAVAILABLE'))
        .mockResolvedValueOnce(handle);
      client.schedule.list.mockImplementation(() => {
        throw new Error('UNAVAILABLE');
      });

      await expect(service.reconcile()).resolves.toBeUndefined();
      expect(client.schedule.create).toHaveBeenCalledTimes(2);
    });

    it('never throws when Temporal is offline at boot', async () => {
      temporal.getClient.mockImplementation(() => {
        throw new Error('Temporal client is not initialized');
      });
      workflows.find.mockResolvedValue([workflow()]);
      await expect(service.reconcile()).resolves.toBeUndefined();
    });

    it('never throws when the database read fails', async () => {
      workflows.find.mockRejectedValue(new Error('db down'));
      await expect(service.reconcile()).resolves.toBeUndefined();
    });
  });
});
