import { z } from 'zod';
import type { Repository } from 'typeorm';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type ContactDto,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import type { ContactsService } from '../../contacts/contacts.service';
import { ChannelProviderType } from '../entities/channel-config.entity';
import type { ChannelMessage } from '../entities/channel-message.entity';
import type { SkillActorService } from '../services/skill-actor.service';
import { resolveContact } from './channel-contact.resolver';
import type { ChannelSkill, SkillContext } from './skill.types';

const PROVIDERS = Object.values(ChannelProviderType) as [string, ...string[]];

const slotSchema = z.object({
  contact: z.string().optional(),
  provider: z.enum(PROVIDERS).optional(),
  limit: z.number().int().optional(),
});

export interface ResolvedThreadRead {
  contact: ContactDto;
  provider: ChannelProviderType | undefined;
  limit: number;
}

export class ChannelThreadReadSkill implements ChannelSkill<ResolvedThreadRead> {
  readonly name = CHANNEL_SKILLS.CHANNEL_THREAD_READ;
  readonly isMutating = false;
  readonly description =
    "Read the recent WhatsApp, Telegram or email messages exchanged with one contact. Use before summarising a conversation or drafting a reply.";
  readonly examples = [
    "show me Acme's last WhatsApp messages",
    'what did Ada say in her last email?',
    'summarise my conversation with Bilal',
  ];
  readonly requiredPermissions = [PERMISSIONS.CHANNEL_READ];
  readonly jsonSchema = {
    type: 'object',
    properties: {
      contact: { type: 'string', description: 'Contact name, email, company or id' },
      provider: { type: 'string', enum: PROVIDERS, description: 'Only this channel (optional)' },
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many recent messages (default 20)' },
    },
    required: ['contact'],
    additionalProperties: false,
  };
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'channel-thread-read/1';

  constructor(
    private readonly contacts: ContactsService,
    private readonly actors: SkillActorService,
    private readonly messages: Repository<ChannelMessage>,
  ) {}

  async resolve(slots: Record<string, unknown>, ctx: SkillContext): Promise<SkillResolution<ResolvedThreadRead>> {
    const parsed = slotSchema.safeParse(slots);
    const value = parsed.success ? parsed.data : {};
    const actor = await this.actors.forContext(ctx);
    const contact = await resolveContact(this.contacts, actor, value.contact ?? '');
    if (contact.kind !== 'resolved') return contact;
    return {
      kind: 'resolved',
      value: {
        contact: contact.value,
        provider: value.provider as ChannelProviderType | undefined,
        limit: Math.min(Math.max(value.limit ?? 20, 1), 50),
      },
    };
  }

  async preview(value: ResolvedThreadRead): Promise<string> {
    return `Read the last ${value.limit} messages with ${value.contact.fullName}?`;
  }

  async execute(value: ResolvedThreadRead, ctx: SkillContext): Promise<SkillOutcome> {
    const rows = await this.messages.find({
      where: {
        organizationId: ctx.organizationId,
        contactId: value.contact.id,
        ...(value.provider ? { provider: value.provider } : {}),
      },
      order: { createdAt: 'DESC' },
      take: value.limit,
    });
    if (rows.length === 0) {
      return { reply: `No channel messages with ${value.contact.fullName} yet.`, resultType: 'CONTACT', resultId: value.contact.id };
    }
    const lines = [...rows]
      .reverse()
      .map((m) => `[${m.createdAt.toISOString()}] ${m.direction === 'INBOUND' ? value.contact.fullName : 'Us'} via ${m.provider}: ${m.body}`);
    return {
      reply: `Messages with ${value.contact.fullName} (oldest first):\n${lines.join('\n')}`,
      resultType: 'CONTACT',
      resultId: value.contact.id,
    };
  }
}
