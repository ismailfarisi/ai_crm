import { CrmEventBusService } from './crm-event-bus.service';
import type { CrmDomainEvent } from '@saas/shared';

describe('CrmEventBusService', () => {
  let service: CrmEventBusService;

  beforeEach(() => {
    service = new CrmEventBusService();
  });

  describe('publish and subscribe', () => {
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
      expect(received1[0]).toEqual(event);
      expect(received2).toHaveLength(1);
      expect(received2[0]).toEqual(event);
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

    it('shields errors so an error in one subscriber does not disrupt other subscribers and does not throw in publish', async () => {
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
      expect(healthySubscriberReceived[0]).toEqual(event);
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
  });
});
