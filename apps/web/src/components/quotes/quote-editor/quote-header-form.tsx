'use client';

import { useEffect, useId, useState } from 'react';
import { Building2, Mail, Calendar, Coins, CreditCard } from 'lucide-react';
import type { CustomerDto } from '@saas/shared';
import { CURRENCY_OPTIONS, currencyLabel } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { formatDate } from './format';

export interface QuoteHeaderFormData {
  title: string;
  quoteNumber?: string;
  customerId?: string | null;
  customerName?: string;
  customerEmail?: string | null;
  validUntil?: string | null;
  paymentTerms: string;
  currency: string;
}

interface QuoteHeaderFormProps {
  data: QuoteHeaderFormData;
  onChange: (data: Partial<QuoteHeaderFormData>) => void;
  readOnly?: boolean;
}

const PAYMENT_TERMS_OPTIONS = [
  { value: 'immediate', label: 'Immediate payment' },
  { value: 'net_15', label: 'Net 15 days' },
  { value: 'net_30', label: 'Net 30 days' },
  { value: 'net_60', label: 'Net 60 days' },
  { value: 'end_of_month', label: 'End of the month' },
];

/** One shared list, so a currency that can be quoted can also be banked. */
const DOCUMENT_CURRENCIES = CURRENCY_OPTIONS.map((currency) => ({
  value: currency.code,
  label: currencyLabel(currency.code),
}));

