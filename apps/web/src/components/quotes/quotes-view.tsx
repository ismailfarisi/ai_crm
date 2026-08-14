'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, FileText, Clock, CheckCircle, DollarSign, Sparkles, type LucideIcon } from 'lucide-react';
import { useQuotes } from '@/hooks/use-quotes';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/primitives';
import { QuotesTable } from '@/components/quotes/quotes-table';
import { CreateQuoteModal } from '@/components/quotes/create-quote-modal';

const STAT_TONES = {
  brand: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400',
  warning: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400',
  success: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400',
  info: 'bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400',
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
      <span className={`grid size-9 place-items-center rounded-xl ${STAT_TONES[tone]}`}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</p>
        <p className="text-2xl font-semibold tabular-nums text-ink tracking-tight">{value}</p>
      </div>
    </div>
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
            <Button
              variant="outline"
              className="rounded-full px-4 text-xs"
              onClick={() => setIsModalOpen(true)}
            >
              <Sparkles className="size-3.5 mr-1.5 text-brand" />
              Quick AI Modal
            </Button>
            <Link href="/quotes/new">
              <Button variant="primary" className="rounded-full px-5 text-xs font-semibold">
                <Plus className="size-3.5 mr-1.5" />
                New Quotation
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-12 gap-y-4 py-2">
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
