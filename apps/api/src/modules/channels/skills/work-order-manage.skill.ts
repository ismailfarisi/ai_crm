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
  workOrderNumber: z.string().optional(),
  action: z.enum(['START', 'STOP', 'FINISH', 'RELEASE', 'COMPLETE', 'CANCEL', 'ADVANCE']).optional(),
  operationQuery: z.string().optional(),
  quantityCompleted: z.number().positive().optional(),
  cancelReason: z.string().optional(),
});

export interface ResolvedWorkOrderManage {
  workOrderId: string;
  woNumber: string;
  action: 'START' | 'STOP' | 'FINISH' | 'RELEASE' | 'COMPLETE' | 'CANCEL' | 'ADVANCE';
  operationId?: string;
  operationLabel?: string;
  quantityCompleted?: number;
  cancelReason?: string;
}

export class WorkOrderManageSkill implements ChannelSkill<ResolvedWorkOrderManage> {
  readonly name = CHANNEL_SKILLS.WORK_ORDER_MANAGE;
  readonly description =
    'Manage production work orders and operation timers: release jobs, start/pause/finish operation clocks, advance to the next step, or mark jobs complete.';
  readonly examples = [
    'start die cutting on WO-2026-0003',
    'pause timer on WO-2026-0003',
    'finish printing on WO-2026-0003 and advance',
    'release WO-2026-0003 to the floor',
    'mark WO-2026-0001 complete with 200 pcs',
  ];
  readonly requiredPermissions = [PERMISSIONS.WORK_ORDER_EXECUTE];
  readonly jsonSchema = {
    type: 'object',
    properties: {
      workOrderNumber: { type: 'string', description: 'Work order number, e.g. "WO-2026-0003"' },
      action: {
        type: 'string',
        enum: ['START', 'STOP', 'FINISH', 'RELEASE', 'COMPLETE', 'CANCEL', 'ADVANCE'],
        description: 'The production action to execute',
      },
      operationQuery: { type: 'string', description: 'Operation or machine name, e.g. "die cutting"' },
      quantityCompleted: { type: 'number', description: 'Good pieces produced when completing a job' },
      cancelReason: { type: 'string', description: 'Reason for cancellation' },
    },
    additionalProperties: false,
  };
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'wo-manage/1';

  constructor(private readonly production: ProductionService) {}

  async resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedWorkOrderManage>> {
    const rawNumber = typeof slots.workOrderNumber === 'string' ? slots.workOrderNumber : '';
    const match = rawNumber.match(/WO-\d{4}-\d+/i);
    const woNum = match ? match[0].toUpperCase() : rawNumber.trim().toUpperCase();

    if (!woNum) {
      return { kind: 'question', question: 'Which work order would you like to update? (e.g. WO-2026-0003)', slots };
    }

    const jobs = await this.production.list(ctx.organizationId, {} as WorkOrderQueryPayload, false);
    const wo = jobs.find((j) => j.woNumber.toUpperCase() === woNum);
    if (!wo) {
      return { kind: 'refused', reason: `I could not find work order ${woNum}.` };
    }

    const action = (slots.action as ResolvedWorkOrderManage['action']) || 'START';

    if (action === 'RELEASE') {
      return {
        kind: 'resolved',
        value: { workOrderId: wo.id, woNumber: wo.woNumber, action: 'RELEASE' },
      };
    }

    if (action === 'COMPLETE') {
      const qty = typeof slots.quantityCompleted === 'number' ? slots.quantityCompleted : wo.qty;
      return {
        kind: 'resolved',
        value: { workOrderId: wo.id, woNumber: wo.woNumber, action: 'COMPLETE', quantityCompleted: qty },
      };
    }

    if (action === 'CANCEL') {
      return {
        kind: 'resolved',
        value: { workOrderId: wo.id, woNumber: wo.woNumber, action: 'CANCEL', cancelReason: (slots.cancelReason as string) ?? 'Cancelled via chat' },
      };
    }

    const opQuery = typeof slots.operationQuery === 'string' ? slots.operationQuery.toLowerCase().trim() : null;
    let targetOp = opQuery
      ? wo.operations.find(
          (op) =>
            op.label.toLowerCase().includes(opQuery) ||
            op.workCenterName.toLowerCase().includes(opQuery),
        )
      : undefined;

    if (!targetOp) {
      if (action === 'STOP') {
        targetOp = wo.operations.find((op) => op.status === 'RUNNING');
      } else if (action === 'START' || action === 'ADVANCE') {
        targetOp = wo.operations.find((op) => op.status === 'PENDING');
      }
    }

    if (!targetOp && (action === 'START' || action === 'STOP' || action === 'FINISH')) {
      const opList = wo.operations.map((op, i) => `${i + 1}. ${op.label} (${op.status})`).join('\n');
      return {
        kind: 'question',
        question: `Which operation on ${wo.woNumber}?\n${opList}`,
        slots: { ...slots, workOrderNumber: wo.woNumber, action },
      };
    }

    return {
      kind: 'resolved',
      value: {
        workOrderId: wo.id,
        woNumber: wo.woNumber,
        action,
        operationId: targetOp?.id,
        operationLabel: targetOp?.label,
      },
    };
  }

  async preview(value: ResolvedWorkOrderManage): Promise<string> {
    if (value.action === 'RELEASE') return `Release ${value.woNumber} to the floor?`;
    if (value.action === 'COMPLETE') return `Complete ${value.woNumber} with ${value.quantityCompleted ?? 0} pieces?`;
    if (value.action === 'CANCEL') return `Cancel ${value.woNumber}?`;
    return `${value.action} ${value.operationLabel ?? 'operation'} on ${value.woNumber}?`;
  }

  async execute(value: ResolvedWorkOrderManage, ctx: SkillContext): Promise<SkillOutcome> {
    switch (value.action) {
      case 'RELEASE': {
        await this.production.release(ctx.organizationId, value.workOrderId);
        return { reply: `✅ ${value.woNumber} has been released to the shop floor.`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
      case 'COMPLETE': {
        await this.production.complete(ctx.organizationId, value.workOrderId, ctx.userId, { qtyCompleted: value.quantityCompleted ?? null }, false);
        return { reply: `✅ ${value.woNumber} marked COMPLETE (${value.quantityCompleted} units posted).`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
      case 'CANCEL': {
        await this.production.cancel(ctx.organizationId, value.workOrderId, value.cancelReason ?? 'Cancelled via chat');
        return { reply: `⚠️ ${value.woNumber} cancelled.`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
      case 'START': {
        if (!value.operationId) throw new Error('Operation is required to start clock');
        await this.production.startOperation(ctx.organizationId, value.workOrderId, value.operationId, ctx.userId);
        return { reply: `⏱️ Started timer for "${value.operationLabel}" on ${value.woNumber}.`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
      case 'STOP': {
        if (!value.operationId) throw new Error('Operation is required to stop clock');
        await this.production.stopOperation(ctx.organizationId, value.workOrderId, value.operationId, false);
        return { reply: `⏸️ Paused "${value.operationLabel}" on ${value.woNumber}. Time logged.`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
      case 'FINISH':
      case 'ADVANCE': {
        if (!value.operationId) throw new Error('Operation is required to finish');
        await this.production.stopOperation(ctx.organizationId, value.workOrderId, value.operationId, true);
        return { reply: `✅ Finished "${value.operationLabel}" on ${value.woNumber}. Step marked DONE.`, resultType: 'WORK_ORDER', resultId: value.workOrderId };
      }
    }
  }
}
