'use client';

import { MessageSquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAssistantConversations } from '@/hooks/use-assistant';

export function ConversationList({
  activeId,
  onSelect,
  onNew,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { data = [] } = useAssistantConversations();
  return (
    <div className="flex flex-col gap-1 p-2">
      <button
        type="button"
        onClick={onNew}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium hover:bg-surface-muted"
      >
        <MessageSquarePlus className="size-4" aria-hidden="true" /> New chat
      </button>
      {data.map((c) => (
        <button
          type="button"
          key={c.id}
          onClick={() => onSelect(c.id)}
          aria-current={c.id === activeId ? 'true' : undefined}
          className={cn(
            'truncate rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted',
            c.id === activeId && 'bg-surface-muted font-semibold',
          )}
        >
          {c.title}
        </button>
      ))}
    </div>
  );
}
