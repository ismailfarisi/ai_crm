import { describe, expect, it } from 'vitest';
import { mergeMessages } from './use-assistant-stream';

describe('mergeMessages', () => {
  const m = (seq: number, role = 'step') => ({ id: `m${seq}`, seq, role, content: '', conversationId: 'c', turnId: 't', toolName: null, payload: null, createdAt: '' }) as any;

  it('appends new rows in seq order and ignores duplicates (Review Focus #1/#3)', () => {
    const detail = { messages: [m(1), m(2)], activeTurn: null } as any;
    const next = mergeMessages(detail, [m(2), m(4), m(3)]);
    expect(next.messages.map((x: any) => x.seq)).toEqual([1, 2, 3, 4]);
  });

  it('applies the turn carried by a status row; terminal status clears activeTurn', () => {
    const turn = { id: 't', status: 'AWAITING_APPROVAL' };
    const detail = { messages: [], activeTurn: null } as any;
    const awaiting = mergeMessages(detail, [{ ...m(1, 'status'), payload: { turn } }]);
    expect(awaiting.activeTurn).toEqual(turn);
    const done = mergeMessages(awaiting, [{ ...m(2, 'status'), payload: { turn: { ...turn, status: 'COMPLETED' } } }]);
    expect(done.activeTurn).toBeNull();
  });
});
