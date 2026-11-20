import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CHANNEL_HANDOVER_REASON_LABELS,
  PERMISSIONS,
  type ChannelHandoverReason,
  type ChannelThreadState,
} from '@saas/shared';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ChannelThread } from '../entities/channel-thread.entity';

/**
 * Whether the AI or a person is answering each customer conversation, and
 * the moves between the two.
 */
@Injectable()
export class ChannelThreadService {
  constructor(
    @InjectRepository(ChannelThread)
    private readonly repo: Repository<ChannelThread>,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string): Promise<ChannelThread[]> {
    return this.repo.find({
      where: { organizationId },
      order: { updatedAt: 'DESC' },
      take: 500,
    });
  }

  async getOrCreate(
    organizationId: string,
    provider: string,
    contactId: string,
  ): Promise<ChannelThread> {
    const where = { organizationId, provider, contactId };
    const existing = await this.repo.findOne({ where });
    if (existing) return existing;
    // Two webhooks for a new contact can race; the unique index decides.
    await this.repo
      .createQueryBuilder()
      .insert()
      .values({ ...where, state: 'AI' })
      .orIgnore()
      .execute();
    return this.repo.findOneOrFail({ where });
  }

  /**
   * Called for every customer message before any AI work. Returns whether
   * the AI may act on it: a resolved conversation starts again with the AI,
   * and one a person holds (or is waiting for) is left alone.
   */
  async admitInbound(
    organizationId: string,
    provider: string,
    contactId: string,
  ): Promise<boolean> {
    const thread = await this.getOrCreate(organizationId, provider, contactId);
    if (thread.state === 'RESOLVED') {
      await this.move(thread, 'AI', { assigneeUserId: null });
      return true;
    }
    return thread.state === 'AI';
  }

  /** The AI steps back. A no-op unless the AI currently holds the conversation. */
  async handOver(input: {
    organizationId: string;
    provider: string;
    contactId: string;
    reason: ChannelHandoverReason;
    summary?: string | null;
  }): Promise<{ handedOver: boolean; thread: ChannelThread }> {
    const thread = await this.getOrCreate(
      input.organizationId,
      input.provider,
      input.contactId,
    );
    if (thread.state !== 'AI') return { handedOver: false, thread };
    const moved = await this.move(thread, 'NEEDS_HUMAN', {
      handoverReason: input.reason,
      handoverSummary: input.summary ?? null,
      handedOverAt: new Date(),
      assigneeUserId: null,
    });
    await this.notifications.notifyHolders(
      input.organizationId,
      PERMISSIONS.CHANNEL_SEND,
      {
        type: 'CONVERSATION_HANDOVER',
        title: 'A conversation needs a person',
        body: input.summary
          ? `${CHANNEL_HANDOVER_REASON_LABELS[input.reason]}: ${input.summary}`
          : CHANNEL_HANDOVER_REASON_LABELS[input.reason],
        link: `/inbox?thread=${input.contactId}`,
        entityType: 'channel_thread',
        entityId: moved.id,
      },
    );
    await this.audit.record({
      tenantId: input.organizationId,
      action: 'channel_thread.hand_over',
      subjectType: 'channel_thread',
      subjectId: moved.id,
      summary: CHANNEL_HANDOVER_REASON_LABELS[input.reason],
      after: { state: moved.state, handoverReason: moved.handoverReason },
    });
    return { handedOver: true, thread: moved };
  }

  /** A member of staff takes the conversation; the AI stays quiet until it is returned. */
  async takeOver(
    organizationId: string,
    id: string,
    userId: string,
    reason: ChannelHandoverReason = 'STAFF_TOOK_OVER',
  ): Promise<ChannelThread> {
    const thread = await this.findOne(organizationId, id);
    return this.move(thread, 'HUMAN', {
      assigneeUserId: userId,
      handoverReason: thread.handoverReason ?? reason,
      handedOverAt: thread.handedOverAt ?? new Date(),
    });
  }

  /** Staff replied from the inbox: that conversation is theirs now. */
  async takeOverByContact(
    organizationId: string,
    provider: string,
    contactId: string,
    userId: string,
  ): Promise<void> {
    const thread = await this.getOrCreate(organizationId, provider, contactId);
    if (thread.state === 'HUMAN' && thread.assigneeUserId === userId) return;
    await this.takeOver(organizationId, thread.id, userId, 'STAFF_REPLIED');
  }

  async returnToAi(organizationId: string, id: string): Promise<ChannelThread> {
    const thread = await this.findOne(organizationId, id);
    return this.move(thread, 'AI', {
      assigneeUserId: null,
      handoverReason: null,
      handoverSummary: null,
      handedOverAt: null,
    });
  }

  async resolve(organizationId: string, id: string): Promise<ChannelThread> {
    const thread = await this.findOne(organizationId, id);
    return this.move(thread, 'RESOLVED', {});
  }

  private async findOne(
    organizationId: string,
    id: string,
  ): Promise<ChannelThread> {
    const thread = await this.repo.findOne({ where: { organizationId, id } });
    if (!thread) throw new NotFoundException('Conversation not found');
    return thread;
  }

  private move(
    thread: ChannelThread,
    state: ChannelThreadState,
    patch: Partial<ChannelThread>,
  ): Promise<ChannelThread> {
    Object.assign(thread, patch, { state });
    return this.repo.save(thread);
  }
}
