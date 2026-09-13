import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import {
  CHANNEL_CONVERSATION_TTL_MS,
  type ChannelSkillName,
} from '@saas/shared';
import { StaffChannelIdentity } from '../entities/staff-channel-identity.entity';
import { ChannelLinkCode } from '../entities/channel-link-code.entity';
import { ChannelConversation } from '../entities/channel-conversation.entity';
import { ChannelProviderType } from '../entities/channel-config.entity';
import { RbacService } from '../../rbac/rbac.service';
import { SkillRegistry } from '../skills/skill.registry';
import {
  AiUnavailableError,
  SkillRouterService,
} from '../skills/skill-router.service';
import type { ChannelSkill, SkillContext } from '../skills/skill.types';

export interface ChannelCommandResult {
  handled: boolean;
  userId?: string;
  reply?: { body: string };
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LENGTH = 8;
const LINK_CODE_TTL_MS = 15 * 60 * 1000;

const AFFIRMATIVE_REPLIES = new Set([
  'yes',
  'y',
  'confirm',
  'approve',
  'ok',
  'okay',
  'go ahead',
  'do it',
  'sure',
]);
const NEGATIVE_REPLIES = new Set([
  'no',
  'n',
  'cancel',
  'stop',
  'nevermind',
  'never mind',
  "don't",
  'dont',
]);

/** Reserved slot key holding a skill's resolved value between preview and execution. */
const RESOLVED_KEY = '_resolved';

/**
 * Lets internal staff drive Relay by texting the org's Telegram/WhatsApp/Email
 * channel in plain English.
 *
 * Only recognizes senders already linked via a one-time code — see
 * `ChannelsService.processInboundWebhook`, which calls `handleInboundMessage`
 * before falling through to the ordinary customer-contact path.
 *
 * This orchestrates; it does not know what any individual command does. The
 * capabilities live in `SkillRegistry`, so adding one is a new file rather
 * than another branch and two more injected services here.
 */
@Injectable()
export class ChannelCommandService {
  private readonly logger = new Logger(ChannelCommandService.name);

  constructor(
    @InjectRepository(StaffChannelIdentity)
    private readonly identityRepository: Repository<StaffChannelIdentity>,
    @InjectRepository(ChannelLinkCode)
    private readonly linkCodeRepository: Repository<ChannelLinkCode>,
    @InjectRepository(ChannelConversation)
    private readonly conversations: Repository<ChannelConversation>,
    private readonly rbacService: RbacService,
    private readonly registry: SkillRegistry,
    private readonly router: SkillRouterService,
  ) {}

  // ---- Settings-facing API (linking codes + identity management) ----

  async createLinkCode(
    organizationId: string,
    userId: string,
  ): Promise<{ code: string; expiresAt: Date }> {
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    await this.linkCodeRepository.save(
      this.linkCodeRepository.create({
        organizationId,
        userId,
        code,
        expiresAt,
      }),
    );
    return { code, expiresAt };
  }

  async listIdentities(
    organizationId: string,
    userId: string,
  ): Promise<StaffChannelIdentity[]> {
    return this.identityRepository.find({
      where: { organizationId, userId },
      order: { createdAt: 'DESC' },
    });
  }

  async revokeIdentity(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    await this.identityRepository.delete({ id, organizationId, userId });
  }

  private generateCode(): string {
    let code = '';
    const bytes = randomBytes(CODE_LENGTH);
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return code;
  }

  // ---- Inbound message routing ----

  async handleInboundMessage(
    organizationId: string,
    provider: ChannelProviderType,
    senderIdentifier: string,
    body: string,
  ): Promise<ChannelCommandResult> {
    const message = (body || '').trim();

    const linked = await this.tryConsumeLinkCode(
      organizationId,
      provider,
      senderIdentifier,
      message,
    );
    if (linked) return linked;

    const identity = await this.identityRepository.findOne({
      where: { organizationId, provider, identifier: senderIdentifier },
    });
    // An unlinked sender learns nothing: fall through to the customer path
    // exactly as before, with no hint that a staff command surface exists.
    if (!identity) return { handled: false };

    const userId = identity.userId;
    const access = await this.rbacService.resolveAccess(userId, organizationId);
    const ctx: SkillContext = {
      organizationId,
      userId,
      provider,
      senderIdentifier,
      permissions: access.permissions,
      message,
    };

    await this.expireStale(organizationId, provider, senderIdentifier);
    const live = await this.findLiveConversation(
      organizationId,
      provider,
      senderIdentifier,
    );

    if (live?.status === 'AWAITING_CONFIRM') {
      return this.handleConfirmation(live, ctx);
    }
    if (live?.status === 'COLLECTING') {
      return this.continueCollecting(live, ctx);
    }

    // A bare "yes" with nothing pending is almost always a provider
    // redelivering a confirmation it already delivered, or a person replying
    // to a message that has since expired. Routing it as a fresh command
    // would spend a model call to conclude nothing, and answer with a help
    // message that reads as if the original action never happened.
    const normalized = message.toLowerCase();
    if (
      AFFIRMATIVE_REPLIES.has(normalized) ||
      NEGATIVE_REPLIES.has(normalized)
    ) {
      return this.handleStrayConfirmation(ctx);
    }

    return this.startFresh(ctx);
  }

