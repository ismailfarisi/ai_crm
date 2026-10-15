import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({ silentRefresh: vi.fn() }));

import { silentRefresh } from './client';
import { openEventStream } from './stream';

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('openEventStream', () => {
  it('sends Last-Event-ID, emits one event per complete frame and resolves at end of stream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(['id: 3\nevent: message\ndata: {"a"', ':1}\n\n: ping\n\nid: 4\nevent: message\ndata: b\n\n']));
    vi.stubGlobal('fetch', fetchMock);
    const events: unknown[] = [];

    await openEventStream('/assistant/conversations/c/stream', {
      lastEventId: '2',
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Last-Event-ID']).toBe('2');
    expect(init.credentials).toBe('include');
    expect(events).toEqual([
      { id: '3', event: 'message', data: '{"a":1}' },
      { id: '4', event: 'message', data: 'b' },
    ]);
  });

  it('omits Last-Event-ID when none is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await openEventStream('/x', { signal: new AbortController().signal, onEvent: () => {} });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty('Last-Event-ID');
  });

  it('refreshes the session once on 401 and retries', async () => {
    vi.mocked(silentRefresh).mockResolvedValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(sseResponse(['id: 1\ndata: x\n\n']));
    vi.stubGlobal('fetch', fetchMock);
    const events: unknown[] = [];

    await openEventStream('/x', { signal: new AbortController().signal, onEvent: (e) => events.push(e) });

    expect(silentRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
  });

  it('rejects with an ApiError when the retry is still 401', async () => {
    vi.mocked(silentRefresh).mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"message":"no"}', { status: 401 })));
    await expect(
      openEventStream('/x', { signal: new AbortController().signal, onEvent: () => {} }),
    ).rejects.toMatchObject({ status: 401 });
    expect(silentRefresh).toHaveBeenCalledTimes(1);
  });
});
