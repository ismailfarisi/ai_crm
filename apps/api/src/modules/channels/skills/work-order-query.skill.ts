import { z } from 'zod';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type SkillOutcome,
  type SkillResolution,
  type WorkOrderQueryPayload,
} from '@saas/shared';
import { ProductionService } from '../../production/production.service';
import type { ChannelSkill, SkillContext } from './skill.types';

const slotSchema = z.object({
  queryType: z.enum(['ACTIVE_JOBS', 'JOB_STATUS', 'OVERDUE_JOBS']).optional(),
  workOrderNumber: z.string().optional(),
});

export interface ResolvedWorkOrderQuery {
  queryType: 'ACTIVE_JOBS' | 'JOB_STATUS' | 'OVERDUE_JOBS';
  workOrderNumber?: string;
}

export class WorkOrderQuerySkill implements ChannelSkill<ResolvedWorkOrderQuery> {
  readonly name = CHANNEL_SKILLS.WORK_ORDER_QUERY;
  readonly description =
    'Query the production floor status: ask what machines or jobs are currently running, check the status of a specific work order, or list delayed jobs.';
  readonly examples = [
    'what is running right now?',
    'show floor status',
    'status of WO-2026-0003',
    'any jobs overdue?',
  ];
  readonly requiredPermissions = [PERMISSIONS.WORK_ORDER_READ];
  readonly jsonSchema = {
    type: 'object',
    properties: {
      queryType: {
        type: 'string',
        enum: ['ACTIVE_JOBS', 'JOB_STATUS', 'OVERDUE_JOBS'],
        description: 'Type of production query',
      },
      workOrderNumber: { type: 'string', description: 'Work order number, e.g. "WO-2026-0003"' },
    },
    additionalProperties: false,
  };
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'wo-query/1';

  constructor(private readonly production: ProductionService) {}

  async resolve(
    slots: Record<string, unknown>,
    _ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedWorkOrderQuery>> {
    const rawNumber = typeof slots.workOrderNumber === 'string' ? slots.workOrderNumber : '';
    const match = rawNumber.match(/WO-\d{4}-\d+/i);
    const woNum = match ? match[0].toUpperCase() : (rawNumber.trim() ? rawNumber.trim().toUpperCase() : undefined);

    let queryType = (slots.queryType as ResolvedWorkOrderQuery['queryType']) || 'ACTIVE_JOBS';
    if (woNum) {
      queryType = 'JOB_STATUS';
    }

    return {
      kind: 'resolved',
      value: { queryType, workOrderNumber: woNum },
    };
  }

  async preview(value: ResolvedWorkOrderQuery): Promise<string> {
    if (value.queryType === 'JOB_STATUS') return `Check status of ${value.workOrderNumber}?`;
    if (value.queryType === 'OVERDUE_JOBS') return `List overdue production jobs?`;
    return `Check active jobs on the floor?`;
  }

  async execute(value: ResolvedWorkOrderQuery, ctx: SkillContext): Promise<SkillOutcome> {
    const jobs = await this.production.list(ctx.organizationId, {} as WorkOrderQueryPayload, false);

    if (value.queryType === 'JOB_STATUS' && value.workOrderNumber) {
      const wo = jobs.find((j) => j.woNumber.toUpperCase() === value.workOrderNumber);
      if (!wo) {
        return { reply: `Could not find work order ${value.workOrderNumber}.` };
      }
      const doneOps = wo.operations.filter((op) => op.status === 'DONE').length;
      const runningOp = wo.operations.find((op) => op.status === 'RUNNING');
      const dueStr = wo.dueDate ? ` · Due: ${new Date(wo.dueDate).toLocaleDateString()}` : '';

      return {
        reply: `📋 **${wo.woNumber}** (${wo.description})\nStatus: ${wo.status}${dueStr}\nProgress: ${doneOps}/${wo.operations.length} operations completed${
          runningOp ? `\nCurrently running: ${runningOp.label}` : ''
        }`,
        resultType: 'WORK_ORDER',
        resultId: wo.id,
      };
    }

    if (value.queryType === 'OVERDUE_JOBS') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const overdue = jobs.filter((j) => j.status !== 'COMPLETE' && j.status !== 'CANCELLED' && j.dueDate && new Date(j.dueDate) < today);
      if (overdue.length === 0) {
        return { reply: '✅ All production jobs are currently on track. No overdue work orders.' };
      }
      const lines = overdue.map((j) => `• ${j.woNumber}: ${j.description} (Due ${new Date(j.dueDate!).toLocaleDateString()})`);
      return { reply: `⚠️ **${overdue.length} Overdue Job(s):**\n${lines.join('\n')}` };
    }

    // Default: ACTIVE_JOBS
    const running: { woNumber: string; opLabel: string }[] = [];
    for (const job of jobs) {
      for (const op of job.operations) {
        if (op.status === 'RUNNING') {
          running.push({ woNumber: job.woNumber, opLabel: op.label });
        }
      }
    }

    if (running.length === 0) {
      return { reply: 'ℹ️ No machine clocks or operations are currently running on the floor.' };
    }

    const lines = running.map((r) => `• **${r.woNumber}**: ${r.opLabel} (running)`);
    return { reply: `🏭 **Active Shop Floor Operations (${running.length}):**\n${lines.join('\n')}` };
  }
}
