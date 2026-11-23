import { filenameFor, toMessageFileDtos } from './message-files';

describe('message files', () => {
  const now = Date.parse('2026-11-23T12:00:00Z');
  const sent = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);
  const file = { ref: 'p1', mimeType: 'application/pdf', filename: 'a.pdf' };

  it('reports no files for a message that had none', () => {
    expect(toMessageFileDtos({ metadata: {} }, now)).toEqual([]);
    expect(toMessageFileDtos({ metadata: null }, now)).toEqual([]);
    expect(toMessageFileDtos({ metadata: { files: 'x' } }, now)).toEqual([]);
  });

  it('says a file is saved once it has an attachment, and never leaks the provider’s id', () => {
    const [dto] = toMessageFileDtos(
      {
        metadata: {
          files: [{ ...file, attachmentId: 'att-1', sizeBytes: 2048 }],
        },
        createdAt: sent(600),
      },
      now,
    );
    expect(dto).toEqual({
      filename: 'a.pdf',
      mimeType: 'application/pdf',
      status: 'saved',
      attachmentId: 'att-1',
      sizeBytes: 2048,
    });
  });

  it('says a recent file without a copy is still saving', () => {
    const [dto] = toMessageFileDtos(
      { metadata: { files: [file] }, createdAt: sent(1) },
      now,
    );
    expect(dto.status).toBe('saving');
  });

  it('gives up on a copy that never arrived', () => {
    const [stale] = toMessageFileDtos(
      { metadata: { files: [file] }, createdAt: sent(30) },
      now,
    );
    expect(stale.status).toBe('failed');
    const [errored] = toMessageFileDtos(
      {
        metadata: { files: [{ ...file, error: 'too large' }] },
        createdAt: sent(1),
      },
      now,
    );
    expect(errored.status).toBe('failed');
  });

  it('names a file that came without a name by what it is and where it sat', () => {
    expect(filenameFor({ id: '1', mimeType: 'image/jpeg' }, 0)).toBe(
      'photo-1.jpg',
    );
    expect(filenameFor({ id: '1', mimeType: 'audio/ogg' }, 1)).toBe(
      'audio-2.ogg',
    );
    expect(filenameFor({ id: '1', mimeType: 'application/x-unknown' }, 2)).toBe(
      'file-3',
    );
  });

  it('strips a path a sender put in a file name', () => {
    expect(
      filenameFor(
        { id: '1', mimeType: 'application/pdf', filename: '../../etc/passwd' },
        0,
      ),
    ).toBe('passwd');
  });
});
