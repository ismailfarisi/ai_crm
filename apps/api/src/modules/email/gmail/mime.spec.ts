import {
  composeRfc822,
  decodeBase64Url,
  extractBody,
  headerValue,
  parseAddressHeader,
  toBase64Url,
} from './mime';

const b64url = (s: string) =>
  Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

describe('decodeBase64Url', () => {
  it('round-trips UTF-8 content', () => {
    expect(decodeBase64Url(b64url('héllo wörld — ✓'))).toBe('héllo wörld — ✓');
  });

  it('returns empty for missing data', () => {
    expect(decodeBase64Url(undefined)).toBe('');
  });
});

describe('headerValue', () => {
  it('matches header names case-insensitively', () => {
    const headers = [
      { name: 'Subject', value: 'Hi' },
      { name: 'MESSAGE-ID', value: '<a@b>' },
    ];
    expect(headerValue(headers, 'message-id')).toBe('<a@b>');
    expect(headerValue(headers, 'missing')).toBe('');
  });
});

describe('parseAddressHeader', () => {
  it('parses a mixed list', () => {
    expect(
      parseAddressHeader('"Jane Doe" <jane@x.com>, bob@y.com, <zed@z.com>'),
    ).toEqual([
      { name: 'Jane Doe', email: 'jane@x.com' },
      { email: 'bob@y.com' },
      { email: 'zed@z.com' },
    ]);
  });

  it('handles empty input', () => {
    expect(parseAddressHeader('')).toEqual([]);
  });
});

describe('extractBody', () => {
  it('reads a simple single-part message', () => {
    const parsed = extractBody({
      mimeType: 'text/plain',
      body: { data: b64url('hello'), size: 5 },
    });
    expect(parsed.text).toBe('hello');
    expect(parsed.attachments).toEqual([]);
  });

  it('prefers both alternatives in a multipart/alternative', () => {
    const parsed = extractBody({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('plain') } },
        { mimeType: 'text/html', body: { data: b64url('<b>html</b>') } },
      ],
    });
    expect(parsed.text).toBe('plain');
    expect(parsed.html).toBe('<b>html</b>');
  });

  it('collects attachments and skips their bodies', () => {
    const parsed = extractBody({
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: b64url('see attached') } },
        {
          mimeType: 'application/pdf',
          filename: 'quote.pdf',
          body: { attachmentId: 'att-1', size: 1234 },
        },
      ],
    });
    expect(parsed.text).toBe('see attached');
    expect(parsed.attachments).toEqual([
      {
        gmailAttachmentId: 'att-1',
        filename: 'quote.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
      },
    ]);
  });
});

describe('composeRfc822', () => {
  it('emits headers and a plain-text body', () => {
    const raw = composeRfc822({
      fromEmail: 'me@x.com',
      to: ['you@y.com'],
      subject: 'Hello',
      bodyText: 'Body line',
    });
    expect(raw).toContain('From: me@x.com');
    expect(raw).toContain('To: you@y.com');
    expect(raw).toContain('Subject: Hello');
    expect(raw).toContain('Content-Type: text/plain');
    expect(raw).toContain(Buffer.from('Body line', 'utf8').toString('base64'));
  });

  it('encodes non-ASCII subjects as encoded-words', () => {
    const raw = composeRfc822({
      fromEmail: 'me@x.com',
      to: ['you@y.com'],
      subject: 'Ünïcödé ✓',
      bodyText: 'x',
    });
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  });

  it('threads replies with In-Reply-To and References', () => {
    const raw = composeRfc822({
      fromEmail: 'me@x.com',
      to: ['you@y.com'],
      subject: 'Re: Hi',
      bodyText: 'x',
      inReplyTo: '<original@host>',
    });
    expect(raw).toContain('In-Reply-To: <original@host>');
    expect(raw).toContain('References: <original@host>');
  });

  it('round-trips through toBase64Url without padding', () => {
    const encoded = toBase64Url('any raw string ✓');
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeBase64Url(encoded)).toBe('any raw string ✓');
  });
});
