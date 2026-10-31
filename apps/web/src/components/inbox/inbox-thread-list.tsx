'use client';

import { useMemo } from 'react';
import { Search, Send, CheckCheck, AlertCircle } from 'lucide-react';
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
  staffUser?: {
    id: string;
    name: string;
    email: string;
    role?: string;
  } | null;
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
            type="search"
            aria-label="Search conversations"
            placeholder="Search conversations…"
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
                type="button"
                aria-pressed={isActive}
                onClick={() => onFilterChange(btn.key)}
                className={`h-10 rounded-full px-3.5 text-xs font-medium transition-colors md:h-8 ${
                  isActive
                    ? 'bg-charcoal text-on-charcoal'
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
          <div className="p-8 text-center text-sm text-ink-muted">
            No conversations match. Clear the search or pick another channel.
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const isSelected = selectedThreadId === thread.id;
            const lastMsg = thread.lastMessage;
            const isOutbound = lastMsg.direction === 'OUTBOUND';

            return (
              <button
                key={thread.id}
                type="button"
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => onSelectThread(thread)}
                className={`flex w-full items-start gap-3 p-3.5 text-left transition-colors focus-visible:-outline-offset-2 ${
                  isSelected ? 'bg-brand-soft' : 'hover:bg-surface-muted/60'
                }`}
              >
                {/* Avatar */}
                <div
                  aria-hidden
                  className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-semibold text-ink ring-1 ring-border"
                >
                  {initials(thread.name, '')}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate text-sm font-semibold text-ink">
                        {thread.name}
                      </span>
                      {thread.staffUser && <Badge className="shrink-0">Staff</Badge>}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-ink-subtle">
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

/** The channel's everyday name: what the customer used, not the driver behind it. */
export function channelName(provider: string): string {
  if (provider === 'WHATSAPP_META') return 'WhatsApp';
  if (provider === 'TELEGRAM') return 'Telegram';
  return 'Email';
}

// Neutral on purpose: the channel is a label, not a state, so it doesn't get a status colour.
export function ChannelBadge({ provider }: { provider: string }) {
  return <Badge>{channelName(provider)}</Badge>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
        <AlertCircle className="size-3 shrink-0" aria-hidden />
        Not delivered
      </span>
    );
  }
  const label = status === 'delivered' ? 'Delivered' : status === 'sent' ? 'Sent' : 'Sending';
  const Icon = status === 'delivered' || status === 'sent' ? CheckCheck : Send;
  return (
    <span title={label}>
      <Icon className="size-3 shrink-0 text-ink-subtle" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
