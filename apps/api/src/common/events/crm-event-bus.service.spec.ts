import type { EntityManager } from 'typeorm';
import {
  CRM_EVENT_OUTBOX_KIND,
  CrmEventBusService,
  computeChangedFields,
  type DeliveredCrmDomainEvent,
} from './crm-event-bus.service';
import type {
  EventOutboxService,
  OutboxHandler,
  OutboxMessage,
} from './event-outbox.service';
import type { CrmDomainEvent } from '@saas/shared';

const sampleEvent = (): CrmDomainEvent => ({
  tenantId: '11111111-1111-4111-8111-111111111111',
  eventType: 'record.updated',
  entityType: 'core',
  entityName: 'contact',
  entityId: 'contact-001',
  actorUserId: 'user-1',
  timestamp: '2026-10-08T12:00:00.000Z',
  snapshot: { before: { a: 1 }, after: { a: 2 }, changedFields: ['a'] },
});

function fakeOutbox() {
  const handlers = new Map<string, OutboxHandler>();
  const outbox = {
    enqueue: jest.fn().mockResolvedValue('evt-1'),
    registerHandler: jest.fn((kind: string, handler: OutboxHandler) => {
      handlers.set(kind, handler);
      return () => handlers.delete(kind);
    }),
  };
  return {
    outbox: outbox as unknown as EventOutboxService,
    enqueue: outbox.enqueue,
    handlerFor: (kind: string) => handlers.get(kind),
  };
}

