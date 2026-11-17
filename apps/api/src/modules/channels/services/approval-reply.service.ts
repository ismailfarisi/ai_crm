import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PERMISSIONS, type Permission } from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { AuditService } from '../../audit/audit.service';
import { QuotesService } from '../../quotes/quotes.service';
import { AutomationApprovalsService } from '../../automations/approvals/automation-approvals.service';
import { AssistantService } from '../../assistant/assistant.service';
import { ChannelConversation } from '../entities/channel-conversation.entity';
import { ChannelProviderType } from '../entities/channel-config.entity';
import type { SkillContext } from '../skills/skill.types';

/** Slot on a chat prompt opened by an approval notice. */
export const APPROVAL_PROMPT_SLOT = '_approval';

export interface ApprovalPromptSlot {
  requestId: string;
  itemType: 'QUOTE' | 'AUTOMATION_APPROVAL' | 'ASSISTANT_ACTION';
  itemId: string;
  title?: string;
  toolCallId?: string;
}

export type ApprovalReply =
  | { kind: 'approve' }
  | { kind: 'reject'; reason: string | null }
  | { kind: 'unclear' };

const APPROVE_WORDS = new Set([
  'yes',
  'y',
  'approve',
  'approved',
  'ok',
  'okay',
  'confirm',
  'go ahead',
  'sure',
]);
const REJECT_WORDS = new Set(['no', 'n', 'reject', 'rejected', 'decline']);

/** "yes", "no", or "reject: price too low". */
export function parseApprovalReply(message: string): ApprovalReply {
  const text = message.trim().toLowerCase();
  if (APPROVE_WORDS.has(text)) return { kind: 'approve' };
  if (REJECT_WORDS.has(text)) return { kind: 'reject', reason: null };
  const match = /^(no|reject|decline)\b[\s:,.-]*(.+)$/i.exec(message.trim());
  if (match) return { kind: 'reject', reason: match[2].trim().slice(0, 500) };
  return { kind: 'unclear' };
}

export function approvalSlotOf(
  conversation: Pick<ChannelConversation, 'slots' | 'status'>,
): ApprovalPromptSlot | null {
  if (conversation.status !== 'AWAITING_CONFIRM') return null;
  const slot = conversation.slots?.[APPROVAL_PROMPT_SLOT] as
    ApprovalPromptSlot | undefined;
  return slot?.itemId && slot.itemType ? slot : null;
}

const REQUIRED: Record<ApprovalPromptSlot['itemType'], Permission[]> = {
  QUOTE: [PERMISSIONS.QUOTE_APPROVE],
  AUTOMATION_APPROVAL: [PERMISSIONS.AUTOMATION_APPROVE],
  // Their own assistant's action; the assistant checks ownership.
  ASSISTANT_ACTION: [],
};

const SUBJECT: Record<ApprovalPromptSlot['itemType'], string> = {
  QUOTE: 'QUOTE',
  AUTOMATION_APPROVAL: 'AUTOMATION_APPROVAL',
  ASSISTANT_ACTION: 'ASSISTANT_TURN',
};

/**
 * Decides an approval from a reply to its chat notice, through the same
 * service call the app makes: permissions are re-resolved for this message,
 * the service's own guards apply, and the decision is audited with the chat
 * as its channel. A YES to a quote is not handled here: it goes through the
 * quote approval skill's own confirmation (returns null).
 */
@Injectable()
export class ApprovalReplyService {
  private readonly logger = new Logger(ApprovalReplyService.name);

