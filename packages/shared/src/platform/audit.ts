/**
 * The audit trail: who changed what, when, and on whose instruction.
 *
 * Every state-changing HTTP route writes one row. The rows are append-only —
 * there is no update or delete path, and no soft delete — because an audit
 * trail that can be edited answers no question worth asking.
 */

/** Who or what decided. `AI_DRAFTED` means a model produced the record a person then confirmed. */
export const AUDIT_ORIGINS = ['HUMAN', 'AI_ASSISTED', 'AI_DRAFTED'] as const;
export type AuditOrigin = (typeof AUDIT_ORIGINS)[number];

/** Where the instruction arrived from. */
export const AUDIT_CHANNELS = [
  'WEB',
  'TELEGRAM',
  'WHATSAPP',
  'EMAIL',
  'SYSTEM',
] as const;
export type AuditChannel = (typeof AUDIT_CHANNELS)[number];

export interface AuditProvenance {
  origin: AuditOrigin;
  channel: AuditChannel;
  /** The exact inbound message, when one caused this. */
  messageId?: string | null;
  /** The model that drafted it, e.g. `claude-sonnet-5`. */
  model?: string | null;
  /** Which revision of the skill's schema and description produced it. */
  promptVersion?: string | null;
  /** What the router reported, 0–1. */
  confidence?: number | null;
}

export interface AuditLogDto extends AuditProvenance {
  id: string;
  action: string;
  subjectType: string;
  subjectId: string | null;
  summary: string | null;
  actorId: string | null;
  actorName: string | null;
  ip: string | null;
  changedFields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditPageDto {
  items: AuditLogDto[];
  total: number;
}

/**
 * Field names never written to an audit row, at any depth.
 *
 * The trail records what changed, not what the secret was. A password hash or
 * a provider key in a `before` blob would turn the audit table into the
 * softest target in the database.
 */
export const AUDIT_REDACTED_FIELDS = [
  'password',
  'passwordhash',
  'password_hash',
  'currentpassword',
  'newpassword',
  'token',
  'tokenhash',
  'token_hash',
  'refreshtoken',
  'accesstoken',
  'apikey',
  'api_key',
  'secret',
  'secretkey',
  'webhooksecret',
  'signature',
  'encryptedcredentials',
  'credentials',
] as const;

const REDACTED = '[redacted]';
const isRedacted = (key: string) =>
  (AUDIT_REDACTED_FIELDS as readonly string[]).includes(
    key.toLowerCase().replace(/[^a-z_]/g, ''),
  );

/**
 * Copies a record for storage: secrets removed, dates flattened to ISO, and
 * anything unserialisable dropped rather than thrown over.
 */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (value == null) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return depth > 4 ? '[deep]' : value.map((v) => redactForAudit(v, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth > 4) return '[deep]';
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isRedacted(key) ? REDACTED : redactForAudit(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  return value;
}

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The fields that actually changed.
 *
 * Timestamps maintained by the ORM are excluded: `updatedAt` changes on every
 * write, so leaving it in would make every row report a change even when the
 * user edited nothing.
 */
export const AUDIT_IGNORED_FIELDS = ['updatedAt', 'updated_at', 'version'];

export function changedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => !AUDIT_IGNORED_FIELDS.includes(key))
    .filter((key) => !sameValue(before[key], after[key]))
    .sort();
}

/**
 * `POST /quotes/:id/signal` → `quote.signal`; `PATCH /invoices/:id` →
 * `invoice.update`. Derived from the route rather than declared at each call
 * site, so a route added without thinking about auditing is still audited.
 *
 * Fed the route *pattern* (`quotes/:id/signal`), not the request path, so a
 * parameter is recognised by its colon rather than by guessing whether a
 * segment looks like an id. Concrete paths still work: a uuid or a number in
 * parameter position is treated the same way.
 */
export function auditActionFor(
  method: string,
  segments: string[],
): string | null {
  const [head, ...rest] = segments;
  if (!head) return null;
  const subject = head.replace(/s$/, '').replace(/-/g, '_');
  const tail = rest.filter((s) => !isParam(s)).pop();
  if (tail) return `${subject}.${tail.replace(/-/g, '_')}`;
  switch (method.toUpperCase()) {
    case 'POST':
      return `${subject}.create`;
    case 'PATCH':
    case 'PUT':
      return `${subject}.update`;
    case 'DELETE':
      return `${subject}.delete`;
    default:
      return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A route parameter: `:id` in a pattern, or the value that filled it. */
export const isParam = (segment: string) =>
  segment.startsWith(':') || UUID.test(segment) || /^\d+$/.test(segment);

export interface AuditQuery {
  subjectType?: string;
  subjectId?: string;
  actorId?: string;
  action?: string;
  origin?: AuditOrigin;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}
