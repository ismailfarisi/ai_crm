'use client';

import { useState } from 'react';
import { Send, Square, X } from 'lucide-react';
import type { AssistantPageContext } from '@saas/shared';
import { Button } from '@/components/ui/button';

interface ComposerProps {
  busy: boolean;
  pageContext: AssistantPageContext | null;
  onSend: (content: string, context: AssistantPageContext | null) => void;
  onStop: () => void;
}

export function AssistantComposer({ busy, pageContext, onSend, onStop }: ComposerProps) {
  const [value, setValue] = useState('');
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const context = pageContext && dismissedFor !== `${pageContext.entity}:${pageContext.id}` ? pageContext : null;

  const submit = () => {
    const content = value.trim();
    if (!content || busy) return;
    onSend(content, context);
    setValue('');
  };

  return (
    <div className="border-t border-border p-3">
      {context && (
        <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-ink-muted">
          Viewing: {context.label ?? `${context.entity} ${context.id.slice(0, 8)}`}
          <button
            type="button"
            aria-label="Don't include page context"
            onClick={() => setDismissedFor(`${context.entity}:${context.id}`)}
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Message the assistant"
          className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-border bg-surface p-2 text-sm"
          placeholder={busy ? 'The assistant is working…' : 'Ask about a customer, a quote, a thread…'}
          value={value}
          maxLength={4000}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy ? (
          <Button size="icon" variant="secondary" onClick={onStop} aria-label="Stop">
            <Square className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button size="icon" onClick={submit} aria-label="Send" disabled={!value.trim()}>
            <Send className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
