'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { useContacts } from '@/hooks/use-contacts';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useCan } from '@/lib/session-context';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { InboxThreadList, type ProviderFilter, type ThreadGroup } from './inbox-thread-list';
import { InboxChatPanel } from './inbox-chat-panel';

export function InboxWorkspace() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ProviderFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  // Below `md` there is room for one pane: the list, or the open thread.
  const isDesktop = useMediaQuery('(min-width: 48rem)');
  const canManageChannels = useCan({ permission: PERMISSIONS.CHANNEL_MANAGE });

  // Fetch messages history
  const {
    data: messages,
    isPending: isMessagesLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.channelMessages(),
    queryFn: () => api.channels.messages({ limit: 100 }),
    refetchInterval: 10000, // Poll every 10 seconds for new messages
  });

  // Fetch contacts for resolving names/details if message relation missing
  const { data: contactsData } = useContacts({ limit: 100 });
  const contactsMap = useMemo(() => {
    const map = new Map<string, any>();
    if (contactsData?.items) {
      for (const c of contactsData.items) {
        map.set(c.id, c);
      }
    }
    return map;
  }, [contactsData]);

  // Group messages into Threads
  const threads = useMemo(() => {
    if (!messages) return [];

    const threadMap = new Map<string, ThreadGroup>();

    for (const msg of messages) {
      // Group key: contactId or recipient/sender
      const contactObj = msg.contact || (msg.contactId ? contactsMap.get(msg.contactId) : null);
      const threadKey = msg.contactId || (msg.direction === 'INBOUND' ? msg.sender : msg.recipient);

      let existing = threadMap.get(threadKey);
      if (!existing) {
        let name = 'Unknown Contact';
        if (msg.staffUser) {
          name = msg.staffUser.name;
        } else if (contactObj) {
          name = contactObj.fullName;
        } else if (msg.direction === 'INBOUND') {
          name = msg.sender;
        } else {
          name = msg.recipient;
        }

        existing = {
          id: threadKey,
          contactId: msg.contactId,
          name,
          recipientOrSender: msg.direction === 'INBOUND' ? msg.sender : msg.recipient,
          contact: contactObj,
          staffUser: msg.staffUser || null,
          lastMessage: msg,
          messages: [],
          providers: new Set<string>(),
        };
        threadMap.set(threadKey, existing);
      }

      existing.messages.push(msg);
      existing.providers.add(msg.provider);

      // Update staffUser if found on any message in thread
      if (!existing.staffUser && msg.staffUser) {
        existing.staffUser = msg.staffUser;
        existing.name = msg.staffUser.name;
      }
      
      // Update contact if found on newer message
      if (!existing.contact && contactObj) {
        existing.contact = contactObj;
        if (!existing.staffUser) {
          existing.name = contactObj.fullName;
        }
      }
    }

    const result = Array.from(threadMap.values());

    // Sort threads by last message time (descending)
    result.sort((a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime());

    return result;
  }, [messages, contactsMap]);

  // The thread the user opened, if it is still in the list.
  const openedThread = useMemo(
    () => (selectedThreadId ? threads.find((t) => t.id === selectedThreadId) ?? null : null),
    [threads, selectedThreadId],
  );
  // On a desk the newest thread is open until another is picked; on a phone
  // nothing is open until the user taps one, so the list comes first.
  const selectedThread = isDesktop ? openedThread ?? threads[0] ?? null : openedThread;

  const threadList = (
    <InboxThreadList
      threads={threads}
      selectedThreadId={selectedThread?.id ?? null}
      onSelectThread={(t) => setSelectedThreadId(t.id)}
      activeFilter={activeFilter}
      onFilterChange={setActiveFilter}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
    />
  );

  const chatPanel = (
    <InboxChatPanel
      thread={selectedThread}
      onMessageSent={() => refetch()}
      onBack={isDesktop ? undefined : () => setSelectedThreadId(null)}
    />
  );

  return (
    // dvh, not vh: on a phone the browser bar would otherwise cover the composer.
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[24rem] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xs">
      {isMessagesLoading ? (
        <div className="flex h-full items-center justify-center p-8">
          <div className="space-y-4 text-center">
            <Skeleton className="mx-auto size-12 rounded-full" />
            <Skeleton className="mx-auto h-4 w-48" />
            <Skeleton className="mx-auto h-3 w-32" />
          </div>
        </div>
      ) : isError ? (
        <EmptyState
          icon={<MessageSquare className="size-8" />}
          title="Couldn't load your messages"
          description="The inbox didn't answer. Check your connection, then try again."
          action={
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          }
        />
      ) : threads.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-8" />}
          title="No conversations yet"
          description={
            canManageChannels
              ? 'WhatsApp, Telegram and email messages land here once a channel is connected.'
              : 'WhatsApp, Telegram and email messages land here once an admin connects a channel in Settings › Channels.'
          }
          action={
            canManageChannels ? (
              <Link
                href="/settings/channels"
                className="font-medium text-ink underline underline-offset-2 hover:no-underline"
              >
                Connect a channel in Settings › Channels
              </Link>
            ) : undefined
          }
        />
      ) : isDesktop ? (
        <div className="grid h-full min-h-0 grid-cols-12 divide-x divide-border">
          <div className="col-span-4 h-full min-h-0 overflow-hidden">{threadList}</div>
          <div className="col-span-8 h-full min-h-0 overflow-hidden">{chatPanel}</div>
        </div>
      ) : (
        <div className="h-full min-h-0 overflow-hidden">{selectedThread ? chatPanel : threadList}</div>
      )}
    </div>
  );
}
