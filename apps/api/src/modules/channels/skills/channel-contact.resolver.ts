import { NotFoundException } from '@nestjs/common';
import type { ContactDto, SkillResolution } from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import type { ContactsService } from '../../contacts/contacts.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Name, email, phone or id → one contact the actor may see. Goes through
 * ContactsService so the tenant and ownership filters apply; an invisible
 * contact is indistinguishable from a missing one.
 */
export async function resolveContact(
  contacts: ContactsService,
  actor: AuthenticatedUser,
  term: string,
): Promise<SkillResolution<ContactDto>> {
  const needle = term.trim();
  if (!needle) {
    return { kind: 'question', question: 'Which contact do you mean?', slots: {} };
  }
  if (UUID.test(needle)) {
    try {
      return { kind: 'resolved', value: await contacts.findOne(actor, needle) };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { kind: 'refused', reason: `No contact you can see has id ${needle}.` };
      }
      throw error;
    }
  }
  const { items } = await contacts.list(actor, {
    search: needle,
    page: 1,
    limit: 5,
    sortBy: 'updatedAt',
    sortOrder: 'DESC',
  });
  if (items.length === 0) {
    return { kind: 'refused', reason: `No contact you can see matches "${needle}".` };
  }
  if (items.length > 1) {
    const options = items.map((c) => `${c.fullName}${c.company ? ` (${c.company})` : ''}`).join(', ');
    return { kind: 'question', question: `Which contact: ${options}?`, slots: {} };
  }
  return { kind: 'resolved', value: items[0] };
}
