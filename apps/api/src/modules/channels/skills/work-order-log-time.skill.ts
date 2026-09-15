import { z } from 'zod';
import {
  CHANNEL_SKILLS,
  isOnTheFloor,
  PERMISSIONS,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import { ProductionService } from '../../production/production.service';
import type { WorkOrderOperation } from '../../production/entities/work-order.entity';
import type { ChannelSkill, PendingChoice, SkillContext } from './skill.types';
import { matchChoice } from './purchase-order-create.skill';

const WO_NUMBER = /WO-\d{4}-\d+/i;

const slotSchema = z.object({
  workOrderNumber: z.string().optional(),
  operationQuery: z.string().optional(),
  minutes: z.number().positive().optional(),
});

export interface ResolvedTimeLog {
  workOrderId: string;
  woNumber: string;
  operationId: string;
  operationLabel: string;
  workCenterName: string;
  minutes: number;
  estimatedMinutes: number;
  loggedMinutes: number;
}

const jsonSchema = {
  type: 'object',
  properties: {
    workOrderNumber: {
      type: 'string',
      description:
        'The work order number mentioned, e.g. "WO-2026-0012". Omit if none is given.',
    },
    operationQuery: {
      type: 'string',
      description:
        'The operation or machine the time was spent on, as written, e.g. "die cutting", "the press", "wrapping". Omit if not stated.',
    },
    minutes: {
      type: 'number',
      description:
        'Time spent, converted to minutes: "1.5 hours" is 90, "an hour and 20" is 80. Omit if no duration is stated — never guess one.',
    },
  },
  additionalProperties: false,
} as const;

/** A duration read straight from the text, so "45" in reply to "how long?" works without the model. */
function minutesFromText(message: string): number | null {
  const text = message.toLowerCase();
  const hm = /(\d+(?:\.\d+)?)\s*h(?:ou)?r?s?\s*(?:and\s*)?(\d+)?\s*m?/.exec(
    text,
  );
  if (hm && /h/.test(hm[0])) {
    return Math.round(Number(hm[1]) * 60 + Number(hm[2] ?? 0));
  }
  const m = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minutes)\b/.exec(text);
  if (m) return Math.round(Number(m[1]));
  if (/^\s*\d+(?:\.\d+)?\s*$/.test(text)) return Math.round(Number(text));
  return null;
}

/**
 * Log time spent on a job's operation from a chat message.
 *
 * Nothing is priced here and nothing is completed: it adds minutes to one
 * operation, which is what the variance report needs and the least a chat
 * message can safely do. Finishing the job still happens on the board.
 */
export class WorkOrderLogTimeSkill implements ChannelSkill<ResolvedTimeLog> {
  readonly name = CHANNEL_SKILLS.WORK_ORDER_LOG_TIME;
  readonly description =
    'Record time spent on an operation of a production work order (a job on the shop floor). Use for messages logging hours or minutes worked on a job, machine or step.';
  readonly examples = [
    'log 45 minutes on WO-2026-0012 die cutting',
    'spent 2 hours on the press for WO-2026-0003',
    'wrapping took 1h 20 on WO-2026-0007',
    'add 30 mins setup to WO-2026-0012',
  ];
  readonly requiredPermissions = [PERMISSIONS.WORK_ORDER_EXECUTE];
  readonly jsonSchema = jsonSchema as unknown as Record<string, unknown>;
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'wo-log-time/1';

  constructor(private readonly production: ProductionService) {}