  /** Answers a confirmation that has no live conversation behind it. */
  private async handleStrayConfirmation(
    ctx: SkillContext,
  ): Promise<ChannelCommandResult> {
    const recent = await this.conversations.find({
      where: {
        organizationId: ctx.organizationId,
        provider: ctx.provider,
        senderIdentifier: ctx.senderIdentifier,
      },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    const last = recent[0];
    if (last?.status === 'CONFIRMED') {
      return this.reply(
        ctx,
        'That one is already done — nothing further to do.',
      );
    }
    if (last?.status === 'CANCELLED') {
      return this.reply(ctx, 'That one was already cancelled — nothing to do.');
    }
    return this.reply(
      ctx,
      'Nothing is waiting on a confirmation — it may have expired. Send the command again.',
    );
  }

  private async tryConsumeLinkCode(
    organizationId: string,
    provider: ChannelProviderType,
    senderIdentifier: string,
    trimmedBody: string,
  ): Promise<ChannelCommandResult | null> {
    if (!trimmedBody || trimmedBody.includes(' ')) return null;

    const candidate = await this.linkCodeRepository.findOne({
      where: {
        organizationId,
        code: trimmedBody.toUpperCase(),
        consumedAt: IsNull(),
      },
    });
    if (!candidate || candidate.expiresAt.getTime() < Date.now()) return null;

    candidate.consumedAt = new Date();
    await this.linkCodeRepository.save(candidate);

    const existing = await this.identityRepository.findOne({
      where: { organizationId, provider, identifier: senderIdentifier },
    });
    if (!existing) {
      await this.identityRepository.save(
        this.identityRepository.create({
          organizationId,
          provider,
          identifier: senderIdentifier,
          userId: candidate.userId,
        }),
      );
    }

    return {
      handled: true,
      userId: candidate.userId,
      reply: {
        body: 'This channel is now linked to your Relay account. Try "approve QT-2026-0004" or "order 500 sheets of 350gsm board from Papertree".',
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * Conversation states
   * ------------------------------------------------------------------ */

  private async handleConfirmation(
    conversation: ChannelConversation,
    ctx: SkillContext,
  ): Promise<ChannelCommandResult> {
    const normalized = ctx.message.toLowerCase();

    if (NEGATIVE_REPLIES.has(normalized)) {
      await this.close(conversation, 'CANCELLED');
      return this.reply(ctx, 'Cancelled — no changes made.');
    }
    if (!AFFIRMATIVE_REPLIES.has(normalized)) {
      return this.reply(
        ctx,
        `Still waiting on your confirmation. Reply YES to go ahead or NO to cancel.`,
      );
    }

    const skill = this.registry.byName(conversation.skillName);
    if (!skill) {
      await this.close(conversation, 'CANCELLED');
      return this.reply(ctx, 'That command is no longer available.');
    }

    // Authority is re-checked here, not reused from when the proposal was
    // made. Permissions sit behind a short cache and a confirmation can
    // arrive fifteen minutes later; a role revoked in between must bite.
    const missing = skill.requiredPermissions.filter(
      (p) => !ctx.permissions.includes(p),
    );
    if (missing.length > 0) {
      await this.close(conversation, 'CANCELLED');
      return this.reply(
        ctx,
        'Your permissions changed — that action is no longer available to you.',
      );
    }

    // Claim the conversation before doing anything. A provider redelivering a
    // webhook it believes failed must not raise a second purchase order: the
    // loser of this conditional update did not claim it, so it reports the
    // work as already done rather than repeating it.
    const claim = await this.conversations
      .createQueryBuilder()
      .update(ChannelConversation)
      .set({
        status: 'CONFIRMED',
        resolvedAt: new Date(),
        idempotencyKey: `confirm:${conversation.id}`,
      })
      .where('id = :id AND status = :status', {
        id: conversation.id,
        status: 'AWAITING_CONFIRM',
      })
      .execute();

    if (!claim.affected) {
      return this.reply(
        ctx,
        'That one is already done — nothing further to do.',
      );
    }

    try {
      const resolved = conversation.slots[RESOLVED_KEY];
      const outcome = await skill.execute(resolved as never, ctx);
      await this.conversations.update(conversation.id, {
        resultType: outcome.resultType ?? null,
        resultId: outcome.resultId ?? null,
      });
      return this.reply(ctx, outcome.reply);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Skill ${conversation.skillName} failed: ${msg}`);
      return this.reply(ctx, `Could not complete that: ${msg}`);
    }
  }

  private async continueCollecting(
    conversation: ChannelConversation,
    ctx: SkillContext,
  ): Promise<ChannelCommandResult> {
    if (NEGATIVE_REPLIES.has(ctx.message.toLowerCase())) {
      await this.close(conversation, 'CANCELLED');
      return this.reply(ctx, 'Cancelled — no changes made.');
    }

    const skill = this.registry.byName(conversation.skillName);
    if (!skill) {
      await this.close(conversation, 'CANCELLED');
      return this.startFresh(ctx);
    }

    const prior = { ...conversation.slots };
    delete prior[RESOLVED_KEY];

    // A pending choice is answered in code, so no model call is needed and no
    // model gets the chance to invent an id.
    let merged = prior;
    let model = conversation.originModel;
    if (!prior.pendingChoice) {
      try {
        const extracted = await this.router.extract(
          ctx.message,
          skill,
          prior,
          ctx,
        );
        merged = this.mergeSlots(prior, extracted.slots);
        model = extracted.model;
      } catch (err) {
        if (!(err instanceof AiUnavailableError)) throw err;
        return this.reply(ctx, this.degradedMessage());
      }
    }

    return this.advance(skill, merged, ctx, conversation, model);
  }

  private async startFresh(ctx: SkillContext): Promise<ChannelCommandResult> {
    if (!ctx.message) return this.reply(ctx, this.helpMessage(ctx));

    const candidates = this.registry.permittedFor(ctx.permissions);
    if (candidates.length === 0) {
      return this.reply(
        ctx,
        "You don't have permission to run any commands here.",
      );
    }

    let route;
    try {
      route = await this.router.route(ctx.message, candidates, ctx);
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      return this.reply(ctx, this.degradedMessage());
    }

    if (!route.skill) return this.reply(ctx, this.helpMessage(ctx));

    // A low-confidence route is a suggestion, never a decision. A wrong guess
    // that reaches the confirmation step is a wrong document one "yes" away.
    if (route.confidence < this.router.minConfidence) {
      return this.reply(
        ctx,
        `I'm not sure what you'd like me to do. ${this.helpMessage(ctx)}`,
      );
    }

    const skill = this.registry.byName(route.skill);
    if (!skill) return this.reply(ctx, this.helpMessage(ctx));

    let extracted;
    try {
      extracted = await this.router.extract(ctx.message, skill, {}, ctx);
    } catch (err) {
      if (!(err instanceof AiUnavailableError)) throw err;
      return this.reply(ctx, this.degradedMessage());
    }

    return this.advance(
      skill,
      extracted.slots,
      ctx,
      null,
      extracted.model,
      route.confidence,
    );
  }

  /** Resolve, then either ask, refuse, or propose. The single place that writes conversation state. */
  private async advance(
    skill: ChannelSkill<never>,
    slots: Record<string, unknown>,
    ctx: SkillContext,
    existing: ChannelConversation | null,
    model?: string | null,
    confidence?: number,
  ): Promise<ChannelCommandResult> {
    const resolution = await skill.resolve(slots, ctx);

    if (resolution.kind === 'refused') {
      if (existing) await this.close(existing, 'CANCELLED');
      return this.reply(ctx, resolution.reason);
    }

    if (resolution.kind === 'question') {
      await this.persist(ctx, skill.name, resolution.slots, 'COLLECTING', {
        pendingQuestion: resolution.question,
        existing,
        model,
        confidence,
        promptVersion: skill.promptVersion,
      });
      return this.reply(ctx, resolution.question);
    }

    const preview = await skill.preview(resolution.value, ctx);
    await this.persist(
      ctx,
      skill.name,
      { ...slots, [RESOLVED_KEY]: resolution.value },
      'AWAITING_CONFIRM',
      {
        pendingQuestion: null,
        existing,
        model,
        confidence,
        promptVersion: skill.promptVersion,
      },
    );
    return this.reply(ctx, preview);
  }

  /* ------------------------------------------------------------------ *
   * Conversation persistence
   * ------------------------------------------------------------------ */

  private async findLiveConversation(
    organizationId: string,
    provider: ChannelProviderType,
    senderIdentifier: string,
  ): Promise<ChannelConversation | null> {
    const rows = await this.conversations.find({
      where: [
        { organizationId, provider, senderIdentifier, status: 'COLLECTING' },
        {
          organizationId,
          provider,
          senderIdentifier,
          status: 'AWAITING_CONFIRM',
        },
      ],
      order: { createdAt: 'DESC' },
      take: 1,
    });
    const row = rows[0];
    if (!row) return null;
    return row.expiresAt.getTime() > Date.now() ? row : null;
  }

  private async expireStale(
    organizationId: string,
    provider: ChannelProviderType,
    senderIdentifier: string,
  ): Promise<void> {
    await this.conversations.update(
      {
        organizationId,
        provider,
        senderIdentifier,
        status: Not(In(['CONFIRMED', 'CANCELLED', 'EXPIRED'])),
        expiresAt: LessThan(new Date()),
      },
      { status: 'EXPIRED', resolvedAt: new Date() },
    );
  }

  private async persist(
    ctx: SkillContext,
    skillName: ChannelSkillName,
    slots: Record<string, unknown>,
    status: 'COLLECTING' | 'AWAITING_CONFIRM',
    extra: {
      pendingQuestion: string | null;
      existing: ChannelConversation | null;
      model?: string | null;
      confidence?: number;
      promptVersion: string;
    },
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + CHANNEL_CONVERSATION_TTL_MS);

    if (extra.existing) {
      // `save` rather than `update`: TypeORM's update typing cannot express a
      // free-form jsonb column, and the row is already loaded here anyway.
      await this.conversations.save({
        ...extra.existing,
        slots,
        status,
        pendingQuestion: extra.pendingQuestion,
        expiresAt,
        originModel: extra.model ?? extra.existing.originModel,
      });
      return;
    }

    // One live command per sender: a new one supersedes whatever was open
    // rather than racing it.
    await this.conversations.update(
      {
        organizationId: ctx.organizationId,
        provider: ctx.provider,
        senderIdentifier: ctx.senderIdentifier,
        status: Not(In(['CONFIRMED', 'CANCELLED', 'EXPIRED'])),
      },
      { status: 'EXPIRED', resolvedAt: new Date() },
    );

    await this.conversations.save(
      this.conversations.create({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        provider: ctx.provider,
        senderIdentifier: ctx.senderIdentifier,
        skillName,
        slots,
        status,
        pendingQuestion: extra.pendingQuestion,
        originModel: extra.model ?? null,
        originPromptVersion: extra.promptVersion,
        confidence: extra.confidence ?? null,
        expiresAt,
      }),
    );
  }

  private async close(
    conversation: ChannelConversation,
    status: 'CANCELLED' | 'EXPIRED',
  ): Promise<void> {
    await this.conversations.update(conversation.id, {
      status,
      resolvedAt: new Date(),
    });
  }

  /* ------------------------------------------------------------------ *
   * Replies
   * ------------------------------------------------------------------ */

  private reply(ctx: SkillContext, body: string): ChannelCommandResult {
    return { handled: true, userId: ctx.userId, reply: { body } };
  }

  private mergeSlots(
    prior: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged = { ...prior };
    for (const [key, value] of Object.entries(incoming)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      merged[key] = value;
    }
    return merged;
  }

  private degradedMessage(): string {
    return 'AI parsing isn\'t available right now — please send the exact instruction, e.g. "approve QT-2026-0004".';
  }

  /** Only ever lists capabilities this user actually holds. */
  private helpMessage(ctx: SkillContext): string {
    const permitted = this.registry.permittedFor(ctx.permissions);
    if (permitted.length === 0)
      return "You don't have permission to run any commands here.";
    return `I can help with:\n${permitted
      .map((s) => `• ${s.examples[0]}`)
      .join('\n')}`;
  }
}
