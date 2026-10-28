import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
} from '@temporalio/client';
import type {
  Client,
  DayOfWeek,
  ScheduleOptionsStartWorkflowAction,
  ScheduleSpec,
} from '@temporalio/client';
import { automationScheduleSchema } from '@saas/shared';
import type { AutomationSchedule } from '@saas/shared';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { TemporalService } from '../../temporal/temporal.service';
import { AutomationWorkflow } from '../entities/automation-workflow.entity';
import {
  scheduledTickWorkflow,
  type ScheduledTickInput,
} from '../workflows/scheduled-tick.workflow';

export const SCHEDULE_ID_PREFIX = 'automation-schedule-';

export const SCHEDULE_UPDATE_FAILED =
  "Couldn't update the automation's schedule. Try again in a minute.";

/** Boot reconciliation waits this long between tries while Temporal is down… */
export const RECONCILE_RETRY_MS = 30_000;
/** …and gives up after this many. */
export const RECONCILE_MAX_ATTEMPTS = 20;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // A pending retry never holds the process open at shutdown.
    timer.unref?.();
  });
}

export function scheduleIdFor(workflowId: string): string {
  return `${SCHEDULE_ID_PREFIX}${workflowId}`;
}

/** Ours is 1 = Monday … 7 = Sunday; Temporal names the days. */
const TEMPORAL_DAYS: readonly DayOfWeek[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

function parseTime(time: string | undefined): { hour: number; minute: number } {
  const [hour, minute] = (time ?? '00:00').split(':').map(Number);
  return { hour, minute };
}

/**
 * A validated schedule as a Temporal calendar spec. Temporal evaluates it as
 * wall-clock time in `timezone`, DST included. Call it only with the output
 * of `automationScheduleSchema` (the type leaves the fields optional).
 */
export function toScheduleSpec(s: AutomationSchedule): ScheduleSpec {
  let calendar: NonNullable<ScheduleSpec['calendars']>[number];
  switch (s.frequency) {
    case 'hourly':
      // Temporal's calendar `hour` defaults to 0, not every hour.
      calendar = { minute: s.minute ?? 0, hour: '*' };
      break;
    case 'daily': {
      const { hour, minute } = parseTime(s.time);
      calendar = { minute, hour };
      break;
    }
    case 'weekly': {
      const { hour, minute } = parseTime(s.time);
      const days = [...new Set(s.daysOfWeek ?? [])].sort((a, b) => a - b);
      calendar = {
        minute,
        hour,
        dayOfWeek: days.map((d) => TEMPORAL_DAYS[d - 1]),
      };
      break;
    }
    case 'monthly': {
      const { hour, minute } = parseTime(s.time);
      calendar = { minute, hour, dayOfMonth: s.dayOfMonth };
      break;
    }
  }
  return { calendars: [calendar], timezone: s.timezone };
}

function wantsSchedule(wf: Pick<AutomationWorkflow, 'status' | 'triggerType'>) {
  return wf.status === 'ACTIVE' && wf.triggerType === 'SCHEDULE';
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface SyncOptions {
  /**
   * Whether the stored row (before this save) was an ACTIVE SCHEDULE
   * automation, i.e. may have a schedule. When it was not, and still does not
   * need one, Temporal is not called at all: saving a webhook or CRM
   * automation keeps working while Temporal is down. Omit to always check.
   */
  hadSchedule?: boolean;
}

/**
 * Keeps one Temporal Schedule per ACTIVE automation with a SCHEDULE trigger,
 * id `automation-schedule-<workflowId>`. Each tick starts
 * `scheduledTickWorkflow`, whose activity starts the real run.
 */
@Injectable()
export class AutomationSchedulesService {
  private readonly logger = new Logger(AutomationSchedulesService.name);

  constructor(
    private readonly temporal: TemporalService,
    @InjectRepository(AutomationWorkflow)
    private readonly workflows: Repository<AutomationWorkflow>,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Make Temporal match this (validated, not yet saved) automation: create or
   * update its schedule when it is ACTIVE on a valid schedule, otherwise
   * delete it if present. Any Temporal error is a 503 that aborts the save.
   */
  async sync(wf: AutomationWorkflow, options: SyncOptions = {}): Promise<void> {
    const parsed = wantsSchedule(wf)
      ? automationScheduleSchema.safeParse(wf.triggerConfig?.schedule)
      : null;

    try {
      if (parsed?.success) {
        if (!wf.id) {
          throw new Error('An automation must be saved before it is scheduled');
        }
        await this.upsert(await this.temporal.getClient(), wf, parsed.data);
      } else if (options.hadSchedule !== false) {
        await this.deleteIfPresent(await this.temporal.getClient(), wf.id);
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Schedule sync failed for automation ${wf.id}: ${errorText(err)}`,
      );
      throw new ServiceUnavailableException(SCHEDULE_UPDATE_FAILED);
    }
  }

  /**
   * Remove the schedule of an automation about to be deleted, whatever its
   * trigger: a stray schedule (left by a save whose DB write failed) goes too.
   */
  async deleteFor(wf: AutomationWorkflow): Promise<void> {
    try {
      await this.deleteIfPresent(await this.temporal.getClient(), wf.id);
    } catch (err: unknown) {
      this.logger.warn(
        `Schedule delete failed for automation ${wf.id}: ${errorText(err)}`,
      );
      throw new ServiceUnavailableException(SCHEDULE_UPDATE_FAILED);
    }
  }

  /**
   * Repair drift between the database and Temporal (a save whose DB write
   * failed after its schedule was written, schedules created while Temporal
   * was being restored, …). Runs once at API boot, in the background; never
   * throws. While Temporal cannot be reached it tries again every 30 s, up to
   * 20 attempts, then gives up with a warning.
   */
  async reconcile(): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      let client: Client;
      try {
        client = await this.temporal.getClient();
      } catch (err: unknown) {
        if (attempt >= RECONCILE_MAX_ATTEMPTS) {
          this.logger.warn(
            `Schedule reconciliation gave up after ${attempt} attempts: Temporal unavailable (${errorText(err)})`,
          );
          return;
        }
        this.logger.warn(
          `Schedule reconciliation waiting for Temporal (attempt ${attempt} of ${RECONCILE_MAX_ATTEMPTS}): ${errorText(err)}`,
        );
        await delay(RECONCILE_RETRY_MS);
        continue;
      }
      try {
        await this.reconcileWith(client);
      } catch (err: unknown) {
        this.logger.warn(`Schedule reconciliation failed: ${errorText(err)}`);
      }
      return;
    }
  }

  private async reconcileWith(client: Client): Promise<void> {
    const active = await this.tenantContext.runAsSystem(() =>
      this.workflows.find({
        where: { status: 'ACTIVE', triggerType: 'SCHEDULE' },
      }),
    );

    let synced = 0;
    for (const wf of active) {
      const parsed = automationScheduleSchema.safeParse(
        wf.triggerConfig?.schedule,
      );
      if (!parsed.success) {
        this.logger.warn(
          `Automation ${wf.id} is active but its schedule is invalid; left as is`,
        );
        continue;
      }
      try {
        await this.upsert(client, wf, parsed.data);
        synced++;
      } catch (err: unknown) {
        this.logger.warn(
          `Schedule sync failed for automation ${wf.id}: ${errorText(err)}`,
        );
      }
    }

    const keep = new Set(active.map((wf) => scheduleIdFor(wf.id)));
    let deleted = 0;
    try {
      for await (const summary of client.schedule.list()) {
        const id = summary.scheduleId;
        if (!id.startsWith(SCHEDULE_ID_PREFIX) || keep.has(id)) continue;
        const workflowId = id.slice(SCHEDULE_ID_PREFIX.length);
        try {
          // `keep` was read before listing: an automation activated since
          // (by another API instance, say) has a fresh schedule that must
          // not be taken for an orphan. A failed re-check skips the delete.
          if (await this.isActiveOnSchedule(workflowId)) continue;
          await this.deleteIfPresent(client, workflowId);
          deleted++;
        } catch (err: unknown) {
          this.logger.warn(
            `Orphan schedule ${id} not deleted: ${errorText(err)}`,
          );
        }
      }
    } catch (err: unknown) {
      this.logger.warn(`Listing schedules failed: ${errorText(err)}`);
    }

    this.logger.log(
      `Schedules reconciled: ${synced} of ${active.length} synced, ${deleted} orphans deleted`,
    );
  }

  private async upsert(
    client: Client,
    wf: AutomationWorkflow,
    schedule: AutomationSchedule,
  ): Promise<void> {
    const scheduleId = scheduleIdFor(wf.id);
    const spec = toScheduleSpec(schedule);
    const args: [ScheduledTickInput] = [
      { tenantId: wf.tenantId, workflowId: wf.id },
    ];
    const action: ScheduleOptionsStartWorkflowAction<
      typeof scheduledTickWorkflow
    > = {
      type: 'startWorkflow',
      workflowType: scheduledTickWorkflow,
      taskQueue: 'automations-queue',
      // Temporal appends the tick's time to this id.
      workflowId: `automation-tick-${wf.id}`,
      args,
    };
    const policies = {
      // A tick still running (its start being retried) means the next is
      // skipped, never queued: one tick, at most one run.
      overlap: ScheduleOverlapPolicy.SKIP,
      // After an outage, run what was missed in the last hour only.
      catchupWindow: '1 hour' as const,
    };

    try {
      await client.schedule.create({ scheduleId, spec, action, policies });
    } catch (err: unknown) {
      if (!(err instanceof ScheduleAlreadyRunning)) throw err;
      await client.schedule.getHandle(scheduleId).update((previous) => ({
        spec,
        action,
        policies,
        state: { ...previous.state, paused: false },
      }));
    }
  }

  /**
   * Same rule as the first pass, which keeps (and leaves alone) every ACTIVE
   * SCHEDULE automation, including one whose schedule is invalid.
   */
  private async isActiveOnSchedule(workflowId: string): Promise<boolean> {
    const wf = await this.tenantContext.runAsSystem(() =>
      this.workflows.findOne({ where: { id: workflowId } }),
    );
    return !!wf && wantsSchedule(wf);
  }

  private async deleteIfPresent(client: Client, workflowId: string) {
    try {
      await client.schedule.getHandle(scheduleIdFor(workflowId)).delete();
    } catch (err: unknown) {
      if (!(err instanceof ScheduleNotFoundError)) throw err;
    }
  }
}
