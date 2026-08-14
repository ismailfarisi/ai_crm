'use client';

import { useEffect, useState } from 'react';
import { Building2, Mail, Calendar, DollarSign, CreditCard, Tag } from 'lucide-react';
import type { CustomerDto } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { Input, Select } from '@/components/ui/field';
import { Badge } from '@/components/ui/primitives';

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
  { value: 'immediate', label: 'Immediate Payment' },
  { value: 'net_15', label: 'Net 15 Days' },
  { value: 'net_30', label: 'Net 30 Days' },
  { value: 'net_60', label: 'Net 60 Days' },
  { value: 'end_of_month', label: 'End of Current Month' },
];

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'AED', label: 'AED (د.إ)' },
  { value: 'SAR', label: 'SAR (﷼)' },
  { value: 'CAD', label: 'CAD ($)' },
  { value: 'AUD', label: 'AUD ($)' },
];

export function QuoteHeaderForm({
  data,
  onChange,
  readOnly = false,
}: QuoteHeaderFormProps) {
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
        currency: selectedCustomer.currency || data.currency || 'USD',
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
    <div className="rounded-xl border border-border bg-surface p-6 shadow-xs space-y-6">
      {/* Top Row: Quote Number badge and Title input */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-5">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2 mb-1.5">
            <Tag className="size-4 text-brand" />
            <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
              Quotation Header
            </span>
            <Badge tone="brand" className="font-mono text-xs">
              {data.quoteNumber || 'NEW DRAFT'}
            </Badge>
          </div>

          {readOnly ? (
            <h2 className="text-xl font-bold text-ink tracking-tight">
              {data.title || 'Untitled Quotation'}
            </h2>
          ) : (
            <input
              type="text"
              value={data.title}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="Quotation Title / Subject (e.g. Enterprise CRM Software & Services)"
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2 text-base font-semibold text-ink placeholder:text-ink-subtle focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden"
              required
            />
          )}
        </div>
      </div>

      {/* Grid of Customer, Expiry, Terms, Currency */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Customer Selector */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <Building2 className="size-3.5 text-ink-subtle" />
            Customer / Company
          </label>
          {readOnly ? (
            <div className="h-10 rounded-lg border border-border bg-surface-muted/40 px-3 py-2 text-sm font-medium text-ink flex items-center">
              {data.customerName || 'General Customer'}
            </div>
          ) : (
            <div className="space-y-2">
              <select
                value={data.customerId || ''}
                onChange={(e) => handleCustomerSelect(e.target.value)}
                disabled={isLoadingCustomers}
                className="w-full h-10 rounded-lg border border-border bg-surface px-3 text-sm text-ink focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden"
              >
                <option value="">-- Choose Existing Customer --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.companyName} {c.contactName ? `(${c.contactName})` : ''}
                  </option>
                ))}
              </select>

              {/* Editable customer name fallback if manual or custom */}
              <input
                type="text"
                placeholder="Or enter Customer / Account Name"
                value={data.customerName || ''}
                onChange={(e) => onChange({ customerName: e.target.value })}
                className="w-full h-9 rounded-lg border border-border/70 bg-surface px-3 text-xs text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-hidden"
              />
            </div>
          )}
        </div>

        {/* Customer Email */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <Mail className="size-3.5 text-ink-subtle" />
            Recipient Email
          </label>
          {readOnly ? (
            <div className="h-10 rounded-lg border border-border bg-surface-muted/40 px-3 py-2 text-sm text-ink flex items-center">
              {data.customerEmail || '—'}
            </div>
          ) : (
            <input
              type="email"
              placeholder="billing@customer.com"
              value={data.customerEmail || ''}
              onChange={(e) => onChange({ customerEmail: e.target.value })}
              className="w-full h-10 rounded-lg border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden"
            />
          )}
        </div>

        {/* Expiration Date */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <Calendar className="size-3.5 text-ink-subtle" />
            Expiration Date (Valid Until)
          </label>
          {readOnly ? (
            <div className="h-10 rounded-lg border border-border bg-surface-muted/40 px-3 py-2 text-sm text-ink flex items-center">
              {dateValue || 'No expiration set'}
            </div>
          ) : (
            <input
              type="date"
              value={dateValue}
              onChange={(e) => onChange({ validUntil: e.target.value || null })}
              className="w-full h-10 rounded-lg border border-border bg-surface px-3 text-sm text-ink focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden"
            />
          )}
        </div>

        {/* Payment Terms & Currency */}
        <div className="grid grid-cols-2 gap-2">
          {/* Payment Terms */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
              <CreditCard className="size-3.5 text-ink-subtle" />
              Terms
            </label>
            {readOnly ? (
              <div className="h-10 rounded-lg border border-border bg-surface-muted/40 px-3 py-2 text-xs text-ink flex items-center">
                {PAYMENT_TERMS_OPTIONS.find((p) => p.value === data.paymentTerms)?.label ||
                  data.paymentTerms}
              </div>
            ) : (
              <select
                value={data.paymentTerms}
                onChange={(e) => onChange({ paymentTerms: e.target.value })}
                className="w-full h-10 rounded-lg border border-border bg-surface px-2.5 text-xs text-ink focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden"
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
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink">
              <DollarSign className="size-3.5 text-ink-subtle" />
              Currency
            </label>
            {readOnly ? (
              <div className="h-10 rounded-lg border border-border bg-surface-muted/40 px-3 py-2 text-xs font-semibold text-ink flex items-center">
                {data.currency}
              </div>
            ) : (
              <select
                value={data.currency}
                onChange={(e) => onChange({ currency: e.target.value })}
                className="w-full h-10 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-ink focus:border-brand focus:ring-1 focus:ring-brand focus:outline-hidden"
              >
                {CURRENCY_OPTIONS.map((opt) => (
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
