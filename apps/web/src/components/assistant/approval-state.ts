import type { AssistantMessageDto, AssistantPendingAction, AssistantTurnDto } from '@saas/shared';
import type { ApprovalResolution } from './approval-card';

/**
 * An approval card is live only while its exact tool call is the one the turn
 * is waiting on. Two gated calls in one turn share a turn id, so comparing the
 * turn alone would re-arm an earlier card and let it approve the later call.
 */
export function isApprovalLive(
  activeTurn: Pick<AssistantTurnDto, 'id' | 'status' | 'pendingAction'> | null,
  message: Pick<AssistantMessageDto, 'turnId' | 'payload'>,
): boolean {
  const toolId = (message.payload as Partial<AssistantPendingAction> | null)?.tool?.id;
  return (
    activeTurn?.status === 'AWAITING_APPROVAL' &&
    activeTurn.id === message.turnId &&
    Boolean(toolId) &&
    activeTurn.pendingAction?.tool.id === toolId
  );
}

/** How a no-longer-live approval card ended, read from the rows after it. */
export function resolutionFor(
  message: AssistantMessageDto,
  messages: AssistantMessageDto[],
  live: boolean,
): ApprovalResolution | undefined {
  if (live) return undefined;
  const toolName = (message.payload as { tool?: { name?: string } } | null)?.tool?.name ?? message.toolName;
  const later = messages.filter((m) => m.turnId === message.turnId && m.seq > message.seq);
  if (
    toolName &&
    later.some(
      (m) =>
        (m.role === 'step' && m.toolName === toolName && m.content === `Approved ${toolName}`) ||
        (m.role === 'tool_result' && m.toolName === toolName),
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
