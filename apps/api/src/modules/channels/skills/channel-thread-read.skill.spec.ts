import type { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { ChannelThreadReadSkill } from './channel-thread-read.skill';
import type { ContactsService } from '../../contacts/contacts.service';
import type { SkillActorService } from '../services/skill-actor.service';
import type { ChannelMessage } from '../entities/channel-message.entity';
import type { SkillContext } from './skill.types';

const ctx = { organizationId: 'org-1', userId: 'user-1', permissions: [], message: '' } as unknown as SkillContext;
const actor = { id: 'user-1', organizationId: 'org-1' } as any;
const acme = { id: 'c-1', fullName: 'Ada Acme', email: 'ada@acme.test', phone: '+971500000001' };

function build(listItems: unknown[], rows: unknown[] = []) {
  const contacts = {
    list: jest.fn().mockResolvedValue({ items: listItems, meta: { total: listItems.length } }),
    findOne: jest.fn().mockRejectedValue(new NotFoundException()),
  } as unknown as ContactsService;
  const actors = { forContext: jest.fn().mockResolvedValue(actor) } as unknown as SkillActorService;
  const messages = { find: jest.fn().mockResolvedValue(rows) } as unknown as Repository<ChannelMessage>;
  return { skill: new ChannelThreadReadSkill(contacts, actors, messages), contacts, messages };
}

describe('ChannelThreadReadSkill', () => {
  it('is a read-only tool gated on channel:read', () => {
    const { skill } = build([]);
    expect(skill.isMutating).toBe(false);
    expect(skill.requiredPermissions).toEqual(['channel:read']);
  });

  it('resolves the contact through the owner-scoped contacts service', async () => {
    const { skill, contacts } = build([acme]);
    const res = await skill.resolve({ contact: 'Acme' }, ctx);
    expect(contacts.list).toHaveBeenCalledWith(actor, expect.objectContaining({ search: 'Acme' }));
    expect(res).toEqual({ kind: 'resolved', value: { contact: acme, provider: undefined, limit: 20 } });
  });

  it('asks when the name is ambiguous', async () => {
    const { skill } = build([acme, { ...acme, id: 'c-2', fullName: 'Ada Acme Jr' }]);
    const res = await skill.resolve({ contact: 'Ada' }, ctx);
    expect(res.kind).toBe('question');
  });

  it('refuses when nothing visible matches (never leaks other owners contacts)', async () => {
    const { skill } = build([]);
    const res = await skill.resolve({ contact: 'Nobody' }, ctx);
    expect(res).toEqual({ kind: 'refused', reason: expect.stringContaining('Nobody') });
  });

  it('clamps limit to 50', async () => {
    const { skill } = build([acme]);
    const res = await skill.resolve({ contact: 'Acme', limit: 500 }, ctx);
    expect(res.kind === 'resolved' && res.value.limit).toBe(50);
  });

  it('reads messages for that contact in this tenant, oldest first in the reply', async () => {
    const rows = [
      { direction: 'INBOUND', provider: 'WHATSAPP_META', body: 'second', createdAt: new Date('2026-10-02') },
      { direction: 'OUTBOUND', provider: 'WHATSAPP_META', body: 'first', createdAt: new Date('2026-10-01') },
    ];
    const { skill, messages } = build([acme], rows);
    const outcome = await skill.execute({ contact: acme as any, provider: undefined, limit: 20 }, ctx);
    expect(messages.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', contactId: 'c-1' },
        take: 20,
      }),
    );
    expect(outcome.reply.indexOf('first')).toBeLessThan(outcome.reply.indexOf('second'));
    expect(outcome.resultType).toBe('CONTACT');
    expect(outcome.resultId).toBe('c-1');
  });
});
