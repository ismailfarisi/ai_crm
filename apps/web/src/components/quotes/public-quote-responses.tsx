'use client';

import { useState } from 'react';
import { CheckCircle2, CircleAlert, FileText, Loader2, MessageSquare, XCircle } from 'lucide-react';
import {
  latestProof,
  QUOTE_PROOF_STATUS_LABELS,
  type PublicQuoteDto,
  type PublicQuoteProofDto,
  type QuoteProofStatus,
} from '@saas/shared';
import { publicQuoteCopy, type PublicQuoteCopy } from './public-quote-copy';

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

function StatusBadge({ status }: { status: QuoteProofStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>
      {QUOTE_PROOF_STATUS_LABELS[status]}
    </span>
  );
}

function useSubmit(onDone: (quote: PublicQuoteDto) => void) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<PublicQuoteDto>) => {
    setSubmitting(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
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

function ProofPreview({ proof }: { proof: PublicQuoteProofDto }) {
  if (!proof.url) {
    return <p className="text-sm text-ink-subtle">This file is no longer available.</p>;
  }
  if (proof.contentType.startsWith('image/')) {
    return (
      <a href={proof.url} target="_blank" rel="noreferrer" className="block">
        {/* Signed link on the API's origin; next/image would proxy a private file. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={proof.url}
          alt={`Proof v${proof.version}`}
          className="max-h-[480px] w-full rounded-lg border border-line bg-surface-muted object-contain"
        />
      </a>
    );
  }
  return (
    <a href={proof.url} target="_blank" rel="noreferrer" className={secondaryButton}>
      <FileText className="size-4" />
      Open {proof.filename}
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
}: {
  quote: PublicQuoteDto;
  token: string;
  call: PublicCall;
  name: string;
  onNameChange: (v: string) => void;
  onChange: (quote: PublicQuoteDto) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'changes'>('idle');
  const [comment, setComment] = useState('');
  const { submitting, error, run } = useSubmit((next) => {
    setMode('idle');
    setComment('');
    onChange(next);
  });
  const latest = latestProof(quote.proofs);
  const older = quote.proofs.filter((p) => p.id !== latest?.id);
  if (!latest) return null;
  const canAnswer = latest.status === 'PENDING' && quote.customerResponse?.kind !== 'DECLINED';
  const base = `${encodeURIComponent(token)}/proofs/${latest.id}`;

  return (
    <section className="border-t border-line px-6 py-5" aria-labelledby="proof-heading">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="proof-heading" className="text-sm font-medium text-ink">
          Artwork proof v{latest.version}
        </h2>
        <StatusBadge status={latest.status} />
      </div>
      {latest.staffNote && <p className="mb-3 whitespace-pre-line text-sm text-ink-muted">{latest.staffNote}</p>}
      <ProofPreview proof={latest} />

      {latest.status !== 'PENDING' && latest.respondedByName && (
        <p className="mt-3 text-sm text-ink-muted">
          {latest.status === 'APPROVED' ? 'Approved' : 'Changes requested'} by {latest.respondedByName}
          {latest.respondedAt ? ` on ${new Date(latest.respondedAt).toLocaleDateString()}` : ''}.
          {latest.responseComment ? ` “${latest.responseComment}”` : ''}
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
          <NameField value={name} onChange={onNameChange} />
          {mode === 'changes' && (
            <label className="block text-sm">
              <span className="mb-1 block text-ink">What needs to change?</span>
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
                  Send changes
                </button>
                <button type="button" onClick={() => setMode('idle')} className={secondaryButton}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="submit" disabled={submitting || name.trim().length < 2} className={primaryButton}>
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  Approve proof
                </button>
                <button type="button" onClick={() => setMode('changes')} className={secondaryButton}>
                  Request changes
                </button>
              </>
            )}
          </div>
        </form>
      )}

      {older.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-ink-muted">Earlier versions ({older.length})</summary>
          <ul className="mt-2 space-y-2">
            {older.map((proof) => (
              <li key={proof.id} className="flex flex-wrap items-center gap-2 text-ink-muted">
                {proof.url ? (
                  <a href={proof.url} target="_blank" rel="noreferrer" className="text-ink underline">
                    Proof v{proof.version}
                  </a>
                ) : (
                  <span>Proof v{proof.version}</span>
                )}
                <StatusBadge status={proof.status} />
                {proof.responseComment && <span>“{proof.responseComment}”</span>}
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
  formatDate = (iso: string) => new Date(iso).toLocaleDateString(),
}: {
  quote: PublicQuoteDto;
  token: string;
  call: PublicCall;
  name: string;
  onNameChange: (v: string) => void;
  onChange: (quote: PublicQuoteDto) => void;
  /** The accept wording in the customer's document language. */
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
  });
  const seller = quote.organizationName || 'the team';
  const response = quote.customerResponse;

  if (quote.acceptedAt) {
    return (
      <div className="flex items-start gap-2 text-sm text-success">
        <CheckCircle2 className="size-5 shrink-0" />
        <div>
          {copy
            .lines('accepted', {
              name: quote.acceptedByName ?? '',
              date: formatDate(quote.acceptedAt),
              org: quote.organizationName || (quote.language === 'ar' ? 'الفريق' : 'the team'),
            })
            .map((line) => (
              <p key={line}>{line}</p>
            ))}
        </div>
      </div>
    );
  }

  if (response?.kind === 'DECLINED') {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <XCircle className="size-5 shrink-0" />
        You declined this quote{response.at ? ` on ${new Date(response.at).toLocaleDateString()}` : ''}. Contact {seller}{' '}
        if you change your mind.
      </p>
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
    { key: 'accept', label: 'Accept' },
    { key: 'changes', label: 'Request changes' },
    { key: 'decline', label: 'Decline' },
  ];

  return (
    <div className="space-y-4">
      {response?.kind === 'CHANGES_REQUESTED' && (
        <p className="flex items-start gap-2 rounded-lg bg-surface-muted p-3 text-sm text-ink-muted">
          <MessageSquare className="mt-0.5 size-4 shrink-0" />
          You asked for changes{response.at ? ` on ${new Date(response.at).toLocaleDateString()}` : ''}. {seller} will
          send an updated quote. You can still accept this one.
        </p>
      )}

      <div role="radiogroup" aria-label="Your response" className="flex flex-wrap gap-2">
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
            {quote.proofs.length
              ? 'Please approve the artwork proof above first. You can accept the quote once the latest proof is approved.'
              : `${seller} will send an artwork proof for you to approve. You can accept the quote once it is approved.`}
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
              {copy.lines('agree', { customer: customerName }).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </span>
          </label>
        )}
        {choice !== 'accept' && (
          <label className="block text-sm">
            <span className="mb-1 block text-ink">
              {choice === 'changes' ? 'What would you like changed?' : 'Reason (optional)'}
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
          {choice === 'accept' ? copy.label('accept') : choice === 'changes' ? 'Send request' : 'Decline quote'}
        </button>
      </form>
    </div>
  );
}
