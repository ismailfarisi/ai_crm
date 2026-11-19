import {
  imapThreadKey,
  imapToNormalized,
  labelsFor,
  normalizeSubject,
  subjectThreadKey,
  threadAnchors,
} from './imap-mime';
import type { Email } from 'postal-mime';

const parsed = (overrides: Partial<Email>): Email => ({
  attachments: [],
  headers: [],
  headerLines: [],
  ...overrides,
});

describe('normalizeSubject', () => {
  it('strips stacked reply/forward prefixes', () => {
    expect(normalizeSubject('Re: Fwd: Re: Hello')).toBe('hello');
    expect(normalizeSubject('FW: AW: Project X')).toBe('project x');
    expect(normalizeSubject('Quarterly report')).toBe('quarterly report');
  });

  it('keeps a colon inside the subject', () => {
    expect(normalizeSubject('Note: keep this')).toBe('note: keep this');
  });
});

describe('imapThreadKey', () => {
  it('roots on the oldest References entry', () => {
    const key = imapThreadKey(
      parsed({
        references: '<root@x> <mid@x>',
        inReplyTo: '<mid@x>',
        subject: 'Re: Hi',
      }),
    );
    expect(key).toBe(imapThreadKey(parsed({ references: '<root@x>' })));
  });

  it('falls back to In-Reply-To when there are no references', () => {
    expect(
      imapThreadKey(parsed({ inReplyTo: '<p@x>', subject: 'Re: Hi' })),
    ).toBe(imapThreadKey(parsed({ inReplyTo: '<p@x>' })));
  });

  it('keys lone messages by normalized subject — replies match', () => {
    expect(imapThreadKey(parsed({ subject: 'Hello' }))).toBe(
      subjectThreadKey('Re: hello'),
    );
  });
});

describe('threadAnchors', () => {
  it('returns references oldest-first then in-reply-to, deduped', () => {
    expect(
      threadAnchors(
        parsed({
          references: '<a@x> <b@x>',
          inReplyTo: '<b@x>',
        }),
      ),
    ).toEqual(['<a@x>', '<b@x>']);
  });
});

describe('labelsFor', () => {
  it('maps an unread inbox message', () => {
    expect(labelsFor('\\Inbox', 'INBOX', new Set())).toEqual(
      expect.arrayContaining(['INBOX', 'UNREAD']),
    );
  });

  it('maps a read, starred, sent message', () => {
    const labels = labelsFor(
      '\\Sent',
      '[Gmail]/Sent Mail',
      new Set(['\\Seen', '\\Flagged']),
    );
    expect(labels).toContain('SENT');
    expect(labels).toContain('STARRED');
    expect(labels).not.toContain('UNREAD');
  });

  it('maps special-use to pseudo-labels', () => {
    expect(labelsFor('\\Trash', '[Gmail]/Trash', new Set(['\\Seen']))).toEqual([
      'TRASH',
    ]);
    expect(labelsFor('\\Junk', '[Gmail]/Spam', new Set(['\\Seen']))).toEqual([
      'SPAM',
    ]);
    expect(
      labelsFor('\\Drafts', '[Gmail]/Drafts', new Set(['\\Seen'])),
    ).toEqual(['DRAFT']);
  });
});

describe('imapToNormalized', () => {
  it('marks mail sent by the account outbound', () => {
    const n = imapToNormalized(
      parsed({
        from: { name: 'Me', address: 'me@x.com' },
        subject: 'Hi',
      }),
      {
        mailboxPath: 'INBOX',
        specialUse: '\\Inbox',
        uid: 7,
        accountEmail: 'me@x.com',
      },
    );
    expect(n.direction).toBe('OUTBOUND');
    expect(n.status).toBe('SENT');
    expect(n.providerMessageId).toBe('INBOX:7');
  });

  it('locates attachments by mailbox:uid:index', () => {
    const n = imapToNormalized(
      parsed({
        from: { address: 'a@b.com' },
        attachments: [
          {
            filename: 'a.pdf',
            mimeType: 'application/pdf',
            disposition: 'attachment',
            content: new Uint8Array([1, 2, 3]),
          },
        ],
      }),
      {
        mailboxPath: 'INBOX',
        specialUse: '\\Inbox',
        uid: 9,
        flags: new Set(['\\Seen']),
        accountEmail: 'me@x.com',
      },
    );
    expect(n.attachments[0]).toMatchObject({
      providerAttachmentId: 'INBOX:9:0',
      filename: 'a.pdf',
      sizeBytes: 3,
    });
  });
});
