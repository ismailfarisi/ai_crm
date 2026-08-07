'use client';

import { Receipt, DollarSign, CheckCircle, type LucideIcon } from 'lucide-react';
import { useInvoices } from '@/hooks/use-invoices';
import { Card, CardBody, PageHeader } from '@/components/ui/primitives';
import { InvoicesTable } from '@/components/invoices/invoices-table';

const STAT_TONES = {
  brand: 'bg-brand-soft text-brand',
  info: 'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
} as const;

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: keyof typeof STAT_TONES;
}) {
  return (
    <Card>
      <CardBody className="flex items-center gap-4">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-lg ${STAT_TONES[tone]}`}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium tracking-wide text-ink-subtle uppercase">
            {label}
          </p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink">{value}</p>
        </div>
      </CardBody>
    </Card>
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

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-3">
        <Stat label="Issued Invoices" value={issuedInvoicesCount} icon={Receipt} tone="brand" />
        <Stat label="Total Issued Amount" value={formattedTotalIssued} icon={DollarSign} tone="info" />
        <Stat label="Paid Amount" value={formattedPaidAmount} icon={CheckCircle} tone="success" />
      </div>

      <Card>
        <InvoicesTable invoices={invoices} isLoading={isLoading} />
      </Card>
    </div>
  );
}
