'use client';

import { useEffect, useState } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';
import type { PublicQuoteDto } from '@saas/shared';
import { DepositPanel } from '@/components/payments/deposit-panel';
import { API_PUBLIC_URL } from '@/lib/api/config';
import { PublicQuoteProofs, PublicQuoteRespond } from './public-quote-responses';
import { publicQuoteCopy } from './public-quote-copy';

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
  const setQuote = (quote: PublicQuoteDto) => setState({ kind: 'ready', quote });

  useEffect(() => {
    let ignore = false;
    call(encodeURIComponent(token))
      .then((quote) => !ignore && setState({ kind: 'ready', quote }))
      .catch((err: Error) => !ignore && setState({ kind: 'refused', message: err.message }));
    return () => {
      ignore = true;
    };
  }, [token]);

  // Proof links are signed for minutes, not days. Fetch fresh ones shortly
  // before they lapse, so a page left open still opens the artwork.
  const nextExpiry = state.kind === 'ready'
    ? Math.min(
        ...state.quote.proofs
          .map((p) => (p.urlExpiresAt ? new Date(p.urlExpiresAt).getTime() : Infinity)),
      )
    : Infinity;
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const wait = Math.max(nextExpiry - Date.now() - 30_000, 5_000);
    const timer = setTimeout(() => {
      call(encodeURIComponent(token))
        .then((quote) => setState({ kind: 'ready', quote }))
        .catch(() => undefined);
    }, wait);
    return () => clearTimeout(timer);
  }, [nextExpiry, token]);

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
  const language = quote.language ?? 'en';
  const arabic = language === 'ar';
  const t = publicQuoteCopy(language);
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(arabic ? 'ar-AE-u-nu-latn' : undefined);
  // Arabic values print instead of the English on Arabic quotes and under it
  // on bilingual ones; a field without Arabic keeps its English.
  const pick = (en: string, ar: string | null | undefined) =>
    language === 'en' || !ar ? [en] : arabic ? [ar] : [en, ar];
  const customerNames = pick(quote.customerName, quote.customerNameAr);
  const customerName = customerNames.join(' / ');

  return (
    <main
      className="min-h-screen bg-surface-muted px-4 py-10"
      dir={arabic ? 'rtl' : 'ltr'}
      lang={arabic ? 'ar' : 'en'}
    >
      <article className="mx-auto max-w-3xl rounded-2xl border border-line bg-surface shadow-2xs">
        <header className="border-b border-line p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {/*
                Plain <img>, not next/image: this is served by the API on
                another origin, at whatever size the sender uploaded, and
                optimising it would mean routing a customer-facing document
                through the web app's image pipeline for no benefit.
              */}
              {quote.seller?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={quote.seller.logoUrl}
                  alt={`${quote.organizationName} logo`}
                  className="max-h-14 max-w-[180px] object-contain"
                />
              ) : null}
              <div>
                <p className="text-sm font-medium text-ink">{quote.organizationName}</p>
                {quote.seller?.legalName &&
                quote.seller.legalName !== quote.organizationName &&
                !(language === 'ar' && quote.seller.legalNameAr) ? (
                  <p className="text-xs text-ink-subtle">{quote.seller.legalName}</p>
                ) : null}
                {language !== 'en' && quote.seller?.legalNameAr ? (
                  <p className="text-xs text-ink-subtle" lang="ar" dir="rtl">
                    {quote.seller.legalNameAr}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Who the quote is from. Blank until the sender fills in Company
                settings, so nothing here assumes a value exists. */}
            <address className="text-end text-xs leading-relaxed text-ink-subtle not-italic">
              {(arabic && quote.seller?.addressAr ? [] : (quote.seller?.addressLines ?? [])).map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
              {language !== 'en' && quote.seller?.addressAr ? (
                <span className="block" lang="ar" dir="rtl">
                  {quote.seller.addressAr}
                </span>
              ) : null}
              {quote.seller?.taxId ? (
                <span className="block">
                  {t.label('taxReg')} <span dir="ltr">{quote.seller.taxId}</span>
                </span>
              ) : null}
              {quote.seller?.registrationNumber ? (
                <span className="block">
                  {t.label('companyNo')} <span dir="ltr">{quote.seller.registrationNumber}</span>
                </span>
              ) : null}
              {quote.seller?.email ? (
                <span className="block" dir="ltr">
                  {quote.seller.email}
                </span>
              ) : null}
              {quote.seller?.phone ? (
                <span className="block" dir="ltr">
                  {quote.seller.phone}
                </span>
              ) : null}
            </address>
          </div>

          <h1 className="mt-4 text-xl font-semibold text-ink">{quote.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {quote.quoteNumber ? <bdi>{quote.quoteNumber}</bdi> : null}
            {quote.quoteNumber ? ' · ' : ''}
            {t.label('preparedFor')} {customerName}
            {quote.validUntil ? ` · ${t.label('validUntil')} ${formatDate(quote.validUntil)}` : ''}
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-start text-xs text-ink-subtle">
              <tr>
                <th className="px-6 py-2 text-start font-medium">{t.label('item')}</th>
                <th className="px-3 py-2 text-end font-medium">{t.label('qty')}</th>
                <th className="px-3 py-2 text-end font-medium">{t.label('price')}</th>
                <th className="px-6 py-2 text-end font-medium">{t.label('amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {quote.items.map((item, index) => (
                <tr key={index}>
                  <td className="px-6 py-2 text-ink">
                    {pick(item.description, item.descriptionAr).map((text, i) => (
                      <span key={i} className={i ? 'block text-ink-muted' : 'block'} dir="auto">
                        {text}
                      </span>
                    ))}
                    {item.discount > 0 && (
                      <span className="block text-xs text-ink-subtle">
                        {t.lines('discount', { pct: String(item.discount) }).join(' / ')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">
                    {item.quantity} {item.uom ?? ''}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{money(item.unitPrice, quote.currency)}</td>
                  <td className="px-6 py-2 text-end tabular-nums" dir="ltr">{money(item.subtotal, quote.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ms-auto max-w-sm space-y-1 p-6 text-sm">
          <div className="flex justify-between text-ink-muted">
            <dt>{t.label('subtotal')}</dt>
            <dd className="tabular-nums" dir="ltr">{money(quote.subtotalAmount, quote.currency)}</dd>
          </div>
          {quote.taxAmount > 0 && (
            <div className="flex justify-between text-ink-muted">
              <dt>{t.label('tax')}</dt>
              <dd className="tabular-nums" dir="ltr">{money(quote.taxAmount, quote.currency)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-2 font-semibold text-ink">
            <dt>{t.label('total')}</dt>
            <dd className="tabular-nums" dir="ltr">{money(quote.totalAmount, quote.currency)}</dd>
          </div>
        </dl>

        {staged && (
          <section className="border-t border-line px-6 py-4" aria-labelledby="payment-heading">
            <h2 id="payment-heading" className="mb-2 text-sm font-medium text-ink">
              {t.label('schedule')}
            </h2>
            <ol className="space-y-1 text-sm text-ink-muted">
              {quote.billingSchedule.map((stage, index) => (
                <li key={index} className="flex justify-between">
                  <span>
                    {stage.label} ({stage.percent}%)
                  </span>
                  <span className="tabular-nums" dir="ltr">{money(stage.totalAmount, quote.currency)}</span>
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
            <h2 className="mb-2 text-sm font-medium text-ink">{t.label('terms')}</h2>
            <p className="whitespace-pre-line text-sm text-ink-muted">{quote.termsAndConditions}</p>
          </section>
        )}

        <PublicQuoteProofs
          quote={quote}
          token={token}
          call={call}
          name={name}
          onNameChange={setName}
          onChange={setQuote}
          copy={t}
          formatDate={formatDate}
        />

        <footer className="border-t border-line p-6">
          <PublicQuoteRespond
            quote={quote}
            token={token}
            call={call}
            name={name}
            onNameChange={setName}
            onChange={setQuote}
            copy={t}
            customerName={customerName}
            formatDate={formatDate}
          />
        </footer>

        {quote.acceptedAt && quote.deposit && (
          <div className="px-6 pb-6">
            <DepositPanel token={token} deposit={quote.deposit} currency={quote.currency} copy={t} />
          </div>
        )}
      </article>
    </main>
  );
}
