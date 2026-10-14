import { z } from 'zod';
import { In, type Repository } from 'typeorm';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type ContactDto,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import type { ContactsService } from '../../contacts/contacts.service';
import type { ChannelsService } from '../channels.service';
import { ChannelProviderType } from '../entities/channel-config.entity';
import {
  MessageDirection,
  MessageStatus,
  type ChannelMessage,
} from '../entities/channel-message.entity';
import type { SkillActorService } from '../services/skill-actor.service';
import { resolveContact } from './channel-contact.resolver';
import type { ChannelSkill, SkillContext } from './skill.types';

const PROVIDERS = Object.values(ChannelProviderType) as [string, ...string[]];

const slotSchema = z.object({
  contact: z.string().optional(),
  provider: z.enum(PROVIDERS).optional(),
  body: z.string().optional(),
  /**
   * Set when the agent pins a resolved send for approval: used as-is instead
   * of being re-derived from history, so the commit sends where the card said.
   */
  recipient: z.string().optional(),
});

export interface ResolvedSend {
  contact: ContactDto;
  provider: ChannelProviderType;
  recipient: string;
  body: string;
}

export class ChannelMessageSendSkill implements ChannelSkill<ResolvedSend> {
  readonly name = CHANNEL_SKILLS.CHANNEL_MESSAGE_SEND;
  readonly isMutating = true;
  /** In-app assistant only: never offered to the staff bot or automations. */
  readonly surfaces = ['assistant'] as const;
  readonly description =
    'Send a WhatsApp, Telegram or email message to one contact. Write the complete final message text in `body`. The user always sees and approves it before it is sent.';
  readonly examples = ['send it', 'reply to Ada on WhatsApp saying the samples ship Monday', 'email Acme the follow-up'];
  readonly requiredPermissions = [PERMISSIONS.CHANNEL_SEND];
  readonly jsonSchema = {
    type: 'object',
    properties: {
      contact: { type: 'string', description: 'Contact name, email, company or id' },
      provider: { type: 'string', enum: PROVIDERS, description: 'Channel; defaults to the one last used with this contact' },
      body: { type: 'string', description: 'The complete message text to send' },
    },
    required: ['contact', 'body'],
    additionalProperties: false,
  };
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'channel-message-send/1';

  constructor(
    private readonly contacts: ContactsService,
    private readonly actors: SkillActorService,
    private readonly messages: Repository<ChannelMessage>,
    private readonly channels: () => ChannelsService,
  ) {}

  async resolve(slots: Record<string, unknown>, ctx: SkillContext): Promise<SkillResolution<ResolvedSend>> {
    const parsed = slotSchema.safeParse(slots);
    const value = parsed.success ? parsed.data : {};
    const actor = await this.actors.forContext(ctx);
    const contact = await resolveContact(this.contacts, actor, value.contact ?? '');
    if (contact.kind === 'question') {
      return { ...contact, slots: { ...slots, ...contact.slots } };
    }
    if (contact.kind !== 'resolved') return contact;

    const body = value.body?.trim();
    if (!body) {
      return { kind: 'question', question: `What should the message to ${contact.value.fullName} say?`, slots };
    }

    // Only history we can trust: anything the contact sent us, or what we
    // actually delivered. A failed or pending send may carry a bad address.
    const base = {
      organizationId: ctx.organizationId,
      contactId: contact.value.id,
      ...(value.provider ? { provider: value.provider as ChannelProviderType } : {}),
    };
    const last = await this.messages.findOne({
      where: [
        { ...base, direction: MessageDirection.INBOUND },
        {
          ...base,
          direction: MessageDirection.OUTBOUND,
          status: In([MessageStatus.SENT, MessageStatus.DELIVERED]),
        },
      ],
      order: { createdAt: 'DESC' },
    });
    const provider = (value.provider as ChannelProviderType | undefined) ?? last?.provider;
    if (!provider) {
      return {
        kind: 'question',
        question: `Which channel should I use for ${contact.value.fullName}: WhatsApp, Telegram or email?`,
        slots,
      };
    }

    if (value.recipient !== undefined) {
      const pinned = value.recipient.trim();
      if (!pinned) {
        return { kind: 'refused', reason: `No ${provider} address was given for ${contact.value.fullName}.` };
      }
      return { kind: 'resolved', value: { contact: contact.value, provider, recipient: pinned, body } };
    }

    const fromHistory = last ? (last.direction === MessageDirection.INBOUND ? last.sender : last.recipient) : null;
    const ownAddress =
      provider === ChannelProviderType.WHATSAPP_META
        ? contact.value.phone
        : provider === ChannelProviderType.EMAIL_SMTP || provider === ChannelProviderType.EMAIL_RESEND
          ? contact.value.email
          : null;
    const recipient = ownAddress || fromHistory;
    if (!recipient) {
      return {
        kind: 'refused',
        reason: `I don't have a ${provider} address for ${contact.value.fullName}. They need to message us there first.`,
      };
    }
    return { kind: 'resolved', value: { contact: contact.value, provider, recipient, body } };
  }

  /** Contact by id, explicit channel and address: re-resolves to exactly this send. */
  pinArgs(value: ResolvedSend): Record<string, unknown> {
    return { contact: value.contact.id, provider: value.provider, recipient: value.recipient, body: value.body };
  }

  async preview(value: ResolvedSend): Promise<string> {
    return `Send to ${value.contact.fullName} (${value.recipient}) via ${value.provider}:\n\n${value.body}`;
  }

  async execute(value: ResolvedSend, ctx: SkillContext): Promise<SkillOutcome> {
    await this.channels().sendMessage(ctx.organizationId, ctx.userId, {
      contactId: value.contact.id,
      provider: value.provider,
      recipient: value.recipient,
      body: value.body,
    });
    return {
      reply: `Sent to ${value.contact.fullName} via ${value.provider}.`,
      resultType: 'CONTACT',
      resultId: value.contact.id,
    };
  }
}
