import { describe, expect, it } from 'vitest';
import type { AssistantMessageDto, AssistantTurnDto } from '@saas/shared';
import { isApprovalLive, resolutionFor } from './approval-state';

const action = (id: string, name = 'channel_message.send') => ({ tool: { id, name, args: {} }, preview: { summary: id } });

const approvalRow = (seq: number, toolId: string, name?: string): AssistantMessageDto => ({
  id: `m${seq}`,
  conversationId: 'conv-1',
  turnId: 'turn-1',
  seq,
  role: 'approval',
  content: toolId,
  toolName: name ?? 'channel_message.send',
  payload: action(toolId, name) as unknown as Record<string, unknown>,
  createdAt: '2026-10-15T00:00:00Z',
});

const row = (seq: number, role: AssistantMessageDto['role'], content: string, toolName: string | null = null, payload: Record<string, unknown> | null = null): AssistantMessageDto => ({
  id: `m${seq}`,
  conversationId: 'conv-1',
  turnId: 'turn-1',
  seq,
  role,
  content,
  toolName,
  payload,
  createdAt: '2026-10-15T00:00:00Z',
});

const turn = (status: AssistantTurnDto['status'], pendingToolId: string | null): Pick<AssistantTurnDto, 'id' | 'status' | 'pendingAction'> => ({
  id: 'turn-1',
  status,
  pendingAction: pendingToolId ? action(pendingToolId) : null,
});

describe('isApprovalLive', () => {
  it('is live only for the card whose tool call is pending', () => {
    const a = approvalRow(1, 'A', 'quote.approve');
    const b = approvalRow(5, 'B');
    const active = turn('AWAITING_APPROVAL', 'B');
    expect(isApprovalLive(active, b)).toBe(true);
    // A belongs to the same turn but is no longer what the turn waits on.
    expect(isApprovalLive(active, a)).toBe(false);
  });

  it('is not live while the turn is running or for another turn', () => {
    const b = approvalRow(5, 'B');
    expect(isApprovalLive(turn('RUNNING', 'B'), b)).toBe(false);
    expect(isApprovalLive({ ...turn('AWAITING_APPROVAL', 'B'), id: 'turn-2' }, b)).toBe(false);
    expect(isApprovalLive(null, b)).toBe(false);
  });
});

describe('resolutionFor', () => {
  it('marks a card approved only by its own tool, not by a later approval of another tool', () => {
    const a = approvalRow(1, 'A', 'quote.approve');
    const b = approvalRow(4, 'B');
    const messages = [
      a,
      row(2, 'step', 'Approved quote.approve', 'quote.approve'),
      row(3, 'tool_result', 'Approved Q-1', 'quote.approve'),
      b,
      row(5, 'step', 'Approved channel_message.send', 'channel_message.send'),
    ];
    expect(resolutionFor(a, messages, false)).toBe('approved');
    expect(resolutionFor(b, messages, false)).toBe('approved');
    // B rejected after A was approved: B shows rejected, A still approved.
    const rejected = [a, messages[1], messages[2], b, row(5, 'status', '', null, { turn: { status: 'REJECTED' } })];
    expect(resolutionFor(b, rejected, false)).toBe('rejected');
    expect(resolutionFor(a, rejected, false)).toBe('approved');
  });

  it('returns nothing while live', () => {
    const b = approvalRow(4, 'B');
    expect(resolutionFor(b, [b], true)).toBeUndefined();
  });
});