describe('CrmEventBusService', () => {
  let service: CrmEventBusService;

  beforeEach(() => {
    service = new CrmEventBusService();
  });

  describe('with the durable outbox', () => {
    it('persists the event instead of running subscribers inside the request', async () => {
      const { outbox, enqueue } = fakeOutbox();
      const bus = new CrmEventBusService(outbox);
      const subscriber = jest.fn().mockResolvedValue(undefined);
      bus.subscribe(subscriber);

      const event = sampleEvent();
      await bus.publish(event);

      expect(enqueue).toHaveBeenCalledWith(
        {
          tenantId: event.tenantId,
          kind: CRM_EVENT_OUTBOX_KIND,
          eventType: 'record.updated',
          payload: event,
        },
        undefined,
      );
      expect(subscriber).not.toHaveBeenCalled();
    });

    it('joins the caller’s transaction when given its manager', async () => {
      const { outbox, enqueue } = fakeOutbox();
      const bus = new CrmEventBusService(outbox);
      const manager = {} as EntityManager;

      await bus.publish(sampleEvent(), { manager });

      expect(enqueue).toHaveBeenCalledWith(expect.anything(), manager);
    });

    it('lets an outbox failure inside a transaction roll that transaction back', async () => {
      const { outbox, enqueue } = fakeOutbox();
      enqueue.mockRejectedValueOnce(new Error('insert failed'));
      const bus = new CrmEventBusService(outbox);

      await expect(
        bus.publish(sampleEvent(), { manager: {} as EntityManager }),
      ).rejects.toThrow('insert failed');
    });

    it('never fails an already-committed request when the outbox is down, and still delivers in-process', async () => {
      const { outbox, enqueue } = fakeOutbox();
      enqueue.mockRejectedValueOnce(new Error('db down'));
      const bus = new CrmEventBusService(outbox);
      const received: DeliveredCrmDomainEvent[] = [];
      bus.subscribe(async (e) => {
        received.push(e);
      });

      await expect(bus.publish(sampleEvent())).resolves.toBeUndefined();
      await new Promise((resolve) => setImmediate(resolve));

      expect(received).toHaveLength(1);
      expect(received[0].eventId).toEqual(expect.any(String));
    });

    it('delivers a dispatched event to every subscriber with its stable outbox id', async () => {
      const { outbox, handlerFor } = fakeOutbox();
      const bus = new CrmEventBusService(outbox);
      const a = jest.fn().mockResolvedValue(undefined);
      const b = jest.fn().mockResolvedValue(undefined);
      bus.subscribe(a);
      bus.subscribe(b);
      const event = sampleEvent();

      const message: OutboxMessage = {
        id: 'evt-42',
        tenantId: event.tenantId,
        kind: CRM_EVENT_OUTBOX_KIND,
        eventType: event.eventType,
        payload: event,
        attempts: 1,
      };
      await handlerFor(CRM_EVENT_OUTBOX_KIND)!(message);

      expect(a).toHaveBeenCalledWith({ ...event, eventId: 'evt-42' });
      expect(b).toHaveBeenCalledWith({ ...event, eventId: 'evt-42' });
    });

    it('reports a failing subscriber to the dispatcher so the event is retried, after the others ran', async () => {
      const { outbox, handlerFor } = fakeOutbox();
      const bus = new CrmEventBusService(outbox);
      const healthy = jest.fn().mockResolvedValue(undefined);
      bus.subscribe(async () => {
        throw new Error('automation start failed');
      });
      bus.subscribe(healthy);
      const event = sampleEvent();

      await expect(
        handlerFor(CRM_EVENT_OUTBOX_KIND)!({
          id: 'evt-43',
          tenantId: event.tenantId,
          kind: CRM_EVENT_OUTBOX_KIND,
          eventType: event.eventType,
          payload: event,
          attempts: 1,
        }),
      ).rejects.toThrow(/automation start failed/);
      expect(healthy).toHaveBeenCalled();
    });
  });

  describe('publish and subscribe (in-process, no outbox)', () => {
    it('notifies all registered subscribers with the event', async () => {
      const received1: CrmDomainEvent[] = [];
      const received2: CrmDomainEvent[] = [];

      service.subscribe(async (event) => {
        received1.push(event);
      });
      service.subscribe(async (event) => {
        received2.push(event);
      });

      const event: CrmDomainEvent = {
        tenantId: 'tenant-123',
        eventType: 'record.created',
        entityType: 'core',
        entityName: 'contact',
        entityId: 'contact-001',
        actorUserId: 'user-999',
        timestamp: '2026-10-08T12:00:00.000Z',
        snapshot: {
          before: null,
          after: { id: 'contact-001', name: 'Alice' },
          changedFields: ['id', 'name'],
        },
      };

      await service.publish(event);

      expect(received1).toHaveLength(1);
      expect(received1[0]).toEqual({ ...event, eventId: expect.any(String) });
      expect(received2).toHaveLength(1);
      expect(received2[0]).toEqual({ ...event, eventId: expect.any(String) });
    });

    it('returns an unsubscribe function that correctly detaches the subscriber', async () => {
      const received: CrmDomainEvent[] = [];
      const unsubscribe = service.subscribe(async (event) => {
        received.push(event);
      });

      const event1: CrmDomainEvent = {
        tenantId: 'tenant-123',
        eventType: 'record.created',
        entityType: 'core',
        entityName: 'contact',
        entityId: 'contact-001',
        timestamp: '2026-10-08T12:00:00.000Z',
        snapshot: { before: null, after: {}, changedFields: [] },
      };

      await service.publish(event1);
      expect(received).toHaveLength(1);

      // Detach subscriber
      unsubscribe();

      const event2: CrmDomainEvent = {
        tenantId: 'tenant-123',
        eventType: 'record.updated',
        entityType: 'core',
        entityName: 'contact',
        entityId: 'contact-001',
        timestamp: '2026-10-08T12:05:00.000Z',
        snapshot: { before: {}, after: {}, changedFields: [] },
      };

      await service.publish(event2);
      expect(received).toHaveLength(1);

      // Calling unsubscribe multiple times is safe and a no-op
      expect(() => unsubscribe()).not.toThrow();
    });

    it('shields errors so an asynchronous error in one subscriber does not disrupt other subscribers and does not throw in publish', async () => {
      const healthySubscriberReceived: CrmDomainEvent[] = [];
      const failingSubscriber = async () => {
        throw new Error('Subscriber internal failure');
      };
      const healthySubscriber = async (event: CrmDomainEvent) => {
        healthySubscriberReceived.push(event);
      };

      service.subscribe(failingSubscriber);
      service.subscribe(healthySubscriber);

      const event: CrmDomainEvent = {
        tenantId: 'tenant-123',
        eventType: 'record.deleted',
        entityType: 'core',
        entityName: 'contact',
        entityId: 'contact-001',
        timestamp: '2026-10-08T12:10:00.000Z',
        snapshot: { before: { id: 'contact-001' }, after: null, changedFields: ['id'] },
      };

      await expect(service.publish(event)).resolves.not.toThrow();
      expect(healthySubscriberReceived).toHaveLength(1);
      expect(healthySubscriberReceived[0]).toEqual({ ...event, eventId: expect.any(String) });
    });

    it('shields errors when a subscriber throws synchronously without throwing in publish or disrupting peers', async () => {
      const healthySubscriberReceived: CrmDomainEvent[] = [];
      const syncThrowingSubscriber = () => {
        throw new Error('Subscriber synchronous crash');
      };
      const healthySubscriber = async (event: CrmDomainEvent) => {
        healthySubscriberReceived.push(event);
      };

      // Register sync thrower and healthy subscriber
      service.subscribe(syncThrowingSubscriber as any);
      service.subscribe(healthySubscriber);

      const event: CrmDomainEvent = {
        tenantId: 'tenant-123',
        eventType: 'record.updated',
        entityType: 'core',
        entityName: 'contact',
        entityId: 'contact-001',
        timestamp: '2026-10-08T12:12:00.000Z',
        snapshot: { before: { status: 'LEAD' }, after: { status: 'WON' }, changedFields: ['status'] },
      };

      await expect(service.publish(event)).resolves.not.toThrow();
      expect(healthySubscriberReceived).toHaveLength(1);
      expect(healthySubscriberReceived[0]).toEqual({ ...event, eventId: expect.any(String) });
    });

    it('handles publish with no subscribers gracefully without error', async () => {
      const event: CrmDomainEvent = {
        tenantId: 'tenant-123',
        eventType: 'link.created',
        entityType: 'core',
        entityName: 'deal',
        entityId: 'deal-001',
        timestamp: '2026-10-08T12:15:00.000Z',
        snapshot: { before: null, after: null, changedFields: [] },
      };

      await expect(service.publish(event)).resolves.toBeUndefined();
    });
  });

  describe('computeChangedFields', () => {
    it('detects added keys present in after but missing or undefined in before', () => {
      const before = { name: 'Acme Corp' };
      const after = { name: 'Acme Corp', website: 'https://acme.com', revenue: 1000000 };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual(['revenue', 'website']);
    });

    it('detects deleted keys present in before but missing or undefined in after', () => {
      const before = { name: 'Acme Corp', website: 'https://acme.com', notes: 'Old notes' };
      const after = { name: 'Acme Corp' };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual(['notes', 'website']);
    });

    it('detects keys explicitly set to undefined in after as deleted', () => {
      const before = { name: 'Acme Corp', notes: 'Old notes' };
      const after = { name: 'Acme Corp', notes: undefined };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual(['notes']);
    });

    it('detects modified scalar and primitive values', () => {
      const before = { name: 'Acme', count: 5, active: true, stage: 'LEAD' };
      const after = { name: 'Acme Corp', count: 6, active: false, stage: 'LEAD' };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual(['active', 'count', 'name']);
    });

    it('detects modifications in nested objects', () => {
      const before = { address: { street: 'Main St', city: 'Dallas' }, name: 'Acme' };
      const after = { address: { street: 'Main St', city: 'Austin' }, name: 'Acme' };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual(['address']);
    });

    it('detects modifications in arrays', () => {
      const before = { tags: ['tech', 'b2b'], name: 'Acme' };
      const after = { tags: ['tech', 'enterprise'], name: 'Acme' };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual(['tags']);
    });

    it('detects array length changes', () => {
      const before = { tags: ['tech'] };
      const after = { tags: ['tech', 'enterprise'] };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual(['tags']);
    });

    it('detects transitions between null and values or undefined', () => {
      const before = { assignedTo: null, budget: undefined, leadSource: 'WEB' };
      const after = { assignedTo: 'user-1', budget: 5000, leadSource: null };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual(['assignedTo', 'budget', 'leadSource']);
    });

    it('handles Date objects comparing timestamp equality', () => {
      const d1 = new Date('2026-01-01T00:00:00.000Z');
      const d2 = new Date('2026-01-01T00:00:00.000Z');
      const d3 = new Date('2026-01-02T00:00:00.000Z');

      const noChange = service.computeChangedFields(
        { date: d1, deadline: '2026-01-01T00:00:00.000Z' },
        { date: d2, deadline: d1 },
      );
      expect(noChange).toEqual([]);

      const changed = service.computeChangedFields(
        { date: d1 },
        { date: d3 },
      );
      expect(changed).toEqual(['date']);
    });

    it('considers equivalent ISO date strings with differing formatting as identical', () => {
      const before = {
        createdAt: '2026-10-08T12:00:00Z',
        updatedAt: '2026-10-08T12:00:00.000+00:00',
      };
      const after = {
        createdAt: '2026-10-08T12:00:00.000Z',
        updatedAt: '2026-10-08T12:00:00Z',
      };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual([]);
    });

    it('detects actually differing ISO date strings as changed', () => {
      const before = {
        createdAt: '2026-10-08T12:00:00Z',
      };
      const after = {
        createdAt: '2026-10-08T12:00:01Z',
      };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual(['createdAt']);
    });

    it('ignores identical keys across primitives, nested objects, and arrays', () => {
      const before = {
        name: 'Acme',
        count: 10,
        active: true,
        empty: null,
        tags: ['a', 'b'],
        meta: { region: 'US', tier: 1 },
      };
      const after = {
        name: 'Acme',
        count: 10,
        active: true,
        empty: null,
        tags: ['a', 'b'],
        meta: { region: 'US', tier: 1 },
      };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual([]);
    });

    it('handles null or undefined before and after arguments gracefully', () => {
      expect(service.computeChangedFields(null, null)).toEqual([]);
      expect(service.computeChangedFields(undefined, undefined)).toEqual([]);
      expect(service.computeChangedFields(null, { a: 1, b: 'two' })).toEqual(['a', 'b']);
      expect(service.computeChangedFields({ x: 10, y: 20 }, null)).toEqual(['x', 'y']);
      expect(service.computeChangedFields(undefined, { x: 1 })).toEqual(['x']);
      expect(service.computeChangedFields({ x: 1 }, undefined)).toEqual(['x']);
    });

    it('returns deterministically sorted changed field names', () => {
      const before = { z: 1, a: 2, m: 3 };
      const after = { z: 9, a: 8, m: 7 };

      const changed = service.computeChangedFields(before, after);
      expect(changed).toEqual(['a', 'm', 'z']);
    });

    it('works as standalone exported function identically to service method', () => {
      const before = { status: 'DRAFT', count: 1 };
      const after = { status: 'ACTIVE', count: 1 };

      expect(computeChangedFields(before, after)).toEqual(['status']);
    });
  });
});
