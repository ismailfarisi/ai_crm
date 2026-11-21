'use client';

import { useState } from 'react';
import { CheckCircle2, CircleAlert, FileText, Loader2, MessageSquare, XCircle } from 'lucide-react';
import {
  latestProof,
  type PublicQuoteDto,
  type PublicQuoteProofDto,
  type QuoteProofStatus,
} from '@saas/shared';
import { publicQuoteCopy, type PublicQuoteCopy, type PublicQuoteCopyKey } from './public-quote-copy';

export type PublicCall = (path: string, init?: RequestInit) => Promise<PublicQuoteDto>;

const inputClass =
  'w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/40';
const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-on-brand disabled:opacity-50';
const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-full border border-line bg-surface px-5 py-2 text-sm font-medium text-ink hover:bg-surface-muted disabled:opacity-50';

const STATUS_TONE: Record<QuoteProofStatus, string> = {
  PENDING: 'bg-warning-soft text-warning',
  APPROVED: 'bg-success-soft text-success',
  CHANGES_REQUESTED: 'bg-danger-soft text-danger',
};

const STATUS_COPY: Record<QuoteProofStatus, PublicQuoteCopyKey> = {
  PENDING: 'proofPending',
  APPROVED: 'proofApproved',
  CHANGES_REQUESTED: 'proofChangesRequested',
};

const defaultFormatDate = (iso: string) => new Date(iso).toLocaleDateString();

function StatusBadge({ status, copy }: { status: QuoteProofStatus; copy: PublicQuoteCopy }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>
      {copy.label(STATUS_COPY[status])}
    </span>
  );
}

/** A sentence in each language to show, stacked; bilingual quotes read English then Arabic. */
function Lines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line) => (
        <span key={line} className="block" dir="auto">
          {line}
        </span>
      ))}
    </>
  );
}

function useSubmit(onDone: (quote: PublicQuoteDto) => void, fallbackError: string) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<PublicQuoteDto>) => {
    setSubmitting(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackError);
    } finally {
      setSubmitting(false);
    }
  };
  return { submitting, error, run };
}

function NameField({
  value,
  onChange,
  label = 'Your full name',
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-ink">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="name"
        required
        minLength={2}
        maxLength={255}
        className={`${inputClass} max-w-sm`}
      />
    </label>
  );
}

