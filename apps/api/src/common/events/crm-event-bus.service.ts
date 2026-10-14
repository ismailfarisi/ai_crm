import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type { CrmDomainEvent } from '@saas/shared';
import { EventOutboxService, type OutboxMessage } from './event-outbox.service';

const ISO_DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Deep strict equality comparison supporting primitives, Date instances,
 * equivalent ISO date strings with differing formats, arrays, and nested plain objects.
 */
function isEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  // Equivalent ISO date strings with differing formatting (e.g. Z vs .000Z or timezones)
  if (typeof a === 'string' && typeof b === 'string') {
    if (ISO_DATE_REGEX.test(a) && ISO_DATE_REGEX.test(b)) {
      const da = new Date(a);
      const db = new Date(b);
      if (!isNaN(da.getTime()) && !isNaN(db.getTime())) {
        return da.getTime() === db.getTime();
      }
    }
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (a instanceof Date && typeof b === 'string') {
    if (ISO_DATE_REGEX.test(b)) {
      const db = new Date(b);
      return !isNaN(db.getTime()) && a.getTime() === db.getTime();
    }
    return false;
  }

  if (b instanceof Date && typeof a === 'string') {
    if (ISO_DATE_REGEX.test(a)) {
      const da = new Date(a);
      return !isNaN(da.getTime()) && b.getTime() === da.getTime();
    }
    return false;
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
      if (!isEqual(a[i], b[i])) {
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
    if (!isEqual(a[key], b[key])) {
      return false;
    }
  }

  return true;
}

/**
 * Compares before and after entity state records and returns a sorted list of
 * unique field names that were added, removed, or modified.
 */
export function computeChangedFields(
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

    if (!isEqual(b[key], a[key])) {
      changedFields.push(key);
    }
  }

  return changedFields.sort();
}

/** Outbox kind for CRM domain events. */
export const CRM_EVENT_OUTBOX_KIND = 'crm_event';

/**
 * What a subscriber receives: the published event plus `eventId`, which is
 * the outbox row id and therefore the same on every redelivery. Delivery is
 * at-least-once, so a subscriber with side effects should dedupe on it.
 */
export type DeliveredCrmDomainEvent = CrmDomainEvent & { eventId: string };

export type CrmEventSubscriber = (
  event: DeliveredCrmDomainEvent,
) => Promise<void>;

export interface PublishOptions {
  /**
   * The caller's transaction. When given, the event is written in it and
   * commits (or rolls back) with the change it describes.
   */
  manager?: EntityManager;
}

@Injectable()
export class CrmEventBusService {
  private readonly logger = new Logger(CrmEventBusService.name);
  private readonly subscribers: CrmEventSubscriber[] = [];

  constructor(@Optional() private readonly outbox?: EventOutboxService) {
    this.outbox?.registerHandler(CRM_EVENT_OUTBOX_KIND, (message) =>
      this.deliverFromOutbox(message),
    );
  }

  /**
   * Registers a subscriber callback for CRM domain events.
   * Returns an idempotent unsubscribe function that removes the subscriber.
   */
  subscribe(handler: CrmEventSubscriber): () => void {
    this.subscribers.push(handler);
    return () => {
      const index = this.subscribers.indexOf(handler);
      if (index !== -1) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  /**
   * Publishes a CRM domain event.
   *
   * With the outbox available (always, inside Nest) this only persists the
   * event and returns: subscribers run later in the dispatcher, so a slow or
   * failing subscriber can neither slow down nor fail the request that made
   * the change, and a failed delivery is retried rather than lost.
   *
   * Without a manager the event is written in its own statement — callers
   * publish after their commit, so a crash between the two can still lose
   * it. Pass `{ manager }` from inside the transaction to close that gap.
   *
   * If the outbox write itself fails outside a transaction, the change has
   * already committed and must not turn into an error for the user, so the
   * event is delivered in-process as a best effort and the failure is logged.
   * Inside a transaction the error is rethrown: Postgres has already aborted
   * that transaction, and the caller must see it.
   */
  async publish(
    event: CrmDomainEvent,
    options: PublishOptions = {},
  ): Promise<void> {
    if (!this.outbox) {
      await this.deliverInProcess({ ...event, eventId: randomUUID() });
      return;
    }

    try {
      await this.outbox.enqueue(
        {
          tenantId: event.tenantId,
          kind: CRM_EVENT_OUTBOX_KIND,
          eventType: event.eventType,
          payload: event,
        },
        options.manager,
      );
    } catch (error) {
      if (options.manager) throw error;
      this.logger.error(
        `Could not persist CRM domain event "${event.eventType}" on ${event.entityName}:${event.entityId} to the outbox; delivering in-process without retry: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      setImmediate(
        () => void this.deliverInProcess({ ...event, eventId: randomUUID() }),
      );
    }
  }

  /**
   * Outbox handler. Every subscriber runs; if any fails the whole event is
   * reported failed so the dispatcher retries it — which redelivers to the
   * subscribers that succeeded too, hence the stable `eventId`.
   */
  private async deliverFromOutbox(message: OutboxMessage): Promise<void> {
    const event: DeliveredCrmDomainEvent = {
      ...(message.payload as CrmDomainEvent),
      eventId: message.id,
    };
    const failures = await this.runSubscribers(event);
    if (failures.length) {
      throw new Error(
        failures
          .map((reason) =>
            reason instanceof Error ? reason.message : String(reason),
          )
          .join('; '),
      );
    }
  }

  /** Shielded: failures are logged, never thrown. */
  private async deliverInProcess(
    event: DeliveredCrmDomainEvent,
  ): Promise<void> {
    await this.runSubscribers(event);
  }

  /**
   * Wraps handler invocations in async closures so both synchronous exceptions
   * and asynchronous rejections are captured in Promise.allSettled.
   */
  private async runSubscribers(
    event: DeliveredCrmDomainEvent,
  ): Promise<unknown[]> {
    if (this.subscribers.length === 0) {
      return [];
    }

    const currentSubscribers = [...this.subscribers];
    const results = await Promise.allSettled(
      currentSubscribers.map(async (handler) => handler(event)),
    );

    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === 'rejected') {
        const error = result.reason;
        failures.push(error);
        this.logger.error(
          `Error executing subscriber for CRM domain event "${event.eventType}" on ${event.entityName}:${event.entityId} (event ${event.eventId}): ${error?.message ?? error}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return failures;
  }

  /**
   * Compares before and after entity state records and returns a sorted list of
   * unique field names that were added, removed, or modified.
   */
  computeChangedFields(
    before: Record<string, any> | null | undefined,
    after: Record<string, any> | null | undefined,
  ): string[] {
    return computeChangedFields(before, after);
  }
}
