'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { api, queryKeys, type ChannelMessageDto } from '@/lib/api/endpoints';
import { useContacts } from '@/hooks/use-contacts';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { InboxThreadList, type ProviderFilter, type ThreadGroup } from './inbox-thread-list';
import { InboxChatPanel } from './inbox-chat-panel';

export function InboxWorkspace() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<ProviderFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch messages history
  const {
    data: messages,
    isPending: isMessagesLoading,
    isError,
    error,
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
        if (contactObj) {
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
          lastMessage: msg,
          messages: [],
          providers: new Set<string>(),
        };
        threadMap.set(threadKey, existing);
      }

      existing.messages.push(msg);
      existing.providers.add(msg.provider);
      
      // Update contact if found on newer message
      if (!existing.contact && contactObj) {
        existing.contact = contactObj;
        existing.name = contactObj.fullName;
      }
    }

    const result = Array.from(threadMap.values());

    // Sort threads by last message time (descending)
    result.sort((a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime());

    return result;
  }, [messages, contactsMap]);

  // Active selected thread object
  const selectedThread = useMemo(() => {
    if (!selectedThreadId) return threads[0] || null;
    return threads.find((t) => t.id === selectedThreadId) || threads[0] || null;
  }, [threads, selectedThreadId]);

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col rounded-xl border border-border bg-surface shadow-xs overflow-hidden">
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
          title="Couldn't load messages"
          description={error instanceof Error ? error.message : 'Please check your connection and try again.'}
          action={
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="size-4" />
              Try again
            </Button>
          }
        />
      ) : (
        <div className="grid h-full grid-cols-1 md:grid-cols-12 divide-x divide-border">
          {/* Thread list sidebar */}
          <div className="md:col-span-4 lg:col-span-4 h-full overflow-hidden">
            <InboxThreadList
              threads={threads}
              selectedThreadId={selectedThread?.id || null}
              onSelectThread={(t) => setSelectedThreadId(t.id)}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
            />
          </div>

          {/* Chat panel */}
          <div className="md:col-span-8 lg:col-span-8 h-full overflow-hidden">
            <InboxChatPanel
              thread={selectedThread}
              onMessageSent={() => refetch()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