function ProofPreview({ proof, copy }: { proof: PublicQuoteProofDto; copy: PublicQuoteCopy }) {
  if (!proof.url) {
    return <p className="text-sm text-ink-subtle">{copy.label('proofUnavailable')}</p>;
  }
  if (proof.contentType.startsWith('image/')) {
    return (
      <a href={proof.url} target="_blank" rel="noreferrer" className="block">
        {/* Signed link on the API's origin; next/image would proxy a private file. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={proof.url}
          alt={copy.label('proofName', { version: String(proof.version) })}
          className="max-h-[480px] w-full rounded-lg border border-line bg-surface-muted object-contain"
        />
      </a>
    );
  }
  return (
    <a href={proof.url} target="_blank" rel="noreferrer" className={secondaryButton}>
      <FileText className="size-4" />
      {copy.label('openFile', { filename: proof.filename })}
    </a>
  );
}

/** The artwork proof: the latest version to approve or send back, older ones for reference. */
export function PublicQuoteProofs({
  quote,
  token,
  call,
  name,
  onNameChange,
  onChange,
  copy = publicQuoteCopy('en'),
  formatDate = defaultFormatDate,
}: {
  quote: PublicQuoteDto;
  token: string;
  call: PublicCall;
  name: string;
  onNameChange: (v: string) => void;
  onChange: (quote: PublicQuoteDto) => void;
  /** Wording in the customer's document language. */
  copy?: PublicQuoteCopy;
  formatDate?: (iso: string) => string;
}) {
  const [mode, setMode] = useState<'idle' | 'changes'>('idle');
  const [comment, setComment] = useState('');
  const { submitting, error, run } = useSubmit((next) => {
    setMode('idle');
    setComment('');
    onChange(next);
  }, copy.label('genericError'));
  const latest = latestProof(quote.proofs);
  const older = quote.proofs.filter((p) => p.id !== latest?.id);
  if (!latest) return null;
  const canAnswer = latest.status === 'PENDING' && quote.customerResponse?.kind !== 'DECLINED';
  const base = `${encodeURIComponent(token)}/proofs/${latest.id}`;

  return (
    <section className="border-t border-line px-6 py-5" aria-labelledby="proof-heading">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="proof-heading" className="text-sm font-medium text-ink">
          {copy.label('proofHeading', { version: String(latest.version) })}
        </h2>
        <StatusBadge status={latest.status} copy={copy} />
      </div>
      {latest.staffNote && <p className="mb-3 whitespace-pre-line text-sm text-ink-muted">{latest.staffNote}</p>}
      <ProofPreview proof={latest} copy={copy} />

      {latest.status !== 'PENDING' && latest.respondedByName && (
        <p className="mt-3 text-sm text-ink-muted">
          <Lines
            lines={copy.lines(
              latest.status === 'APPROVED'
                ? latest.respondedAt
                  ? 'proofApprovedByOn'
                  : 'proofApprovedBy'
                : latest.respondedAt
                  ? 'proofChangesByOn'
                  : 'proofChangesBy',
              {
                name: latest.respondedByName,
                date: latest.respondedAt ? formatDate(latest.respondedAt) : '',
              },
            )}
          />
          {latest.responseComment && (
            <span className="block" dir="auto">
              “{latest.responseComment}”
            </span>
          )}
        </p>
      )}

      {canAnswer && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() =>
              mode === 'changes'
                ? call(`${base}/request-changes`, {
                    method: 'POST',
                    body: JSON.stringify({ name: name.trim(), comment: comment.trim() }),
                  })
                : call(`${base}/approve`, { method: 'POST', body: JSON.stringify({ name: name.trim() }) }),
            );
          }}
        >
          <NameField value={name} onChange={onNameChange} label={copy.label('yourName')} />
          {mode === 'changes' && (
            <label className="block text-sm">
              <span className="mb-1 block text-ink">{copy.label('proofChangeQuestion')}</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                required
                maxLength={2000}
                rows={3}
                className={inputClass}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {mode === 'changes' ? (
              <>
                <button
                  type="submit"
                  disabled={submitting || name.trim().length < 2 || !comment.trim()}
                  className={primaryButton}
                >
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  {copy.label('sendChanges')}
                </button>
                <button type="button" onClick={() => setMode('idle')} className={secondaryButton}>
                  {copy.label('cancel')}
                </button>
              </>
            ) : (
              <>
                <button type="submit" disabled={submitting || name.trim().length < 2} className={primaryButton}>
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  {copy.label('approveProof')}
                </button>
                <button type="button" onClick={() => setMode('changes')} className={secondaryButton}>
                  {copy.label('requestChanges')}
                </button>
              </>
            )}
          </div>
        </form>
      )}

      {older.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-ink-muted">
            {copy.label('earlierVersions', { count: String(older.length) })}
          </summary>
          <ul className="mt-2 space-y-2">
            {older.map((proof) => (
              <li key={proof.id} className="flex flex-wrap items-center gap-2 text-ink-muted">
                {proof.url ? (
                  <a href={proof.url} target="_blank" rel="noreferrer" className="text-ink underline">
                    {copy.label('proofName', { version: String(proof.version) })}
                  </a>
                ) : (
                  <span>{copy.label('proofName', { version: String(proof.version) })}</span>
                )}
                <StatusBadge status={proof.status} copy={copy} />
                {proof.responseComment && <span dir="auto">“{proof.responseComment}”</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

type Choice = 'accept' | 'changes' | 'decline';

/** Accept, ask for changes, or decline. Accepting waits for an approved proof when the seller asks for one. */
export function PublicQuoteRespond({
  quote,
  token,
  call,
  name,
  onNameChange,
  onChange,
  copy = publicQuoteCopy('en'),
  customerName = quote.customerName,
  formatDate = defaultFormatDate,
}: {
  quote: PublicQuoteDto;
  token: string;
  call: PublicCall;
  name: string;
  onNameChange: (v: string) => void;
  onChange: (quote: PublicQuoteDto) => void;
  /** Wording in the customer's document language. */
  copy?: PublicQuoteCopy;
  customerName?: string;
  formatDate?: (iso: string) => string;
}) {
  const [choice, setChoice] = useState<Choice>('accept');
  const [agreed, setAgreed] = useState(false);
  const [note, setNote] = useState('');
  const { submitting, error, run } = useSubmit((next) => {
    setNote('');
    setChoice('accept');
    onChange(next);
  }, copy.label('genericError'));
  const seller = quote.organizationName || copy.label('team');
  const response = quote.customerResponse;

  if (quote.acceptedAt) {
    return (
      <div className="flex items-start gap-2 text-sm text-success">
        <CheckCircle2 className="size-5 shrink-0" />
        <p>
          <Lines
            lines={copy.lines('accepted', {
              name: quote.acceptedByName ?? '',
              date: formatDate(quote.acceptedAt),
              org: seller,
            })}
          />
        </p>
      </div>
    );
  }

  if (response?.kind === 'DECLINED') {
    return (
      <div className="flex items-start gap-2 text-sm text-ink-muted">
        <XCircle className="size-5 shrink-0" />
        <p>
          <Lines
            lines={copy.lines(response.at ? 'declinedOn' : 'declined', {
              org: seller,
              date: response.at ? formatDate(response.at) : '',
            })}
          />
        </p>
      </div>
    );
  }

  const blocked = quote.proofBlocksAcceptance;
  const submit = () => {
    const path = encodeURIComponent(token);
    if (choice === 'accept') {
      return call(`${path}/accept`, { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    }
    if (choice === 'changes') {
      return call(`${path}/request-changes`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), note: note.trim() }),
      });
    }
    return call(`${path}/decline`, {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), reason: note.trim() || null }),
    });
  };
  const ready =
    name.trim().length >= 2 &&
    (choice === 'accept' ? agreed && !blocked : choice === 'changes' ? note.trim().length > 0 : true);

  const tabs: { key: Choice; label: string }[] = [
    { key: 'accept', label: copy.label('tabAccept') },
    { key: 'changes', label: copy.label('requestChanges') },
    { key: 'decline', label: copy.label('tabDecline') },
  ];

  return (
    <div className="space-y-4">
      {response?.kind === 'CHANGES_REQUESTED' && (
        <p className="flex items-start gap-2 rounded-lg bg-surface-muted p-3 text-sm text-ink-muted">
          <MessageSquare className="mt-0.5 size-4 shrink-0" />
          <span>
            <Lines
              lines={copy.lines(response.at ? 'changesAskedOn' : 'changesAsked', {
                org: seller,
                date: response.at ? formatDate(response.at) : '',
              })}
            />
          </span>
        </p>
      )}

      <div role="radiogroup" aria-label={copy.label('yourResponse')} className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="radio"
            aria-checked={choice === tab.key}
            onClick={() => setChoice(tab.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              choice === tab.key ? 'bg-ink text-surface' : 'border border-line bg-surface text-ink hover:bg-surface-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(submit);
        }}
      >
        {choice === 'accept' && blocked && (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              <Lines lines={copy.lines(quote.proofs.length ? 'approveProofFirst' : 'proofComing', { org: seller })} />
            </span>
          </p>
        )}
        <NameField value={name} onChange={onNameChange} label={copy.label('yourName')} />
        {choice === 'accept' && (
          <label className="flex items-start gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={blocked}
              className="mt-0.5"
            />
            <span>
              <Lines lines={copy.lines('agree', { customer: customerName })} />
            </span>
          </label>
        )}
        {choice !== 'accept' && (
          <label className="block text-sm">
            <span className="mb-1 block text-ink">
              {copy.label(choice === 'changes' ? 'changesQuestion' : 'reasonOptional')}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required={choice === 'changes'}
              maxLength={2000}
              rows={3}
              className={inputClass}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={!ready || submitting} className={choice === 'accept' ? primaryButton : secondaryButton}>
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {copy.label(choice === 'accept' ? 'accept' : choice === 'changes' ? 'sendRequest' : 'declineQuote')}
        </button>
      </form>
    </div>
  );
}
