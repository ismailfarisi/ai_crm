import { Injectable, Logger } from '@nestjs/common';
import type { CrmDomainEvent } from '@saas/shared';

@Injectable()
export class CrmEventBusService {
  private readonly logger = new Logger(CrmEventBusService.name);
  private readonly subscribers: Array<(event: CrmDomainEvent) => Promise<void>> = [];

  /**
   * Registers a subscriber callback for CRM domain events.
   * Returns an idempotent unsubscribe function that removes the subscriber.
   */
  subscribe(handler: (event: CrmDomainEvent) => Promise<void>): () => void {
    this.subscribers.push(handler);
    return () => {
      const index = this.subscribers.indexOf(handler);
      if (index !== -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  /**
   * Publishes a CRM domain event to all registered subscribers.
   * Uses Promise.allSettled to guarantee that failure in any subscriber does not
   * interrupt other subscribers or throw back to the caller.
   */
  async publish(event: CrmDomainEvent): Promise<void> {
    if (this.subscribers.length === 0) {
      return;
    }

    const currentSubscribers = [...this.subscribers];
    const results = await Promise.allSettled(
      currentSubscribers.map((handler) => handler(event)),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        const error = result.reason;
        this.logger.error(
          `Error executing subscriber for CRM domain event "${event.eventType}" on ${event.entityName}:${event.entityId}: ${error?.message ?? error}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  /**
   * Compares before and after entity state records and returns a sorted list of
   * unique field names that were added, removed, or modified.
   */
  computeChangedFields(
    before: Record<string, any> | null | undefined,
    after: Record<string, any> | null | undefined,
  ): string[] {
    const b = before ?? {};
    const a = after ?? {};

    const allKeys = new Set<string>([...Object.keys(b), ...Object.keys(a)]);
    const changedFields: string[] = [];

    for (const key of allKeys) {
      const hasBefore =
        Object.prototype.hasOwnProperty.call(b, key) && b[key] !== undefined;
      const hasAfter =
        Object.prototype.hasOwnProperty.call(a, key) && a[key] !== undefined;

      if (!hasBefore && !hasAfter) {
        continue;
      }

      if (hasBefore !== hasAfter) {
        changedFields.push(key);
        continue;
      }

      if (!this.isEqual(b[key], a[key])) {
        changedFields.push(key);
      }
    }

    return changedFields.sort();
  }

  /**
   * Deep strict equality comparison supporting primitives, Date instances,
   * ISO date strings, arrays, and nested plain objects.
   */
  private isEqual(a: any, b: any): boolean {
    if (Object.is(a, b)) {
      return true;
    }

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }

    if (a instanceof Date && typeof b === 'string') {
      const db = new Date(b);
      return !isNaN(db.getTime()) && a.getTime() === db.getTime();
    }

    if (b instanceof Date && typeof a === 'string') {
      const da = new Date(a);
      return !isNaN(da.getTime()) && b.getTime() === da.getTime();
    }

    if (
      typeof a !== 'object' ||
      a === null ||
      typeof b !== 'object' ||
      b === null
    ) {
      return false;
    }

    if (Array.isArray(a) !== Array.isArray(b)) {
      return false;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        if (!this.isEqual(a[i], b[i])) {
          return false;
        }
      }
      return true;
    }

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) {
      return false;
    }

    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) {
        return false;
      }
      if (!this.isEqual(a[key], b[key])) {
        return false;
      }
    }

    return true;
  }
}
