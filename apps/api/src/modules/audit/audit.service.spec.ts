import type { DataSource, Repository } from 'typeorm';
import type {
  EventOutboxService,
  OutboxHandler,
  OutboxMessage,
} from '@/common/events';
import { AUDIT_OUTBOX_KIND, AuditService } from './audit.service';
import type { AuditLog } from './entities/audit-log.entity';

const TENANT = '11111111-1111-4111-8111-111111111111';

function setup() {
  const execute = jest.fn().mockResolvedValue(undefined);
  const qb = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute,
  };
  const logs = {
    insert: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => qb),
  };
  const handlers = new Map<string, OutboxHandler>();
  const outbox = {
    enqueue: jest.fn().mockResolvedValue('outbox-1'),
    registerHandler: jest.fn((kind: string, handler: OutboxHandler) => {
      handlers.set(kind, handler);
      return () => handlers.delete(kind);
    }),
  };
  const service = new AuditService(
    logs as unknown as Repository<AuditLog>,
    {} as DataSource,
    outbox as unknown as EventOutboxService,
  );
  return { service, logs, qb, outbox, handlers };
}

const input = {
  tenantId: TENANT,
  action: 'quote.update',
  subjectType: 'QUOTE',
  subjectId: '7f1c2a3b-4d5e-6f70-8a9b-0c1d2e3f4a5b',
  actorId: 'u1',
  before: { status: 'DRAFT' },
  after: { status: 'APPROVED' },
};

describe('AuditService.record', () => {
  it('inserts the row with an id chosen up front', async () => {
    const { service, logs, outbox } = setup();
    await service.record(input);
    expect(logs.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        tenantId: TENANT,
        action: 'quote.update',
        changedFields: ['status'],
      }),
    );
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('queues the row for retry instead of dropping it when the insert fails', async () => {
    const { service, logs, outbox } = setup();
    logs.insert.mockRejectedValueOnce(new Error('deadlock detected'));

    await expect(service.record(input)).resolves.toBeUndefined();

    const row = logs.insert.mock.calls[0][0];
    expect(outbox.enqueue).toHaveBeenCalledWith({
      tenantId: TENANT,
      kind: AUDIT_OUTBOX_KIND,
      eventType: 'quote.update',
      payload: {
        row: expect.objectContaining({ id: row.id, action: 'quote.update' }),
        occurredAt: expect.any(String),
      },
    });
  });

  it('still never throws when the outbox is unreachable too', async () => {
    const { service, logs, outbox } = setup();
    logs.insert.mockRejectedValueOnce(new Error('db down'));
    outbox.enqueue.mockRejectedValueOnce(new Error('db down'));
    await expect(service.record(input)).resolves.toBeUndefined();
  });

  it('replays a queued row idempotently, keeping its id and original time', async () => {
    const { service, logs, qb, handlers } = setup();
    logs.insert.mockRejectedValueOnce(new Error('deadlock detected'));
    await service.record(input);
    const row = logs.insert.mock.calls[0][0];
    const occurredAt = '2026-10-14T09:00:00.000Z';

    const message: OutboxMessage = {
      id: 'outbox-1',
      tenantId: TENANT,
      kind: AUDIT_OUTBOX_KIND,
      eventType: 'quote.update',
      payload: JSON.parse(JSON.stringify({ row, occurredAt })),
      attempts: 1,
    };
    await handlers.get(AUDIT_OUTBOX_KIND)!(message);

    expect(qb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: row.id,
        action: 'quote.update',
        createdAt: new Date(occurredAt),
      }),
    );
    // A retry after an insert that did land must not duplicate the row.
    expect(qb.orIgnore).toHaveBeenCalled();
    expect(qb.execute).toHaveBeenCalled();
  });

  it('lets a failed replay throw so the outbox retries it', async () => {
    const { service, qb, handlers } = setup();
    void service;
    qb.execute.mockRejectedValueOnce(new Error('still failing'));
    await expect(
      handlers.get(AUDIT_OUTBOX_KIND)!({
        id: 'outbox-2',
        tenantId: TENANT,
        kind: AUDIT_OUTBOX_KIND,
        eventType: 'quote.update',
        payload: { row: { id: 'r1' }, occurredAt: '2026-10-14T09:00:00.000Z' },
        attempts: 1,
      }),
    ).rejects.toThrow('still failing');
  });
});

describe('AuditService.snapshot', () => {
  it('omits ibanEncrypted and passwordHash', async () => {
    const { service } = setup();
    const columns = ['id', 'firstName', 'ibanEncrypted', 'ibanLast4', 'passwordHash'].map(
      (propertyName) => ({ propertyName }),
    );
    const row = {
      id: 'e1',
      firstName: 'Ada',
      ibanEncrypted: 'SECRETCIPHER',
      ibanLast4: '3456',
      passwordHash: 'hash',
    };
    const manager = {
      getRepository: () => ({
        metadata: { columns: [...columns, { propertyName: 'tenantId' }] },
        findOne: jest.fn().mockResolvedValue({ ...row, tenantId: TENANT }),
      }),
    };
    const snap = await service.snapshot({} as never, TENANT, 'e1', manager as never);
    expect(snap).toEqual({ id: 'e1', firstName: 'Ada', ibanLast4: '3456', tenantId: TENANT });
    expect(JSON.stringify(snap)).not.toContain('SECRETCIPHER');
  });
});
