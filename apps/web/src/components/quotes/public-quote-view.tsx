'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import type { PublicQuoteDto } from '@saas/shared';
import { API_PUBLIC_URL } from '@/lib/api/config';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; quote: PublicQuoteDto }
  | { kind: 'refused'; message: string };

const money = (n: number, currency: string) =>
  `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

/**
 * Uses plain `fetch`, not `apiFetch`: that client carries the signed-in
 * session's refresh-and-retry behaviour, and nothing about this page should
 * depend on, or disturb, whoever else is signed in on the browser.
 */
async function call(path: string, init?: RequestInit): Promise<PublicQuoteDto> {
  const response = await fetch(`${API_PUBLIC_URL}/public/quotes/${path}`, {
    ...init,
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (typeof body?.message === 'object' ? body.message?.message : body?.message) ??
      (response.status === 429
        ? 'Too many attempts. Please wait a minute and try again.'
        : 'This link is not valid. Please check it, or contact the sender.');
    throw new Error(Array.isArray(message) ? message.join(' ') : String(message));
  }
  return body as PublicQuoteDto;
}

export function PublicQuoteView({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    call(encodeURIComponent(token))
      .then((quote) => !ignore && setState({ kind: 'ready', quote }))
      .catch((err: Error) => !ignore && setState({ kind: 'refused', message: err.message }));
    return () => {
      ignore = true;
    };
  }, [token]);

  const accept = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const quote = await call(`${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() }),
      });
      setState({ kind: 'ready', quote });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (state.kind === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center bg-surface-muted">
        <Loader2 className="size-6 animate-spin text-ink-subtle" aria-label="Loading" />
      </main>
    );
  }

  if (state.kind === 'refused') {
    return (
      <main className="grid min-h-screen place-items-center bg-surface-muted px-4">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-2xs">
          <CircleAlert className="mx-auto mb-3 size-8 text-ink-subtle" />
          <p className="text-ink">{state.message}</p>
        </div>
      </main>
    );
  }

  const { quote } = state;
  const staged = quote.billingSchedule.length > 1;

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-2xl border border-line bg-surface shadow-2xs">
        <header className="border-b border-line p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink">{quote.organizationName}</p>
              {quote.seller?.legalName && quote.seller.legalName !== quote.organizationName ? (
                <p className="text-xs text-ink-subtle">{quote.seller.legalName}</p>
              ) : null}
            </div>

            {/* Who the quote is from. Blank until the sender fills in Company
                settings, so nothing here assumes a value exists. */}
            <address className="text-right text-xs leading-relaxed text-ink-subtle not-italic">
              {(quote.seller?.addressLines ?? []).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              {quote.seller?.taxId ? (
                <span className="block">Tax reg. {quote.seller.taxId}</span>
              ) : null}
              {quote.seller?.registrationNumber ? (
                <span className="block">Co. no. {quote.seller.registrationNumber}</span>
              ) : null}
              {quote.seller?.email ? <span className="block">{quote.seller.email}</span> : null}
              {quote.seller?.phone ? <span className="block">{quote.seller.phone}</span> : null}
            </address>
          </div>

          <h1 className="mt-4 text-xl font-semibold text-ink">{quote.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {quote.quoteNumber ? `${quote.quoteNumber} · ` : ''}Prepared for {quote.customerName}
            {quote.validUntil ? ` · Valid until ${new Date(quote.validUntil).toLocaleDateString()}` : ''}
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-subtle">
              <tr>
                <th className="px-6 py-2 font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-6 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {quote.items.map((item, index) => (
                <tr key={index}>
                  <td className="px-6 py-2 text-ink">
                    {item.description}
                    {item.discount > 0 && (
                      <span className="block text-xs text-ink-subtle">{item.discount}% discount</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.quantity} {item.uom ?? ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(item.unitPrice, quote.currency)}</td>
                  <td className="px-6 py-2 text-right tabular-nums">{money(item.subtotal, quote.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto max-w-xs space-y-1 p-6 text-sm">
          <div className="flex justify-between text-ink-muted">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{money(quote.subtotalAmount, quote.currency)}</dd>
          </div>
          {quote.taxAmount > 0 && (
            <div className="flex justify-between text-ink-muted">
              <dt>Tax</dt>
              <dd className="tabular-nums">{money(quote.taxAmount, quote.currency)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(quote.totalAmount, quote.currency)}</dd>
          </div>
        </dl>

        {staged && (
          <section className="border-t border-line px-6 py-4" aria-labelledby="payment-heading">
            <h2 id="payment-heading" className="mb-2 text-sm font-medium text-ink">
              How this will be invoiced
            </h2>
            <ol className="space-y-1 text-sm text-ink-muted">
              {quote.billingSchedule.map((stage, index) => (
                <li key={index} className="flex justify-between">
                  <span>
                    {stage.label} ({stage.percent}%)
                  </span>
                  <span className="tabular-nums">{money(stage.totalAmount, quote.currency)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {quote.seller?.documentFooter && (
          <section className="border-t border-line px-6 py-4">
            <p className="whitespace-pre-line text-xs text-ink-muted">
              {quote.seller.documentFooter}
            </p>
          </section>
        )}

        {quote.termsAndConditions && (
          <section className="border-t border-line px-6 py-4">
            <h2 className="mb-2 text-sm font-medium text-ink">Terms</h2>
            <p className="whitespace-pre-line text-sm text-ink-muted">{quote.termsAndConditions}</p>
          </section>
        )}

        <footer className="border-t border-line p-6">
          {quote.acceptedAt ? (
            <p className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="size-5" />
              Accepted by {quote.acceptedByName} on {new Date(quote.acceptedAt).toLocaleDateString()}. Thank
              you — {quote.organizationName || 'the team'} will be in touch.
            </p>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void accept();
              }}
            >
              <label className="block text-sm">
                <span className="mb-1 block text-ink">Your full name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={255}
                  className="w-full max-w-sm rounded border border-line bg-surface px-3 py-2 text-ink"
                />
              </label>
              <label className="flex items-start gap-2 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5"
                />
                I accept this quote and its terms on behalf of {quote.customerName}.
              </label>
              {submitError && (
                <p role="alert" className="text-sm text-danger">
                  {submitError}
                </p>
              )}
              <button
                type="submit"
                disabled={!agreed || name.trim().length < 2 || submitting}
                className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Accept quote
              </button>
            </form>
          )}
        </footer>
      </article>
    </main>
  );
}
