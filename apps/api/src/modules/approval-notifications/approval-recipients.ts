import type { EntityManager } from 'typeorm';

/**
 * Active users of `tenantId` who hold *every* one of `permissions` through
 * their roles (an all-permissions role counts), minus the requester. The
 * same role resolution as NotificationsService.notifyHolders.
 */
export async function approvalRecipients(
  manager: Pick<EntityManager, 'query'>,
  tenantId: string,
  permissions: readonly string[],
  excludeUserId?: string | null,
): Promise<string[]> {
  if (!permissions.length) return [];
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT u."id"
       FROM "users" u
       JOIN "user_roles" ur ON ur."userId" = u."id"
       JOIN "roles" r ON r."id" = ur."roleId"
       LEFT JOIN "role_permissions" rp ON rp."roleId" = r."id"
       LEFT JOIN "permissions" p ON p."id" = rp."permissionId"
      WHERE u."tenant_id" = $1
        AND u."isActive"
      GROUP BY u."id"
     HAVING bool_or(r."grantsAllPermissions")
         OR count(DISTINCT p."key") FILTER (WHERE p."key" = ANY($2::text[])) = cardinality($2::text[])
      ORDER BY u."id"`,
    [tenantId, permissions],
  );
  return rows.map((r) => r.id).filter((id) => id !== excludeUserId);
}

/** The one named user, if they are still active in this tenant. */
export async function activeUserInTenant(
  manager: Pick<EntityManager, 'query'>,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const rows: unknown[] = await manager.query(
    `SELECT 1 FROM "users" WHERE "id" = $1 AND "tenant_id" = $2 AND "isActive"`,
    [userId, tenantId],
  );
  return rows.length > 0;
}

/** Is the item itself still waiting? The request row can lag behind it. */
export async function itemStillPending(
  manager: Pick<EntityManager, 'query'>,
  tenantId: string,
  itemType: string,
  itemId: string,
): Promise<boolean> {
  const sql: Record<string, string> = {
    QUOTE: `SELECT 1 FROM "quotes" WHERE "id" = $1 AND "tenant_id" = $2 AND "status" = 'AWAITING_APPROVAL' AND "superseded_at" IS NULL`,
    AUTOMATION_APPROVAL: `SELECT 1 FROM "automation_approvals" WHERE "id" = $1 AND "tenantId" = $2 AND "status" = 'PENDING' AND ("expiresAt" IS NULL OR "expiresAt" > now())`,
    ASSISTANT_ACTION: `SELECT 1 FROM "assistant_turns" WHERE "id" = $1 AND "tenant_id" = $2 AND "status" = 'AWAITING_APPROVAL'`,
  };
  const query = sql[itemType];
  if (!query) return false;
  const rows: unknown[] = await manager.query(query, [itemId, tenantId]);
  return rows.length > 0;
}
