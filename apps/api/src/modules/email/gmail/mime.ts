/**
 * Small MIME helpers for the Gmail REST payload. Gmail returns `format=full`
 * messages as a part tree; `format=raw` would hand us a whole RFC822 blob we
 * would then have to parse ourselves, so the tree is the cheaper option.
 */

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailMessagePart[];
}

export interface ParsedAttachment {
  gmailAttachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ParsedBody {
  text: string;
  html: string;
  attachments: ParsedAttachment[];
}

/** Gmail returns base64url, not base64 — `-_` instead of `+/`, no padding. */
export function decodeBase64Url(data: string | null | undefined): string {
  if (!data) return '';
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function headerValue(
  headers: GmailHeader[] | undefined,
  name: string,
): string {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? '';
}

/** "Jane Doe <jane@x.com>, bob@y.com" → [{name, email}, ...] */
export function parseAddressHeader(
  value: string,
): { name?: string; email: string }[] {
  if (!value) return [];
  const out: { name?: string; email: string }[] = [];
  for (const chunk of value.split(',')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    // Display names only count when the address sits in angle brackets —
    // a bare "bo b@y.com" is not "name bo + mailbox b@y.com".
    const angled = trimmed.match(
      /^(?:"([^"]+)"|([^<]*?))\s*<([^<>\s,]+@[^<>\s,]+)>$/,
    );
    if (angled) {
      const name = (angled[1] ?? angled[2])?.trim();
      out.push({
        email: angled[3].toLowerCase(),
        ...(name ? { name } : {}),
      });
    } else {
      out.push({ email: trimmed.toLowerCase() });
    }
  }
  return out;
}

export function displayNameFromAddress(value: string): string | null {
  return parseAddressHeader(value)[0]?.name ?? null;
}

export function firstEmailFromAddress(value: string): string {
  return parseAddressHeader(value)[0]?.email ?? value.trim().toLowerCase();
}

/**
 * Walks the part tree collecting the first text/plain and text/html bodies
 * and every attachment. Multipart/alternative children win over the
 * container's own body; anything with a filename or an attachmentId is an
 * attachment regardless of declared type.
 */
export function extractBody(root: GmailMessagePart): ParsedBody {
  const result: ParsedBody = { text: '', html: '', attachments: [] };

  const walk = (part: GmailMessagePart): void => {
    const mime = part.mimeType ?? '';
    const isAttachment =
      Boolean(part.body?.attachmentId) ||
      Boolean(part.filename && part.filename.length > 0);

    if (isAttachment && part.body?.attachmentId) {
      result.attachments.push({
        gmailAttachmentId: part.body.attachmentId,
        filename: part.filename || 'attachment',
        mimeType: mime || 'application/octet-stream',
        sizeBytes: part.body.size ?? 0,
      });
      return;
    }
    if (!isAttachment && part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (mime === 'text/plain' && !result.text) result.text = decoded;
      else if (mime === 'text/html' && !result.html) result.html = decoded;
    }
    for (const child of part.parts ?? []) walk(child);
  };

  walk(root);
  return result;
}

/** Header-safe encoded-word for non-ASCII subjects / names. */
function encodedWord(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function formatAddress(email: string, name?: string): string {
  return name ? `${encodedWord(name)} <${email}>` : email;
}

export interface ComposeInput {
  fromEmail: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  inReplyTo?: string | null;
  references?: string[];
}

/**
 * Minimal RFC822 composer. Bcc is deliberately omitted from the wire
 * headers — Gmail delivers to it anyway because recipients come from the
 * SMTP envelope the API derives from To/Cc/Bcc in the payload headers.
 */
export function composeRfc822(input: ComposeInput): string {
  const headers: string[] = [
    `From: ${formatAddress(input.fromEmail, input.fromName)}`,
    `To: ${input.to.join(', ')}`,
  ];
  if (input.cc?.length) headers.push(`Cc: ${input.cc.join(', ')}`);
  if (input.bcc?.length) headers.push(`Bcc: ${input.bcc.join(', ')}`);
  if (input.subject) headers.push(`Subject: ${encodedWord(input.subject)}`);
  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${input.inReplyTo}`);
    headers.push(
      `References: ${[...(input.references ?? []), input.inReplyTo].join(' ')}`,
    );
  }
  headers.push('MIME-Version: 1.0');

  let body: string;
  if (input.bodyHtml) {
    const boundary = `----kerf-${Date.now().toString(36)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(input.bodyText, 'utf8').toString('base64'),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(input.bodyHtml, 'utf8').toString('base64'),
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push('Content-Transfer-Encoding: base64');
    body = Buffer.from(input.bodyText, 'utf8').toString('base64');
  }

  return [...headers, '', body].join('\r\n');
}

export function toBase64Url(raw: string): string {
  return Buffer.from(raw, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