  async resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedTimeLog>> {
    const working = { ...slots } as Record<string, unknown>;

    const choice = working.pendingChoice as PendingChoice | undefined;
    if (choice) {
      const picked = matchChoice(ctx.message, choice);
      if (!picked)
        return { kind: 'question', question: choice.question, slots: working };
      delete working.pendingChoice;
      working[choice.field] = picked;
    }

    const parsed = slotSchema.safeParse(working);
    if (!parsed.success) {
      return { kind: 'refused', reason: 'I could not make sense of that.' };
    }

    /* ---- the job ---- */
    const numberMatch =
      WO_NUMBER.exec(ctx.message) ??
      (parsed.data.workOrderNumber
        ? WO_NUMBER.exec(parsed.data.workOrderNumber)
        : null);
    const woNumber =
      numberMatch?.[0].toUpperCase() ??
      (working.woNumber as string | undefined);
    if (!woNumber) {
      return {
        kind: 'question',
        question: 'Which work order? Send its number, e.g. "WO-2026-0012".',
        slots: working,
      };
    }
    working.woNumber = woNumber;

    const wo = await this.production.findOpenByNumber(
      ctx.organizationId,
      woNumber,
    );
    if (!wo) {
      return { kind: 'refused', reason: `I couldn't find ${woNumber}.` };
    }
    if (!isOnTheFloor(wo.status)) {
      return {
        kind: 'refused',
        reason:
          wo.status === 'PLANNED'
            ? `${wo.woNumber} hasn't been released to the floor yet.`
            : `${wo.woNumber} is ${wo.status.toLowerCase()} — time can't be added to it.`,
      };
    }

    /* ---- the operation ---- */
    const ops = (
      await this.production.listOperations(ctx.organizationId, wo.id)
    ).filter((op) => op.status !== 'SKIPPED');
    if (ops.length === 0) {
      return {
        kind: 'refused',
        reason: `${wo.woNumber} has no operations to log time against.`,
      };
    }

    let operation = ops.find((op) => op.id === working.operationId);
    if (!operation) {
      const query = parsed.data.operationQuery?.toLowerCase().trim();
      const candidates = query
        ? ops.filter((op) => matches(op, query))
        : ops.filter((op) => op.status !== 'DONE');

      if (candidates.length === 1) {
        operation = candidates[0];
      } else {
        const offered = candidates.length > 1 ? candidates : ops;
        const pending: PendingChoice = {
          field: 'operationId',
          question: `Which operation on ${wo.woNumber}?\n${offered
            .map((op, i) => `${i + 1}. ${op.label} (${op.workCenterName})`)
            .join('\n')}`,
          options: offered.map((op) => ({
            id: op.id,
            label: op.label,
            keywords: [op.label, op.workCenterName],
          })),
        };
        working.pendingChoice = pending;
        return { kind: 'question', question: pending.question, slots: working };
      }
      working.operationId = operation.id;
    }

    /* ---- the time ---- */
    const minutes = parsed.data.minutes ?? minutesFromText(ctx.message);
    if (!minutes) {
      return {
        kind: 'question',
        question: `How long was spent on ${operation.label}? e.g. "45 minutes" or "1h 30".`,
        slots: working,
      };
    }
    if (minutes > 24 * 60) {
      return {
        kind: 'refused',
        reason: 'That is more than a day on one operation. Log it in shifts.',
      };
    }

    return {
      kind: 'resolved',
      value: {
        workOrderId: wo.id,
        woNumber: wo.woNumber,
        operationId: operation.id,
        operationLabel: operation.label,
        workCenterName: operation.workCenterName,
        minutes,
        estimatedMinutes: Math.round(
          operation.estimatedSetupMinutes + operation.estimatedRunMinutes,
        ),
        loggedMinutes: operation.actualMinutes,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async preview(resolved: ResolvedTimeLog): Promise<string> {
    return (
      `Log ${formatMinutes(resolved.minutes)} on ${resolved.woNumber} — ${resolved.operationLabel} (${resolved.workCenterName})? ` +
      `That makes ${formatMinutes(resolved.loggedMinutes + resolved.minutes)} against an estimate of ${formatMinutes(resolved.estimatedMinutes)}.` +
      `\n\nReply YES to confirm or NO to cancel.`
    );
  }

  async execute(
    resolved: ResolvedTimeLog,
    ctx: SkillContext,
  ): Promise<SkillOutcome> {
    const wo = await this.production.logTime(
      ctx.organizationId,
      resolved.workOrderId,
      resolved.operationId,
      ctx.userId,
      resolved.minutes,
    );
    const op = wo.operations.find((o) => o.id === resolved.operationId);
    const total =
      op?.actualMinutes ?? resolved.loggedMinutes + resolved.minutes;
    const over = total - resolved.estimatedMinutes;
    return {
      reply:
        `Logged ${formatMinutes(resolved.minutes)} on ${resolved.woNumber} — ${resolved.operationLabel}. ` +
        `${formatMinutes(total)} so far against ${formatMinutes(resolved.estimatedMinutes)} estimated` +
        (over > 0 ? ` (${formatMinutes(over)} over).` : '.'),
      resultType: 'WORK_ORDER',
      resultId: resolved.workOrderId,
    };
  }
}

function matches(op: WorkOrderOperation, query: string): boolean {
  const haystack =
    `${op.label} ${op.workCenterName} ${op.operationKey ?? ''}`.toLowerCase();
  return query
    .split(/\s+/)
    .filter(
      (word) => word.length > 2 && !['the', 'on', 'for', 'and'].includes(word),
    )
    .some((word) => haystack.includes(word.replace(/ing$/, '')));
}

export function formatMinutes(total: number): string {
  const rounded = Math.round(total);
  if (rounded < 60) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export { minutesFromText };
