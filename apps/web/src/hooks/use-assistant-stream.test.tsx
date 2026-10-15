import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/lib/api/endpoints';
import { mergeMessages, useAssistantStream } from './use-assistant-stream';

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

describe('useAssistantStream', () => {
  const row = (seq: number) => ({ id: `m${seq}`, seq, role: 'step', content: '', conversationId: 'c', turnId: 't', toolName: null, payload: null, createdAt: '' });
  const frame = (seq: number) => `id: ${seq}\nevent: message\ndata: ${JSON.stringify(row(seq))}\n\n`;
  const stream = (...frames: string[]) => {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (const f of frames) c.enqueue(encoder.encode(f));
          c.close();
        },
      }),
      { status: 200 },
    );
  };
  const setup = (seed = true, enabled = true) => {
    const queryClient = new QueryClient();
    const key = queryKeys.assistantConversation('c');
    if (seed) queryClient.setQueryData(key, { messages: [row(1), row(2)], activeTurn: null });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { queryClient, key, wrapper, enabled };
  };
  const lastEventIdOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) =>
    ((fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>)['Last-Event-ID'];

  afterEach(() => vi.unstubAllGlobals());

  it('resumes from the last seq on reconnect and merges replays exactly once', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => stream(frame(3)))
      .mockImplementationOnce(async () => stream(frame(3), frame(4)))
      .mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const { queryClient, key, wrapper } = setup();

    const { unmount } = renderHook(() => useAssistantStream('c'), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(lastEventIdOf(fetchMock, 0)).toBe('2');
    expect(lastEventIdOf(fetchMock, 1)).toBe('3');
    await waitFor(() => {
      const d = queryClient.getQueryData<{ messages: { seq: number }[] }>(key)!;
      expect(d.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    });
    unmount();
  }, 8000);

  it('does not connect until the detail is cached or while disabled', async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const empty = setup(false);
    renderHook(() => useAssistantStream('c'), { wrapper: empty.wrapper });
    const off = setup(true);
    renderHook(() => useAssistantStream('c', false), { wrapper: off.wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops retrying on 403', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{"message":"no"}', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = setup();
    const { result } = renderHook(() => useAssistantStream('c'), { wrapper });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 1300));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.connected).toBe(false);
  }, 6000);
});
