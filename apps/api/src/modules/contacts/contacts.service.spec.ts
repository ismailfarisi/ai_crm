import { ContactsService } from './contacts.service';
import { PERMISSIONS } from '@saas/shared';

const vi = typeof jest !== 'undefined' ? jest : (globalThis as any).vi;

describe('ContactsService', () => {
  let service: ContactsService;
  let mockContactsRepo: any;
  let mockEventBus: any;
  let mockEm: any;

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

    mockEm = { getRepository: vi.fn(() => mockContactsRepo) };
    mockContactsRepo.manager = {
      transaction: vi.fn(async (cb: any) => cb(mockEm)),
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
          entityType: 'core',
          entityName: 'contact',
          entityId: 'contact-1',
          actorUserId: 'user-1',
          snapshot: expect.objectContaining({
            before: null,
            after: expect.objectContaining({ id: 'contact-1' }),
          }),
        }),
        { manager: mockEm },
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
          entityType: 'core',
          entityName: 'contact',
          entityId: 'contact-1',
          actorUserId: 'user-1',
          snapshot: expect.objectContaining({
            before: expect.objectContaining({ firstName: 'Alice' }),
            after: expect.objectContaining({ firstName: 'Alice-Updated' }),
          }),
        }),
        { manager: mockEm },
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
          entityType: 'core',
          entityName: 'contact',
          entityId: 'contact-1',
          actorUserId: 'user-1',
          snapshot: expect.objectContaining({
            before: expect.objectContaining({ id: 'contact-1' }),
            after: null,
          }),
        }),
        { manager: mockEm },
      );
    });
  });

  describe('findOrCreateForChannel', () => {
    /**
     * A fake that behaves like Postgres where it matters here: reads yield
     * (so two webhooks genuinely interleave) and `pg_advisory_xact_lock`
     * blocks until the holding transaction finishes.
     */
    function makeChannelRepo() {
      const rows: any[] = [];
      const locks = new Map<string, Promise<void>>();
      const lockCalls: Array<[string, unknown[]]> = [];
      const tick = () => new Promise((r) => setTimeout(r, 0));
      const matches = (row: any, w: any) =>
        Object.entries(w).every(([k, v]) => row[k] === v);
      const repo: any = {
        findOne: vi.fn(async ({ where }: any) => {
          await tick();
          const clauses = Array.isArray(where) ? where : [where];
          return (
            rows.find((r) => clauses.some((w: any) => matches(r, w))) ?? null
          );
        }),
        create: vi.fn((data: any) => ({ ...data })),
        save: vi.fn(async (c: any) => {
          await tick();
          const saved = { id: `contact-${rows.length + 1}`, ...c };
          rows.push(saved);
          return saved;
        }),
      };
      repo.manager = {
        transaction: vi.fn(async (cb: any) => {
          const held: Array<() => void> = [];
          const em = {
            query: vi.fn(async (sql: string, params: unknown[]) => {
              lockCalls.push([sql, params]);
              if (!/pg_advisory_xact_lock/.test(sql)) return [];
              const key = JSON.stringify(params);
              while (locks.has(key)) await locks.get(key);
              let release!: () => void;
              locks.set(key, new Promise<void>((r) => (release = r)));
              held.push(() => {
                locks.delete(key);
                release();
              });
              return [];
            }),
            getRepository: () => repo,
          };
          try {
            return await cb(em);
          } finally {
            held.forEach((f) => f());
          }
        }),
      };
      return { repo, rows, lockCalls };
    }

    it('creates one contact when the same sender arrives twice concurrently', async () => {
      const { repo, rows } = makeChannelRepo();
      const svc = new ContactsService(repo, mockEventBus);

      const [a, b] = await Promise.all([
        svc.findOrCreateForChannel('tenant-1', ' Buyer@Acme.com ', 'email'),
        svc.findOrCreateForChannel('tenant-1', 'buyer@acme.com', 'email'),
      ]);

      expect(rows).toHaveLength(1);
      expect(a.id).toBe(b.id);
      expect(rows[0].email).toBe('buyer@acme.com');
    });

    it('takes a transaction-scoped advisory lock keyed on tenant and normalised identifier', async () => {
      const { repo, lockCalls } = makeChannelRepo();
      const svc = new ContactsService(repo, mockEventBus);

      await svc.findOrCreateForChannel('tenant-1', ' Buyer@Acme.com ', 'email');

      const lock = lockCalls.find(([sql]) => /pg_advisory_xact_lock/.test(sql));
      expect(lock).toBeDefined();
      expect(JSON.stringify(lock![1])).toContain('tenant-1');
      expect(JSON.stringify(lock![1])).toContain('buyer@acme.com');
    });

    it('returns the existing contact without creating another', async () => {
      const { repo, rows } = makeChannelRepo();
      rows.push({
        id: 'existing',
        tenantId: 'tenant-1',
        phone: '+4477',
        email: null,
      });
      const svc = new ContactsService(repo, mockEventBus);

      const found = await svc.findOrCreateForChannel(
        'tenant-1',
        '+4477',
        'telegram',
      );

      expect(found.id).toBe('existing');
      expect(rows).toHaveLength(1);
    });
  });
});
