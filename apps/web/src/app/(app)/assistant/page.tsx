'use client';

import { use, useEffect } from 'react';
import { PERMISSIONS } from '@saas/shared';
import { Can } from '@/components/auth/can';
import { useCreateAssistantConversation } from '@/hooks/use-assistant';
import { useAssistant } from '@/components/assistant/assistant-provider';
import { AssistantThread } from '@/components/assistant/assistant-thread';
import { ConversationList } from '@/components/assistant/conversation-list';

export default function AssistantPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = use(searchParams);
  const { conversationId, setConversationId } = useAssistant();
  const create = useCreateAssistantConversation();

  useEffect(() => {
    if (c) setConversationId(c);
  }, [c, setConversationId]);

  return (
    <Can
      permission={PERMISSIONS.ASSISTANT_USE}
      fallback={<p className="text-sm text-ink-muted">You don&apos;t have access to the assistant.</p>}
    >
      <div className="flex h-[calc(100vh-9rem)] overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-border">
          <ConversationList
            activeId={conversationId}
            onSelect={setConversationId}
            onNew={async () => setConversationId((await create.mutateAsync({})).id)}
          />
        </div>
        {conversationId ? (
          <AssistantThread conversationId={conversationId} variant="page" />
        ) : (
          <div className="grid flex-1 place-items-center text-sm text-ink-muted">Pick a chat or start a new one.</div>
        )}
      </div>
    </Can>
  );
}
