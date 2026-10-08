import { ContactsService } from './contacts.service';
import { PERMISSIONS } from '@saas/shared';

const vi = typeof jest !== 'undefined' ? jest : (globalThis as any).vi;

describe('ContactsService', () => {
  let service: ContactsService;
  let mockContactsRepo: any;
  let mockEventBus: any;

  const actor: any = {
    id: 'user-1',
    organizationId: 'tenant-1',
    permissions: [PERMISSIONS.CONTACT_READ_ALL],
    teamId: null,
  };

  beforeEach(() => {
    mockContactsRepo = {
      create: vi.fn((data) => ({ id: 'contact-1', ...data })),
      save: vi.fn(async (contact) => ({ id: 'contact-1', ...contact })),
      softRemove: vi.fn(async (contact) => contact),
      createQueryBuilder: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue({
          id: 'contact-1',
          tenantId: 'tenant-1',
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@example.com',
          phone: '123-456',
          company: 'Acme',
          jobTitle: 'VP',
          status: 'lead',
          source: 'manual',
          notes: 'Test notes',
          ownerId: 'user-1',
          owner: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        }),
      }),
    };

    mockEventBus = {
      publish: vi.fn().mockResolvedValue(undefined),
      computeChangedFields: vi.fn((before, after) => {
        const b = before ?? {};
        const a = after ?? {};
        const allKeys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
        return allKeys.filter((k) => b[k] !== a[k]).sort();
      }),
    };

    service = new ContactsService(mockContactsRepo as any, mockEventBus as any);
  });

  describe('create', () => {
    it('creates contact and publishes record.created domain event', async () => {
      const input: any = {
        firstName: 'Bob',
        lastName: 'Jones',
        email: 'bob@example.com',
      };

      const result = await service.create(actor, input);

      expect(mockContactsRepo.save).toHaveBeenCalled();
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'record.created',
          entityType: 'contact',
          entityName: 'contact',
          entityId: 'contact-1',
          actorUserId: 'user-1',
          snapshot: expect.objectContaining({
            before: null,
            after: expect.objectContaining({ id: 'contact-1' }),
          }),
        }),
      );
      expect(result.id).toBe('contact-1');
    });
  });

  describe('update', () => {
    it('updates contact and publishes record.updated domain event with diff', async () => {
      const input: any = {
        firstName: 'Alice-Updated',
      };

      const result = await service.update(actor, 'contact-1', input);

      expect(mockContactsRepo.save).toHaveBeenCalled();
      expect(mockEventBus.computeChangedFields).toHaveBeenCalled();
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'record.updated',
          entityType: 'contact',
          entityName: 'contact',
          entityId: 'contact-1',
          actorUserId: 'user-1',
          snapshot: expect.objectContaining({
            before: expect.objectContaining({ firstName: 'Alice' }),
            after: expect.objectContaining({ firstName: 'Alice-Updated' }),
          }),
        }),
      );
      expect(result.id).toBe('contact-1');
    });
  });

  describe('remove', () => {
    it('soft removes contact and publishes record.deleted domain event', async () => {
      await service.remove(actor, 'contact-1');

      expect(mockContactsRepo.softRemove).toHaveBeenCalled();
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'record.deleted',
          entityType: 'contact',
          entityName: 'contact',
          entityId: 'contact-1',
          actorUserId: 'user-1',
          snapshot: expect.objectContaining({
            before: expect.objectContaining({ id: 'contact-1' }),
            after: null,
          }),
        }),
      );
    });
  });
});
