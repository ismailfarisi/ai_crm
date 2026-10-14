'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { History, Maximize2, MessageSquarePlus, Sparkles, X } from 'lucide-react';
import { PERMISSIONS } from '@saas/shared';
import { api, queryKeys } from '@/lib/api/endpoints';
import { useSession } from '@/lib/session-context';
import { useCreateAssistantConversation } from '@/hooks/use-assistant';
import { useAssistant } from './assistant-provider';
import { AssistantThread } from './assistant-thread';
import { ConversationList } from './conversation-list';

export function AssistantPanel() {
  const { open, setOpen, conversationId, setConversationId, pageContext } = useAssistant();
  const [showHistory, setShowHistory] = useState(false);
  const create = useCreateAssistantConversation();

  if (!open) return null;

  const startNew = async () => {
    const conversation = await create.mutateAsync(pageContext ? { context: pageContext } : {});
    setConversationId(conversation.id);
    setShowHistory(false);
  };

  const iconButton = 'rounded-md p-1.5 hover:bg-surface-muted';

  return (
    <aside
      role="dialog"
      aria-label="Assistant"
      className="fixed inset-0 z-50 flex flex-col border-l border-border bg-surface shadow-xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[420px] print:hidden"
    >
      <header className="flex h-14 items-center gap-1 border-b border-border px-3">
        <Sparkles className="size-4 text-brand" aria-hidden="true" />
        <span className="flex-1 truncate text-sm font-semibold">Assistant</span>
        <button
          type="button"
          aria-label="Conversation history"
          aria-pressed={showHistory}
          onClick={() => setShowHistory((v) => !v)}
          className={iconButton}
        >
          <History className="size-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label="New chat" onClick={startNew} className={iconButton}>
          <MessageSquarePlus className="size-4" aria-hidden="true" />
        </button>
        <Link
          aria-label="Open full page"
          href={conversationId ? `/assistant?c=${conversationId}` : '/assistant'}
          onClick={() => setOpen(false)}
          className={iconButton}
        >
          <Maximize2 className="size-4" aria-hidden="true" />
        </Link>
        <button type="button" aria-label="Close assistant" onClick={() => setOpen(false)} className={iconButton}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>
      {showHistory ? (
        <ConversationList
          activeId={conversationId}
          onSelect={(id) => {
            setConversationId(id);
            setShowHistory(false);
          }}
          onNew={startNew}
        />
      ) : conversationId ? (
        <AssistantThread conversationId={conversationId} variant="panel" />
      ) : (
        <EmptyState onStart={startNew} />
      )}
    </aside>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  const { check } = useSession();
  // Listing configs needs ai:manage; everyone else just gets the normal state.
  const { data: configs } = useQuery({
    queryKey: queryKeys.aiConfigs,
    queryFn: api.ai.listConfigs,
    enabled: check({ permission: PERMISSIONS.AI_MANAGE }),
    retry: false,
  });
  const needsProvider = configs !== undefined && !configs.some((c) => c.isEnabled && c.status === 'configured');
  if (needsProvider) {
    return (
      <div className="p-6 text-sm text-ink-muted">
        The assistant needs an AI provider. An admin can set one up in{' '}
        <Link href="/settings/ai" className="text-brand underline">
          Settings → AI
        </Link>
        .
      </div>
    );
  }
  return (
    <div className="grid flex-1 place-items-center p-6">
      <button type="button" onClick={onStart} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-ink">
        Start a chat
      </button>
    </div>
  );
}
