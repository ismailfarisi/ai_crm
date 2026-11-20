'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import {
  CHANNEL_HANDOVER_REASON_LABELS,
  PERMISSIONS,
  type ChannelThreadDto,
} from '@saas/shared';
import { api, queryKeys, type ChannelMessageDto } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';

const INTENT_LABELS: Record<string, string> = {
  GENERAL_QUESTION: 'General question',
  QUOTATION_REQUEST: 'Wants a quote',
  ORDER_STATUS: 'Order status',
  PRICING_QUESTION: 'Pricing question',
  COMPLAINT: 'Complaint',
  HUMAN_REQUEST: 'Asked for a person',
  SUPPORT_REQUEST: 'Support request',
  SCHEDULING: 'Scheduling',
  SPAM: 'Spam',
  OTHER: 'Other',
};

/** NEEDS_HUMAN first: when a contact talks on two channels, the one waiting on a person wins. */
const URGENCY: Record<ChannelThreadDto['state'], number> = {
  NEEDS_HUMAN: 0,
  HUMAN: 1,
  AI: 2,
  RESOLVED: 3,
};

/** The handover state to show for a contact, across the channels they have written on. */
export function pickHandover(
  threads: ChannelThreadDto[] | undefined,
  contactId: string | null,
): ChannelThreadDto | undefined {
  if (!threads || !contactId) return undefined;
  return threads
    .filter((thread) => thread.contactId === contactId)
    .sort((a, b) => URGENCY[a.state] - URGENCY[b.state])[0];
}

export function HandoverBadge({ handover }: { handover?: ChannelThreadDto }) {
  if (!handover) return null;
  switch (handover.state) {
    case 'NEEDS_HUMAN':
      return (
        <Badge tone="warning" className="shrink-0">
          Needs a person
        </Badge>
      );
    case 'HUMAN':
      return (
        <Badge tone="info" className="shrink-0">
          {handover.assigneeName ?? 'Staff'}
        </Badge>
      );
    case 'RESOLVED':
      return <Badge className="shrink-0">Resolved</Badge>;
    default:
      return (
        <Badge tone="brand" className="shrink-0">
          AI
        </Badge>
      );
  }
}

function describeState(handover: ChannelThreadDto): string {
  switch (handover.state) {
    case 'NEEDS_HUMAN':
      return 'The AI has stopped and is waiting for a person to pick this up.';
    case 'HUMAN':
      return `${handover.assigneeName ?? 'A member of staff'} is answering. The AI stays quiet.`;
    case 'RESOLVED':
      return 'Resolved. The next message from this customer goes to the AI.';
    default:
      return 'The AI is answering this conversation.';
  }
}

interface HandoverBarProps {
  handover?: ChannelThreadDto;
  /** The conversation's messages, any order. */
  messages: ChannelMessageDto[];
  /** Put the AI's suggested reply into the composer. */
  onUseReply: (reply: string) => void;
}

/**
 * Who is answering, why the AI stopped, what it understood, and the buttons
 * to take the conversation or give it back.
 */
export function HandoverBar({ handover, messages, onUseReply }: HandoverBarProps) {
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: (action: 'take' | 'return' | 'resolve') => {
      const id = handover!.id;
      if (action === 'take') return api.channels.takeOverThread(id);
      if (action === 'return') return api.channels.returnThreadToAi(id);
      return api.channels.resolveThread(id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.channelThreads }),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : "Couldn't update the conversation"),
  });

  // What the AI read into the customer's latest message.
  const read = [...messages]
    .filter((m) => m.direction === 'INBOUND' && (m.aiIntent || m.aiSummary))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (!handover && !read) return null;

  const summary = handover?.handoverSummary || read?.aiSummary;
  const waiting = handover?.state === 'NEEDS_HUMAN';

  return (
    <div
      className={`border-b px-4 py-3 text-sm ${
        waiting ? 'border-warning/30 bg-warning-soft/60' : 'border-border bg-surface-muted/40'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {handover && (
            <p className="flex items-center gap-1.5 font-medium text-ink">
              {handover.state === 'AI' ? (
                <Bot className="size-4 shrink-0" aria-hidden />
              ) : (
                <UserRound className="size-4 shrink-0" aria-hidden />
              )}
              {describeState(handover)}
            </p>
          )}
          {handover?.handoverReason && handover.state !== 'AI' && (
            <p className="text-xs text-ink-muted">
              Why: {CHANNEL_HANDOVER_REASON_LABELS[handover.handoverReason]}
            </p>
          )}
          {(read?.aiIntent || summary) && (
            <p className="text-xs text-ink-muted">
              <span className="font-medium text-ink">AI read: </span>
              {read?.aiIntent ? (INTENT_LABELS[read.aiIntent] ?? read.aiIntent) : null}
              {read?.aiIntent && summary ? '. ' : null}
              {summary}
            </p>
          )}
          {read?.aiSuggestedReply && handover?.state !== 'AI' && (
            <p className="text-xs text-ink-muted">
              <span className="font-medium text-ink">Suggested reply: </span>
              {read.aiSuggestedReply}{' '}
              <button
                type="button"
                className="font-medium text-brand underline-offset-2 hover:underline"
                onClick={() => onUseReply(read.aiSuggestedReply!)}
              >
                Use this reply
              </button>
            </p>
          )}
        </div>

        {handover && (
          <Can permission={PERMISSIONS.CHANNEL_SEND}>
            <div className="flex shrink-0 items-center gap-2">
              {(handover.state === 'AI' || handover.state === 'NEEDS_HUMAN') && (
                <Button size="sm" loading={act.isPending} onClick={() => act.mutate('take')}>
                  Take over
                </Button>
              )}
              {(handover.state === 'HUMAN' || handover.state === 'NEEDS_HUMAN') && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={act.isPending}
                  onClick={() => act.mutate('return')}
                >
                  Return to AI
                </Button>
              )}
              {handover.state === 'HUMAN' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={act.isPending}
                  onClick={() => act.mutate('resolve')}
                >
                  Resolve
                </Button>
              )}
            </div>
          </Can>
        )}
      </div>
    </div>
  );
}
