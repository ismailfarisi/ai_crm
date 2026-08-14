'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, FileText, Clock, CheckCircle, DollarSign, Sparkles, type LucideIcon } from 'lucide-react';
import { useQuotes } from '@/hooks/use-quotes';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/primitives';
import { QuotesTable } from '@/components/quotes/quotes-table';
import { CreateQuoteModal } from '@/components/quotes/create-quote-modal';

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

export function QuotesView() {
  const { quotes, isLoading, createQuote, sendSignal } = useQuotes();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const totalQuotes = quotes.length;
  const awaitingApproval = quotes.filter((q) => q.status === 'AWAITING_APPROVAL').length;
  const approved = quotes.filter((q) => q.status === 'APPROVED').length;
  const totalValue = quotes.reduce((acc, q) => acc + (q.totalAmount || 0), 0);

  const formattedTotalValue = `$${totalValue.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotes & Workflow Orchestration"
        description="Manage AI-generated and human quotes with automated approval workflows."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsModalOpen(true)}>
              <Sparkles className="size-4 mr-1.5 text-brand" />
              Quick AI Modal
            </Button>
            <Link href="/quotes/new">
              <Button variant="primary">
                <Plus className="size-4 mr-1.5" />
                New Quotation
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Quotes" value={totalQuotes} icon={FileText} tone="brand" />
        <Stat label="Awaiting Approval" value={awaitingApproval} icon={Clock} tone="warning" />
        <Stat label="Approved" value={approved} icon={CheckCircle} tone="success" />
        <Stat label="Total Value" value={formattedTotalValue} icon={DollarSign} tone="info" />
      </div>

      <QuotesTable
        quotes={quotes}
        isLoading={isLoading}
        onSignal={async (id, action) => {
          await sendSignal(id, action);
        }}
      />

      <CreateQuoteModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={async (payload) => {
          await createQuote(payload);
        }}
      />
    </div>
  );
}
