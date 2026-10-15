import { describe, expect, it } from 'vitest';
import { parseSseChunk } from './stream';

describe('parseSseChunk', () => {
  it('parses complete events and keeps the partial tail', () => {
    const { events, rest } = parseSseChunk('id: 3\nevent: message\ndata: {"a":1}\n\n: ping\n\nid: 4\nevent: mess');
    expect(events).toEqual([{ id: '3', event: 'message', data: '{"a":1}' }]);
    expect(rest).toBe('id: 4\nevent: mess');
  });

  it('handles CRLF line endings', () => {
    const { events } = parseSseChunk('id: 1\r\nevent: message\r\ndata: x\r\n\r\n');
    expect(events[0]).toEqual({ id: '1', event: 'message', data: 'x' });
  });
});
