'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { AlertTriangle, ChevronRight, Loader2, Wrench } from 'lucide-react';
import type { AssistantMessageDto, AssistantPendingAction, SendAssistantMessagePayload } from '@saas/shared';
import type { ApprovalResolution } from './approval-card';
import { cn } from '@/lib/utils';
import {
  useAssistantConversation,
  useCancelAssistantTurn,
  useDecideAssistantTurn,
  useSendAssistantMessage,
} from '@/hooks/use-assistant';
import { useAssistantStream } from '@/hooks/use-assistant-stream';
import { ApprovalCard } from './approval-card';
import { AssistantComposer } from './assistant-composer';
import { useAssistant } from './assistant-provider';

function StepRow({ message }: { message: AssistantMessageDto }) {
  const isError = message.role === 'tool_result' && typeof message.payload?.error === 'string';
  return (
    <details className={cn('rounded-lg px-2 py-1 text-xs', isError ? 'text-red-600' : 'text-ink-muted')}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        {isError ? (
          <AlertTriangle className="size-3" aria-hidden="true" />
        ) : message.role === 'tool_call' ? (
          <Wrench className="size-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3" aria-hidden="true" />
        )}
        <span className="truncate">{message.content.split('\n')[0]}</span>
      </summary>
      <pre className="mt-1 whitespace-pre-wrap break-words font-sans">{message.content}</pre>
    </details>
  );
}

function resolutionFor(
  message: AssistantMessageDto,
  messages: AssistantMessageDto[],
  live: boolean,
): ApprovalResolution | undefined {
  if (live) return undefined;
  const toolName = (message.payload as { tool?: { name?: string } } | null)?.tool?.name ?? message.toolName;
  const later = messages.filter((m) => m.turnId === message.turnId && m.seq > message.seq);
  if (
    later.some(
      (m) =>
        (m.role === 'step' && m.content.startsWith('Approved')) ||
        (m.role === 'tool_result' && toolName && m.toolName === toolName),
    )
  ) {
    return 'approved';
  }
  for (const m of later) {
    if (m.role !== 'status') continue;
    const status = (m.payload?.turn as { status?: string } | undefined)?.status;
    if (status === 'REJECTED') return 'rejected';
    if (status === 'TIMED_OUT') return 'expired';
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') return 'closed';
  }
  return undefined;
}

export function AssistantThread({ conversationId, variant }: { conversationId: string; variant: 'panel' | 'page' }) {
  const { pageContext } = useAssistant();
  const { data, isLoading } = useAssistantConversation(conversationId);
  const { connected } = useAssistantStream(conversationId, Boolean(data));
  const send = useSendAssistantMessage(conversationId);
  const decide = useDecideAssistantTurn(conversationId);
  const cancel = useCancelAssistantTurn(conversationId);
  const bottom = useRef<HTMLDivElement>(null);
  // The stream delivers the user's message; show the sent text meanwhile so there is no blank gap.
  const [pending, setPending] = useState<string | null>(null);

  const messages = data?.messages ?? [];
  const activeTurn = data?.activeTurn ?? null;
  const busy = Boolean(activeTurn) || send.isPending;
  const pendingVisible = pending !== null && !messages.some((m) => m.role === 'user' && m.content === pending);

  useEffect(() => bottom.current?.scrollIntoView?.({ block: 'end' }), [messages.length, pendingVisible]);

  if (isLoading) {
    return (
      <div className="grid flex-1 place-items-center" role="status" aria-label="Loading conversation">
        <Loader2 className="size-5 animate-spin text-ink-subtle" aria-hidden="true" />
      </div>
    );
  }

  const sendMessage = (body: SendAssistantMessagePayload) => {
    setPending(body.content);
    send.mutate(body, { onError: () => setPending(null) });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn('flex-1 space-y-2 overflow-y-auto p-3', variant === 'page' && 'px-6')}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
      >
        {messages.length === 0 && !pendingVisible && (
          <p className="pt-8 text-center text-sm text-ink-muted">
            Ask about your customers, quotes, orders or channel threads. Nothing changes without your approval.
          </p>
        )}
        {messages.map((message) => {
          if (message.role === 'status') {
            const status = (message.payload?.turn as { status?: string } | undefined)?.status;
            if (status === 'FAILED' || status === 'CANCELLED') {
              const error = (message.payload?.turn as { error?: string } | undefined)?.error;
              return (
                <p key={message.seq} className="text-center text-xs text-ink-subtle">
                  {status === 'CANCELLED' ? 'Stopped.' : `Couldn't finish: ${error ?? 'unknown error'}`}
                </p>
              );
            }
            return null;
          }
          if (message.role === 'user') {
            return (
              <div key={message.seq} className="ml-8 whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand/10 px-3 py-2 text-sm">
                {message.content}
              </div>
            );
          }
          if (message.role === 'assistant') {
            return (
              <div key={message.seq} className="prose prose-sm mr-8 max-w-none rounded-2xl rounded-bl-sm bg-surface-muted px-3 py-2 text-sm">
                <ReactMarkdown>{message.content}</ReactMarkdown>
              </div>
            );
          }
          if (message.role === 'approval') {
            const isLive = activeTurn?.status === 'AWAITING_APPROVAL' && activeTurn.id === message.turnId;
            const resolution = resolutionFor(message, messages, isLive);
            const original = messages.find((m) => m.role === 'user' && m.turnId === message.turnId);
            const savedContext = original?.payload?.context as SendAssistantMessagePayload['context'] | undefined;
            return (
              <ApprovalCard
                key={message.seq}
                pendingAction={message.payload as unknown as AssistantPendingAction}
                disabled={!isLive || decide.isPending}
                resolution={resolution}
                onRetry={
                  original && !busy
                    ? () =>
                        sendMessage(
                          savedContext ? { content: original.content, context: savedContext } : { content: original.content },
                        )
                    : undefined
                }
                onDecide={(approved, note) =>
                  activeTurn && decide.mutate({ turnId: activeTurn.id, body: note ? { approved, note } : { approved } })
                }
              />
            );
          }
          return <StepRow key={message.seq} message={message} />;
        })}
        {pendingVisible && (
          <div className="ml-8 whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand/10 px-3 py-2 text-sm opacity-70">
            {pending}
          </div>
        )}
        {activeTurn?.status === 'RUNNING' && (
          <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" /> {connected ? 'Working…' : 'Reconnecting…'}
          </p>
        )}
        <div ref={bottom} />
      </div>
      <AssistantComposer
        busy={busy}
        pageContext={pageContext}
        onSend={(content, context) => sendMessage(context ? { content, context } : { content })}
        onStop={() => activeTurn && cancel.mutate(activeTurn.id)}
      />
    </div>
  );
}