  constructor(
    @InjectRepository(ChannelConversation)
    private readonly conversations: Repository<ChannelConversation>,
    private readonly audit: AuditService,
    private readonly quotes: QuotesService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async handle(
    conversation: ChannelConversation,
    slot: ApprovalPromptSlot,
    ctx: SkillContext,
  ): Promise<string | null> {
    const reply = parseApprovalReply(ctx.message);
    if (reply.kind === 'unclear') {
      return 'Reply YES to approve, or NO to reject. Add a reason after NO if you like.';
    }
    if (reply.kind === 'approve' && slot.itemType === 'QUOTE') return null;

    const missing = REQUIRED[slot.itemType].filter(
      (p) => !ctx.permissions.includes(p),
    );
    if (missing.length) {
      await this.finish(conversation.id, 'CANCELLED');
      return "You don't have permission to decide this one.";
    }

    // One reply wins: a redelivered message finds the prompt already closed.
    const claim = await this.conversations
      .createQueryBuilder()
      .update(ChannelConversation)
      .set({ status: 'CONFIRMED', resolvedAt: new Date() })
      .where('id = :id', { id: conversation.id })
      .andWhere('status = :status', { status: 'AWAITING_CONFIRM' })
      .execute();
    if (!claim.affected) return 'That one is already decided.';

    const approve = reply.kind === 'approve';
    const reason = reply.kind === 'reject' ? reply.reason : null;
    try {
      await this.decide(slot, ctx, approve, reason);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Chat decision on ${slot.itemType} ${slot.itemId} failed: ${msg}`,
      );
      await this.finish(conversation.id, 'CANCELLED');
      return `Could not record that: ${msg}`;
    }

    await this.audit.record({
      tenantId: ctx.organizationId,
      actorId: ctx.userId,
      action: `approval.${approve ? 'approve' : 'reject'}`,
      subjectType: SUBJECT[slot.itemType],
      subjectId: slot.itemId,
      summary:
        `${approve ? 'Approved' : 'Rejected'} by chat reply${reason ? `: ${reason}` : ''}`.slice(
          0,
          200,
        ),
      after: { decision: approve ? 'APPROVED' : 'REJECTED', reason },
      origin: 'HUMAN',
      channel: channelFor(ctx.provider),
      messageId: conversation.originMessageId,
    });
    const what = slot.title ? ` ${slot.title}` : '';
    return approve ? `Approved${what}.` : `Rejected${what}.`;
  }

  private async decide(
    slot: ApprovalPromptSlot,
    ctx: SkillContext,
    approve: boolean,
    reason: string | null,
  ): Promise<void> {
    switch (slot.itemType) {
      case 'QUOTE':
        await this.quotes.sendSignal(
          ctx.organizationId,
          slot.itemId,
          'REJECT',
          { reason: reason ?? 'Rejected by chat reply' },
          ctx.userId,
        );
        return;
      case 'AUTOMATION_APPROVAL':
        await this.moduleRef
          .get(AutomationApprovalsService, { strict: false })
          .decide(
            ctx.organizationId,
            slot.itemId,
            { id: ctx.userId },
            {
              action: approve ? 'APPROVE' : 'REJECT',
              ...(reason ? { comment: reason } : {}),
            },
          );
        return;
      case 'ASSISTANT_ACTION': {
        if (!slot.toolCallId)
          throw new Error('This action can only be decided in the app');
        const actor = {
          id: ctx.userId,
          organizationId: ctx.organizationId,
          permissions: ctx.permissions,
        } as AuthenticatedUser;
        await this.moduleRef
          .get(AssistantService, { strict: false })
          .decide(actor, slot.itemId, {
            approved: approve,
            toolCallId: slot.toolCallId,
            ...(reason ? { note: reason } : {}),
          });
        return;
      }
    }
  }

  private async finish(id: string, status: 'CANCELLED'): Promise<void> {
    await this.conversations.update(id, { status, resolvedAt: new Date() });
  }
}

function channelFor(
  provider: ChannelProviderType,
): 'TELEGRAM' | 'WHATSAPP' | 'SYSTEM' {
  if (provider === ChannelProviderType.TELEGRAM) return 'TELEGRAM';
  if (provider === ChannelProviderType.WHATSAPP_META) return 'WHATSAPP';
  return 'SYSTEM';
}
