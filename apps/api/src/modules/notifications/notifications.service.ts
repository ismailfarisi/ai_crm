import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import type {
  NotificationDto,
  NotificationType,
  Permission,
} from '@saas/shared';
import { Notification } from './entities/notification.entity';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

/**
 * In-app notifications: the bell.
 *
 * Recipients are chosen by permission, not by role or by name — "everyone who
 * can approve this" — resolved from the same role and permission tables the
 * request guard reads, so a notification never reaches someone who could not
 * act on it and always reaches someone who can.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Notifies every active user holding `permission`.
   *
   * Pass the caller's `manager` when inside a transaction, so a rolled-back
   * change leaves no notification about something that did not happen.
   * Failures are logged and swallowed: a notification is never a reason for
   * the operation that triggered it to fail.
   */
  async notifyHolders(
    tenantId: string,
    permission: Permission,
    input: NotificationInput,
    options: { manager?: EntityManager; excludeUserId?: string | null } = {},
  ): Promise<number> {
    const manager = options.manager ?? this.dataSource.manager;
    // Inside someone else's transaction, a failed statement would poison the
    // whole transaction even though the error is caught here. A savepoint
    // keeps the failure to this notification.
    const savepoint = Boolean(options.manager);
    if (savepoint) await manager.query('SAVEPOINT notify_holders');
    try {
      const rows: { id: string }[] = await manager.query(
        `SELECT DISTINCT u."id"
         FROM "users" u
         JOIN "user_roles" ur ON ur."userId" = u."id"
         JOIN "roles" r ON r."id" = ur."roleId"
         LEFT JOIN "role_permissions" rp ON rp."roleId" = r."id"
         LEFT JOIN "permissions" p ON p."id" = rp."permissionId"
         WHERE u."organizationId" = $1
           AND u."isActive"
           AND (r."grantsAllPermissions" OR p."key" = $2)`,
        [tenantId, permission],
      );
      const recipients = rows
        .map((r) => r.id)
        .filter((id) => id !== options.excludeUserId);
      if (!recipients.length) {
        if (savepoint) await manager.query('RELEASE SAVEPOINT notify_holders');
        return 0;
      }

      // One unread notification per person per thing: the partial unique index
      // turns a repeat into a no-op rather than a second bell item.
      const values: unknown[] = [];
      const tuples = recipients.map((userId, i) => {
        const o = i * 8;
        values.push(
          tenantId,
          userId,
          input.type,
          input.title.slice(0, 200),
          input.body ?? null,
          input.link ?? null,
          input.entityType ?? null,
          input.entityId ?? null,
        );
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8})`;
      });
      await manager.query(
        `INSERT INTO "notifications" ("tenant_id", "user_id", "type", "title", "body", "link", "entity_type", "entity_id")
         VALUES ${tuples.join(', ')}
         ON CONFLICT DO NOTHING`,
        values,
      );
      if (savepoint) await manager.query('RELEASE SAVEPOINT notify_holders');
      return recipients.length;
    } catch (err) {
      if (savepoint) {
        await manager
          .query('ROLLBACK TO SAVEPOINT notify_holders')
          .catch(() => undefined);
      }
      this.logger.warn(
        `Could not notify holders of ${permission}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  /** Marks notifications about something as read once it has been dealt with, for everyone. */
  async resolve(
    tenantId: string,
    entityId: string,
    manager?: EntityManager,
  ): Promise<void> {
    try {
      await (manager ?? this.dataSource.manager).query(
        `UPDATE "notifications" SET "read_at" = now() WHERE "tenant_id" = $1 AND "entity_id" = $2 AND "read_at" IS NULL`,
        [tenantId, entityId],
      );
    } catch (err) {
      this.logger.warn(
        `Could not resolve notifications for ${entityId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listFor(
    tenantId: string,
    userId: string,
  ): Promise<{ items: NotificationDto[]; unread: number }> {
    const [items, unread] = await Promise.all([
      this.notifications.find({
        where: { tenantId, userId },
        order: { createdAt: 'DESC' },
        take: 50,
      }),
      this.notifications.count({
        where: { tenantId, userId, readAt: IsNull() },
      }),
    ]);
    return {
      unread,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  async markRead(tenantId: string, userId: string, id: string): Promise<void> {
    const result = await this.notifications.update(
      { id, tenantId, userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    if (!result.affected) {
      const exists = await this.notifications.exists({
        where: { id, tenantId, userId },
      });
      if (!exists) throw new NotFoundException('Notification not found');
    }
  }

  async markAllRead(tenantId: string, userId: string): Promise<void> {
    await this.notifications.update(
      { tenantId, userId, readAt: IsNull() },
      { readAt: new Date() },
    );
  }
}
