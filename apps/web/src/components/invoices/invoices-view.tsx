'use client';

import { Receipt, DollarSign, CheckCircle, type LucideIcon } from 'lucide-react';
import { useInvoices } from '@/hooks/use-invoices';
import { PageHeader } from '@/components/ui/primitives';
import { InvoicesTable } from '@/components/invoices/invoices-table';

const STAT_TONES = {
  brand: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  info: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
} as const;

function Stat({
  label,
  value,
  icon: Icon,
  tone = 'brand',
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: keyof typeof STAT_TONES;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${STAT_TONES[tone]}`}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink tracking-tight">{value}</p>
      </div>
    </div>
  );
}

export function InvoicesView() {
  const { invoices, isLoading } = useInvoices();

  const issuedInvoicesCount = invoices.length;
  const totalIssuedAmount = invoices.reduce((acc, inv) => acc + (inv.amount || 0), 0);
  const paidAmount = invoices
    .filter((inv) => inv.status === 'PAID')
    .reduce((acc, inv) => acc + (inv.amount || 0), 0);

  const formattedTotalIssued = `$${totalIssuedAmount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const formattedPaidAmount = `$${paidAmount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Track issued and paid invoices generated from approved quotes."
      />

      <div className="flex flex-wrap items-center gap-x-12 gap-y-4 py-2">
        <Stat label="Issued Invoices" value={issuedInvoicesCount} icon={Receipt} tone="brand" />
        <Stat label="Total Issued Amount" value={formattedTotalIssued} icon={DollarSign} tone="info" />
        <Stat label="Paid Amount" value={formattedPaidAmount} icon={CheckCircle} tone="success" />
      </div>

      <InvoicesTable invoices={invoices} isLoading={isLoading} />
    </div>
  );
}

