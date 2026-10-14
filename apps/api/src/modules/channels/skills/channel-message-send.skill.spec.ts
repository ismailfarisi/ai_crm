import type { Repository } from 'typeorm';
import { ChannelMessageSendSkill } from './channel-message-send.skill';
import { ToolExecutionPolicyService } from './tool-execution-policy.service';
import type { ContactsService } from '../../contacts/contacts.service';
import type { SkillActorService } from '../services/skill-actor.service';
import type { ChannelsService } from '../channels.service';
import type { ChannelMessage } from '../entities/channel-message.entity';
import type { SkillContext } from './skill.types';

const ctx = { organizationId: 'org-1', userId: 'user-1', permissions: [], message: '' } as unknown as SkillContext;
const acme = { id: 'c-1', fullName: 'Ada Acme', email: 'ada@acme.test', phone: '+971500000001' };

function build(lastMessage: unknown = null, items: unknown[] = [acme]) {
  const contacts = {
    list: jest.fn().mockResolvedValue({ items, meta: { total: items.length } }),
    findOne: jest.fn(),
  } as unknown as ContactsService;
  const actors = { forContext: jest.fn().mockResolvedValue({ id: 'user-1' }) } as unknown as SkillActorService;
  const messages = { findOne: jest.fn().mockResolvedValue(lastMessage) } as unknown as Repository<ChannelMessage>;
  const channels = { sendMessage: jest.fn().mockResolvedValue({ id: 'm-9' }) } as unknown as ChannelsService;
  return { skill: new ChannelMessageSendSkill(contacts, actors, messages, () => channels), channels, messages };
}

describe('ChannelMessageSendSkill', () => {
  it('is mutating, gated on channel:send, and always needs approval', () => {
    const { skill } = build();
    expect(skill.isMutating).toBe(true);
    expect(skill.requiredPermissions).toEqual(['channel:send']);
    expect(new ToolExecutionPolicyService().evaluatePolicy(skill.name, true).requiresApproval).toBe(true);
  });

  it('replies to the chat id of the last Telegram message from the contact', async () => {
    const { skill } = build({ direction: 'INBOUND', sender: 'tg-chat-42', recipient: 'bot' });
    const res = await skill.resolve({ contact: 'Acme', provider: 'TELEGRAM', body: 'Hi' }, ctx);
    expect(res).toEqual({
      kind: 'resolved',
      value: { contact: acme, provider: 'TELEGRAM', recipient: 'tg-chat-42', body: 'Hi' },
    });
  });

  it('falls back to the contact phone for WhatsApp and email address for email', async () => {
    const { skill } = build(null);
    const wa = await skill.resolve({ contact: 'Acme', provider: 'WHATSAPP_META', body: 'Hi' }, ctx);
    expect(wa.kind === 'resolved' && wa.value.recipient).toBe('+971500000001');
    const em = await skill.resolve({ contact: 'Acme', provider: 'EMAIL_SMTP', body: 'Hi' }, ctx);
    expect(em.kind === 'resolved' && em.value.recipient).toBe('ada@acme.test');
  });

  it('refuses Telegram with no prior conversation', async () => {
    const { skill } = build(null);
    const res = await skill.resolve({ contact: 'Acme', provider: 'TELEGRAM', body: 'Hi' }, ctx);
    expect(res.kind).toBe('refused');
  });

  it('defaults the provider to the one last used with the contact', async () => {
    const { skill } = build({ direction: 'OUTBOUND', provider: 'WHATSAPP_META', sender: 'u', recipient: '+971500000001' });
    const res = await skill.resolve({ contact: 'Acme', body: 'Hi' }, ctx);
    expect(res.kind === 'resolved' && res.value.provider).toBe('WHATSAPP_META');
  });

  it('asks for the body when missing', async () => {
    const { skill } = build(null);
    const res = await skill.resolve({ contact: 'Acme', provider: 'EMAIL_SMTP' }, ctx);
    expect(res.kind).toBe('question');
  });

  it('previews recipient, provider and the full text', async () => {
    const { skill } = build();
    const preview = await skill.preview(
      { contact: acme as any, provider: 'EMAIL_SMTP' as any, recipient: 'ada@acme.test', body: 'Hello there' },
      ctx,
    );
    expect(preview).toContain('Ada Acme');
    expect(preview).toContain('ada@acme.test');
    expect(preview).toContain('Hello there');
  });

  it('sends through ChannelsService as the acting user', async () => {
    const { skill, channels } = build();
    const outcome = await skill.execute(
      { contact: acme as any, provider: 'EMAIL_SMTP' as any, recipient: 'ada@acme.test', body: 'Hello' },
      ctx,
    );
    expect(channels.sendMessage).toHaveBeenCalledWith('org-1', 'user-1', {
      contactId: 'c-1',
      provider: 'EMAIL_SMTP',
      recipient: 'ada@acme.test',
      body: 'Hello',
    });
    expect(outcome.resultId).toBe('c-1');
  });

  it('keeps the drafted body and provider when the contact is ambiguous', async () => {
    const { skill } = build(null, [acme, { ...acme, id: 'c-2', fullName: 'Ada Acme Jr' }]);
    const res = await skill.resolve({ contact: 'Ada', provider: 'EMAIL_SMTP', body: 'Hi there' }, ctx);
    expect(res.kind).toBe('question');
    expect(res.kind === 'question' && res.slots).toEqual(
      expect.objectContaining({ body: 'Hi there', provider: 'EMAIL_SMTP' }),
    );
  });

  it('only trusts inbound or sent/delivered history, always tenant and contact scoped', async () => {
    const { skill, messages } = build(null);
    await skill.resolve({ contact: 'Acme', provider: 'TELEGRAM', body: 'Hi' }, ctx);
    const where = (messages.findOne as jest.Mock).mock.calls[0][0].where as any[];
    expect(where).toHaveLength(2);
    for (const branch of where) {
      expect(branch).toEqual(expect.objectContaining({ organizationId: 'org-1', contactId: 'c-1', provider: 'TELEGRAM' }));
    }
    expect(where[0].direction).toBe('INBOUND');
    expect(where[1].direction).toBe('OUTBOUND');
    expect(where[1].status.value).toEqual(['sent', 'delivered']);
  });

  it('prefers the contact phone over a different number in history for WhatsApp', async () => {
    const { skill } = build({ direction: 'OUTBOUND', provider: 'WHATSAPP_META', sender: 'u', recipient: '+999' });
    const res = await skill.resolve({ contact: 'Acme', provider: 'WHATSAPP_META', body: 'Hi' }, ctx);
    expect(res.kind === 'resolved' && res.value.recipient).toBe('+971500000001');
  });

  it('falls back to history for WhatsApp when the contact has no phone', async () => {
    const { skill } = build({ direction: 'INBOUND', provider: 'WHATSAPP_META', sender: '+555', recipient: 'us' }, [
      { ...acme, phone: null },
    ]);
    const res = await skill.resolve({ contact: 'Acme', provider: 'WHATSAPP_META', body: 'Hi' }, ctx);
    expect(res.kind === 'resolved' && res.value.recipient).toBe('+555');
  });
});
