'use client';

import { useMemo, useState } from 'react';
import { Search, Mail, MessageSquare, Send, CheckCheck, AlertCircle } from 'lucide-react';
import type { ContactDto } from '@saas/shared';
import type { ChannelMessageDto } from '@/lib/api/endpoints';
import { formatRelative, initials } from '@/lib/utils';
import { Input } from '@/components/ui/field';
import { Badge } from '@/components/ui/primitives';

export type ProviderFilter = 'ALL' | 'WHATSAPP' | 'TELEGRAM' | 'EMAIL';

export interface ThreadGroup {
  id: string; // contactId or fallback key (recipient/sender)
  contactId: string | null;
  name: string;
  recipientOrSender: string;
  contact?: ContactDto | null;
  lastMessage: ChannelMessageDto;
  messages: ChannelMessageDto[];
  providers: Set<string>;
}

interface InboxThreadListProps {
  threads: ThreadGroup[];
  selectedThreadId: string | null;
  onSelectThread: (thread: ThreadGroup) => void;
  activeFilter: ProviderFilter;
  onFilterChange: (filter: ProviderFilter) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function InboxThreadList({
  threads,
  selectedThreadId,
  onSelectThread,
  activeFilter,
  onFilterChange,
  searchQuery,
  onSearchChange,
}: InboxThreadListProps) {
  const filteredThreads = useMemo(() => {
    return threads.filter((thread) => {
      // Filter by search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = thread.name.toLowerCase().includes(q);
        const matchesSnippet = thread.lastMessage.body.toLowerCase().includes(q);
        const matchesSender = thread.recipientOrSender.toLowerCase().includes(q);
        if (!matchesName && !matchesSnippet && !matchesSender) {
          return false;
        }
      }

      // Filter by provider
      if (activeFilter === 'WHATSAPP') {
        return thread.providers.has('WHATSAPP_META');
      }
      if (activeFilter === 'TELEGRAM') {
        return thread.providers.has('TELEGRAM');
      }
      if (activeFilter === 'EMAIL') {
        return thread.providers.has('EMAIL_SMTP') || thread.providers.has('EMAIL_RESEND');
      }

      return true;
    });
  }, [threads, searchQuery, activeFilter]);

  const filterButtons: { key: ProviderFilter; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'WHATSAPP', label: 'WhatsApp' },
    { key: 'TELEGRAM', label: 'Telegram' },
    { key: 'EMAIL', label: 'Email' },
  ];

  return (
    <div className="flex h-full flex-col border-r border-border bg-surface">
      {/* Header & Search */}
      <div className="space-y-3 p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-ink">Messages</h2>
          <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-subtle">
            {filteredThreads.length}
          </span>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Provider Badges Filter */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {filterButtons.map((btn) => {
            const isActive = activeFilter === btn.key;
            return (
              <button
                key={btn.key}
                onClick={() => onFilterChange(btn.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-brand text-white'
                    : 'bg-surface-muted text-ink-muted hover:bg-border/60 hover:text-ink'
                }`}
              >
                {btn.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Threads List */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/60 scrollbar-thin">
        {filteredThreads.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink-subtle">
            No conversation threads found.
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const isSelected = selectedThreadId === thread.id;
            const lastMsg = thread.lastMessage;
            const isOutbound = lastMsg.direction === 'OUTBOUND';

            return (
              <button
                key={thread.id}
                onClick={() => onSelectThread(thread)}
                className={`flex w-full items-start gap-3 p-3.5 text-left transition-colors ${
                  isSelected
                    ? 'bg-brand-soft/80 border-l-4 border-brand font-medium'
                    : 'hover:bg-surface-muted/60'
                }`}
              >
                {/* Avatar */}
                <div className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand ring-1 ring-brand/20">
                  {initials(thread.name, '')}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="truncate text-sm font-semibold text-ink">
                      {thread.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-subtle">
                      {formatRelative(lastMsg.createdAt)}
                    </span>
                  </div>

                  <p className="truncate text-xs text-ink-muted mb-1">
                    {isOutbound && <span className="text-ink-subtle font-normal">You: </span>}
                    {lastMsg.body}
                  </p>

                  <div className="flex items-center gap-1.5">
                    {/* Provider badge */}
                    <ChannelBadge provider={lastMsg.provider} />
                    
                    {/* Status icon for outbound */}
                    {isOutbound && (
                      <StatusIcon status={lastMsg.status} />
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function ChannelBadge({ provider }: { provider: string }) {
  if (provider === 'WHATSAPP_META') {
    return <Badge tone="success">WhatsApp</Badge>;
  }
  if (provider === 'TELEGRAM') {
    return <Badge tone="brand">Telegram</Badge>;
  }
  return <Badge tone="warning">Email</Badge>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'failed') {
    return (
      <span title="Failed">
        <AlertCircle className="size-3 text-danger shrink-0" />
      </span>
    );
  }
  if (status === 'delivered' || status === 'sent') {
    return (
      <span title={status}>
        <CheckCheck className="size-3 text-brand shrink-0" />
      </span>
    );
  }
  return (
    <span title={status}>
      <Send className="size-3 text-ink-subtle shrink-0" />
    </span>
  );
}
