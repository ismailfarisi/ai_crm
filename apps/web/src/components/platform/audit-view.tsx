'use client';

import { useState } from 'react';
import { AUDIT_ORIGINS, type AuditLogDto } from '@saas/shared';
import { useAuditTrail } from '@/hooks/use-platform';
import { ActivityRow } from './activity-timeline';
import { Button } from '@/components/ui/button';
import { Card, CardBody, EmptyState, PageHeader } from '@/components/ui/primitives';

const SUBJECTS = [
  'QUOTE',
  'INVOICE',
  'PURCHASE_ORDER',
  'BILL',
  'SALES_ORDER',
  'WORK_ORDER',
  'CREDIT_NOTE',
  'DELIVERY_NOTE',
  'EXPENSE_CLAIM',
  'CUSTOMER',
  'SUPPLIER',
  'USER',
  'ROLE',
];

const PAGE = 50;

/**
 * The tenant-wide trail.
 *
 * Deliberately plain: filters, a list, and the before-and-after of whatever
 * you click. It is a place to answer "who changed this and when", not a
 * dashboard.
 */
export function AuditView() {
  const [subjectType, setSubjectType] = useState('');
  const [origin, setOrigin] = useState('');
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AuditLogDto | null>(null);

  const { data, isLoading } = useAuditTrail({
    subjectType: subjectType || undefined,
    origin: origin || undefined,
    action: action || undefined,
    limit: PAGE,
    offset,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const reset = (apply: () => void) => {
    apply();
    setOffset(0);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit trail"
        description="Every change, who made it, and what it was before. Records are never edited or removed."
      />

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-ink-muted">Record type</span>
            <select
              className="rounded-md border border-border/50 px-2 py-1.5 text-sm"
              value={subjectType}
              onChange={(e) => reset(() => setSubjectType(e.target.value))}
            >
              <option value="">All</option>
              {SUBJECTS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-muted">Origin</span>
            <select
              className="rounded-md border border-border/50 px-2 py-1.5 text-sm"
              value={origin}
              onChange={(e) => reset(() => setOrigin(e.target.value))}
            >
              <option value="">Anyone</option>
              {AUDIT_ORIGINS.map((o) => (
                <option key={o} value={o}>
                  {o === 'HUMAN' ? 'A person' : o === 'AI_DRAFTED' ? 'Drafted by AI' : 'AI assisted'}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink-muted">Action starts with</span>
            <input
              className="rounded-md border border-border/50 px-2 py-1.5 text-sm"
              placeholder="quote."
              value={action}
              onChange={(e) => reset(() => setAction(e.target.value))}
            />
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          {isLoading ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : items.length === 0 ? (
            <EmptyState
              title="Nothing recorded"
              description="No changes match these filters."
            />
          ) : (
            <ul className="divide-y divide-border/25">
              {items.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="block w-full text-left hover:bg-surface-muted/60"
                  onClick={() => setSelected(entry)}
                >
                  <ActivityRow entry={entry} />
                </button>
              ))}
            </ul>
          )}
          {total > PAGE && (
            <div className="mt-3 flex items-center justify-between text-sm text-ink-muted">
              <span>
                {offset + 1}–{Math.min(offset + PAGE, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE >= total}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {selected && (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-medium text-ink">
                  {selected.action} · {selected.subjectType.replace(/_/g, ' ').toLowerCase()}
                </h3>
                <p className="text-xs text-ink-muted">
                  {new Date(selected.createdAt).toLocaleString()}
                  {selected.actorName ? ` · ${selected.actorName}` : ''}
                  {selected.ip ? ` · ${selected.ip}` : ''}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Snapshot label="Before" value={selected.before} fields={selected.changedFields} />
              <Snapshot label="After" value={selected.after} fields={selected.changedFields} />
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/**
 * Shows the changed fields first and the rest underneath. A raw jsonb dump of
 * an invoice is 40 lines, of which two matter.
 */
function Snapshot({
  label,
  value,
  fields,
}: {
  label: string;
  value: Record<string, unknown> | null;
  fields: string[];
}) {
  if (!value) {
    return (
      <div>
        <p className="mb-1 text-xs font-medium uppercase text-ink-muted">{label}</p>
        <p className="text-sm text-ink-muted">Not recorded</p>
      </div>
    );
  }
  const changed = fields.filter((f) => f in value);
  const rest = Object.keys(value).filter((k) => !changed.includes(k));
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase text-ink-muted">{label}</p>
      <dl className="space-y-1 text-sm">
        {[...changed, ...rest].slice(0, 40).map((key) => (
          <div
            key={key}
            className={`flex gap-2 ${changed.includes(key) ? 'font-medium text-ink' : 'text-ink-muted'}`}
          >
            <dt className="shrink-0">{key}</dt>
            <dd className="truncate">{format(value[key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const format = (value: unknown): string =>
  value === null || value === undefined
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
