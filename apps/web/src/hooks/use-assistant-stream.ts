'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantConversationDetailDto, AssistantMessageDto, AssistantTurnDto } from '@saas/shared';
import { ACTIVE_ASSISTANT_TURN_STATUSES } from '@saas/shared';
import { queryKeys } from '@/lib/api/endpoints';
import { openEventStream } from '@/lib/api/stream';

export function mergeMessages(
  detail: AssistantConversationDetailDto,
  incoming: AssistantMessageDto[],
): AssistantConversationDetailDto {
  const seen = new Set(detail.messages.map((m) => m.seq));
  const fresh = incoming.filter((m) => !seen.has(m.seq));
  if (fresh.length === 0) return detail;
  const messages = [...detail.messages, ...fresh].sort((a, b) => a.seq - b.seq);
  let activeTurn = detail.activeTurn;
  for (const row of fresh.sort((a, b) => a.seq - b.seq)) {
    const turn = row.role === 'status' ? (row.payload?.turn as AssistantTurnDto | undefined) : undefined;
    if (turn) {
      activeTurn = (ACTIVE_ASSISTANT_TURN_STATUSES as readonly string[]).includes(turn.status) ? turn : null;
    }
  }
  return { ...detail, messages, activeTurn };
}

/** Live transcript for one conversation. Reconnects with backoff and resumes from the last seq. */
export function useAssistantStream(conversationId: string | null): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!conversationId) return;
    const key = queryKeys.assistantConversation(conversationId);
    const controller = new AbortController();
    let attempt = 0;

    const lastSeq = () => {
      const detail = queryClient.getQueryData<AssistantConversationDetailDto>(key);
      return detail?.messages.at(-1)?.seq;
    };

    const loop = async () => {
      while (!controller.signal.aborted) {
        try {
          const last = lastSeq();
          setConnected(true);
          await openEventStream(`/assistant/conversations/${conversationId}/stream`, {
            signal: controller.signal,
            ...(last !== undefined ? { lastEventId: String(last) } : {}),
            onEvent: (event) => {
              attempt = 0;
              if (event.event !== 'message') return;
              const row = JSON.parse(event.data) as AssistantMessageDto;
              queryClient.setQueryData<AssistantConversationDetailDto>(key, (detail) =>
                detail ? mergeMessages(detail, [row]) : detail,
              );
            },
          });
        } catch {
          if (controller.signal.aborted) return;
        }
        setConnected(false);
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 500 * 2 ** attempt)));
      }
    };
    void loop();
    return () => controller.abort();
  }, [conversationId, queryClient]);

  return { connected };
}
