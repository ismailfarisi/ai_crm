'use client';

import { Bot, History, User } from 'lucide-react';
import type { AuditLogDto } from '@saas/shared';
import { useRecordActivity } from '@/hooks/use-platform';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';

/** `quote.update` → "Updated"; `invoice.void` → "Voided". */
export function describeAction(action: string): string {
  const verb = action.split('.').slice(1).join(' ').replace(/_/g, ' ');
  if (!verb) return action;
  const past: Record<string, string> = {
    create: 'Created',
    update: 'Updated',
    delete: 'Deleted',
    signal: 'Decision recorded',
    approve: 'Approved',
    cancel: 'Cancelled',
    void: 'Voided',
    issue: 'Issued',
    payments: 'Payment recorded',
    dispatch: 'Dispatched',
    login: 'Signed in',
    'change password': 'Changed password',
    execute: 'Ran from chat',
    'mark accepted': 'Marked accepted',
    revise: 'Revised',
    send: 'Sent',
    submit: 'Submitted',
  };
  return past[verb] ?? verb.charAt(0).toUpperCase() + verb.slice(1);
}

/** Record fields as people say them, for the "Changed …" line. */
const FIELD_NAMES: Record<string, string> = {
  items: 'lines',
  subtotalAmount: 'subtotal',
  discountAmount: 'discount',
  taxAmount: 'tax',
  totalAmount: 'total',
  acceptedAt: 'acceptance',
  acceptedByName: 'acceptance',
  acceptedIp: 'acceptance',
  validUntil: 'valid-until date',
  paymentTerms: 'payment terms',
  customerId: 'customer',
  customerName: 'customer',
  customerEmail: 'customer email',
  termsAndConditions: 'terms',
  billingSchedule: 'billing',
  supersededAt: 'superseded',
};

/** `acceptedByName` → "acceptance", `leadTimeDays` → "lead time days"; each said once. */
export function describeFields(fields: string[]): string[] {
  const words = fields.map(
    (field) => FIELD_NAMES[field] ?? field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase(),
  );
  return [...new Set(words)];
}

export function ActivityRow({ entry }: { entry: AuditLogDto }) {
  const byModel = entry.origin !== 'HUMAN';
  const changed = describeFields(entry.changedFields);
  return (
    <li className="flex gap-3 py-2.5">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          byModel ? 'bg-info-soft text-info' : 'bg-surface-muted text-ink-muted'
        }`}
      >
        {byModel ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-pretty text-ink">
          <span className="font-medium">{describeAction(entry.action)}</span>
          {/*
            Which record. Without it the trail reads "Created by …", "Status by
            …" over and over, and you have to open a row to find out what it
            was about.
          */}
          {entry.summary ? (
            <>
              {' '}
              <span className="font-medium text-ink">{entry.summary}</span>
            </>
          ) : (
            ` ${entry.subjectType.replace(/_/g, ' ').toLowerCase()}`
          )}
          {entry.actorName ? ` by ${entry.actorName}` : ''}
          {byModel && (
            <span className="ml-1.5 rounded bg-info-soft px-1.5 py-0.5 text-xs text-info">
              {entry.origin === 'AI_DRAFTED' ? 'drafted by AI' : 'AI assisted'}
              {entry.channel !== 'WEB' ? ` · ${entry.channel.toLowerCase()}` : ''}
            </span>
          )}
        </p>
        {changed.length > 0 && (
          <p className="truncate text-xs text-ink-muted">
            Changed {changed.slice(0, 6).join(', ')}
            {changed.length > 6 ? ` and ${changed.length - 6} more` : ''}
          </p>
        )}
        {byModel && entry.model && (
          <p className="text-xs text-ink-subtle">
            {entry.model}
            {entry.promptVersion ? ` · ${entry.promptVersion}` : ''}
            {entry.confidence != null ? ` · confidence ${entry.confidence}` : ''}
          </p>
        )}
        <p className="text-xs text-ink-subtle">{new Date(entry.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      </div>
    </li>
  );
}

/**
 * What has happened to one record.
 *
 * Shown on a document page to whoever can read the document — the history of a
 * quote is part of the quote. The tenant-wide trail, which is a different and
 * much more powerful thing to hand someone, is behind `audit:read`.
 */
export function ActivityTimeline({
  subjectType,
  subjectId,
}: {
  subjectType: string;
  subjectId: string;
}) {
  const { data: entries = [], isLoading, isError } = useRecordActivity(subjectType, subjectId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4" /> Activity
        </CardTitle>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : isError ? (
          <p className="text-sm text-ink-muted">You do not have access to this record’s history.</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing recorded yet. The trail starts when this record is next changed.
          </p>
        ) : (
          <ul className="divide-y divide-border/25">
            {entries.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