export function QuoteHeaderForm({
  data,
  onChange,
  readOnly = false,
}: QuoteHeaderFormProps) {
  const fieldId = useId();
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);

  useEffect(() => {
    let ignore = false;
    setIsLoadingCustomers(true);
    api.customers
      .list({ limit: 100 })
      .then((res) => {
        if (!ignore && res?.items) {
          setCustomers(res.items);
        }
      })
      .catch(() => {
        // Fallback silently if customer listing has error
      })
      .finally(() => {
        if (!ignore) setIsLoadingCustomers(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  const handleCustomerSelect = (customerId: string) => {
    if (!customerId) {
      onChange({
        customerId: null,
      });
      return;
    }

    const selectedCustomer = customers.find((c) => c.id === customerId);
    if (selectedCustomer) {
      let terms = 'immediate';
      if (selectedCustomer.paymentTermsDays === 15) terms = 'net_15';
      else if (selectedCustomer.paymentTermsDays === 30) terms = 'net_30';
      else if (selectedCustomer.paymentTermsDays === 60) terms = 'net_60';

      onChange({
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.companyName || selectedCustomer.contactName || '',
        customerEmail: selectedCustomer.email || '',
        currency: selectedCustomer.currency || data.currency,
        paymentTerms: terms,
      });
    }
  };

  // Convert validUntil (ISO or YYYY-MM-DD) to date input value
  const dateValue = data.validUntil
    ? data.validUntil.includes('T')
      ? data.validUntil.split('T')[0]
      : data.validUntil
    : '';

  return (
    <div className="bg-surface rounded-2xl border border-border/60 p-4 sm:p-6 shadow-[0_2px_10px_rgba(0,0,0,0.015)] space-y-6">
      {/* The title; the number already heads the page */}
      <div className="border-b border-border/60 pb-5">
        <div className="space-y-1.5">
          {readOnly ? (
            <p className="text-base font-semibold text-ink">{data.title || 'Untitled quote'}</p>
          ) : (
            <>
            <label htmlFor={`${fieldId}-title`} className="block text-xs font-medium text-ink">
              Quote title
            </label>
            <input
              id={`${fieldId}-title`}
              type="text"
              value={data.title}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="What is this quote for? (e.g. Ramadan gift boxes for Al Noor)"
              className="w-full rounded-xl border border-border-control bg-surface-muted/40 px-3.5 py-2 text-base font-semibold text-ink placeholder:text-ink-subtle focus:bg-surface focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden transition-colors"
              required
            />
            </>
          )}
        </div>
      </div>

      {/* Customer, send-to, expiry, then terms and currency, which need the most room */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
        {/* Customer Selector */}
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-customer`} className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <Building2 className="size-3.5 text-ink-subtle" aria-hidden />
            Customer
          </label>
          {readOnly ? (
            <div className="flex min-h-10 items-center text-sm font-medium text-ink">
              {data.customerName || 'No customer set'}
            </div>
          ) : (
            <div className="space-y-2">
              <select
                id={`${fieldId}-customer`}
                value={data.customerId || ''}
                onChange={(e) => handleCustomerSelect(e.target.value)}
                disabled={isLoadingCustomers}
                className="w-full h-10 rounded-xl border border-border-control bg-surface-muted/40 px-3 text-sm text-ink focus:bg-surface focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden transition-colors"
              >
                <option value="">Choose a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName} {c.contactName ? `(${c.contactName})` : ''}
                  </option>
                ))}
              </select>

              {/* Editable customer name fallback if manual or custom */}
              <input
                type="text"
                placeholder="Or type a customer name"
                aria-label="Customer name, if not in the list"
                value={data.customerName || ''}
                onChange={(e) => onChange({ customerName: e.target.value })}
                className="w-full h-10 rounded-xl border border-border-control bg-surface-muted/40 px-3 text-sm text-ink placeholder:text-ink-subtle focus:bg-surface focus:border-brand-ring focus:outline-hidden transition-colors"
              />
            </div>
          )}
        </div>

        {/* Customer Email */}
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-email`} className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <Mail className="size-3.5 text-ink-subtle" aria-hidden />
            Send to
          </label>
          {readOnly ? (
            <div className="flex min-h-10 items-center text-sm text-ink">
              {data.customerEmail || '—'}
            </div>
          ) : (
            <input
              id={`${fieldId}-email`}
              type="email"
              placeholder="buyer@customer.com"
              value={data.customerEmail || ''}
              onChange={(e) => onChange({ customerEmail: e.target.value })}
              className="w-full h-10 rounded-xl border border-border-control bg-surface-muted/40 px-3 text-sm text-ink placeholder:text-ink-subtle focus:bg-surface focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden transition-colors"
            />
          )}
        </div>

        {/* Expiration Date */}
        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-valid`} className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <Calendar className="size-3.5 text-ink-subtle" aria-hidden />
            Valid until
          </label>
          {readOnly ? (
            <div className="flex min-h-10 items-center text-sm text-ink">
              {dateValue ? formatDate(dateValue) : 'No date set'}
            </div>
          ) : (
            <input
              id={`${fieldId}-valid`}
              type="date"
              value={dateValue}
              onChange={(e) => onChange({ validUntil: e.target.value || null })}
              className="w-full h-10 rounded-xl border border-border-control bg-surface-muted/40 px-3 text-sm text-ink focus:bg-surface focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden transition-colors"
            />
          )}
        </div>

        {/* Payment Terms & Currency */}
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-2">
          {/* Payment Terms */}
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-terms`} className="flex items-center gap-1.5 text-xs font-medium text-ink">
              <CreditCard className="size-3.5 text-ink-subtle" aria-hidden />
              Payment terms
            </label>
            {readOnly ? (
              <div className="flex min-h-10 items-center text-sm text-ink ">
                {PAYMENT_TERMS_OPTIONS.find((p) => p.value === data.paymentTerms)?.label ||
                  data.paymentTerms}
              </div>
            ) : (
              <select
                id={`${fieldId}-terms`}
                value={data.paymentTerms}
                onChange={(e) => onChange({ paymentTerms: e.target.value })}
                className="w-full h-10 rounded-xl border border-border-control bg-surface-muted/40 px-2.5 text-sm text-ink focus:bg-surface focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden transition-colors"
              >
                {PAYMENT_TERMS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Currency */}
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-currency`} className="flex items-center gap-1.5 text-xs font-medium text-ink">
              <Coins className="size-3.5 text-ink-subtle" aria-hidden />
              Currency
            </label>
            {readOnly ? (
              <div className="flex min-h-10 items-center text-sm font-semibold text-ink ">
                {data.currency}
              </div>
            ) : (
              <select
                id={`${fieldId}-currency`}
                value={data.currency}
                onChange={(e) => onChange({ currency: e.target.value })}
                className="w-full h-10 rounded-xl border border-border-control bg-surface-muted/40 px-2.5 text-sm font-semibold text-ink focus:bg-surface focus:border-brand-ring focus:ring-1 focus:ring-brand-ring focus:outline-hidden transition-colors"
              >
                {DOCUMENT_CURRENCIES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
