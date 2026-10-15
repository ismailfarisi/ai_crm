import { API_PUBLIC_URL, toApiError } from './config';
import { silentRefresh } from './client';

export interface SseEvent {
  id?: string;
  event: string;
  data: string;
}

/** Split a buffer into complete SSE events; return the incomplete tail. */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const normalised = buffer.replace(/\r\n/g, '\n');
  const blocks = normalised.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let id: string | undefined;
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'id') id = value;
      else if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ ...(id !== undefined ? { id } : {}), event, data: data.join('\n') });
  }
  return { events, rest };
}

/**
 * Credentialed SSE over fetch (cookies, not EventSource) so it shares the
 * API client's silent-refresh behaviour. Resolves when the server closes.
 */
export async function openEventStream(
  path: string,
  opts: { lastEventId?: string; signal: AbortSignal; onEvent: (event: SseEvent) => void },
  retried = false,
): Promise<void> {
  const response = await fetch(`${API_PUBLIC_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'text/event-stream', ...(opts.lastEventId ? { 'Last-Event-ID': opts.lastEventId } : {}) },
    signal: opts.signal,
  });
  if (response.status === 401 && !retried && (await silentRefresh())) {
    return openEventStream(path, opts, true);
  }
  if (!response.ok || !response.body) throw await toApiError(response);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;
    events.forEach(opts.onEvent);
  }
}
