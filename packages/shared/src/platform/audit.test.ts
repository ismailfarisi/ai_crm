import { describe, expect, it } from 'vitest';
import {
  auditActionFor,
  changedFields,
  redactForAudit,
  safeFilename,
  isAllowedAttachmentType,
} from '../index';

describe('redactForAudit', () => {
  it('removes secrets at any depth and keeps the rest', () => {
    const out = redactForAudit({
      email: 'a@b.test',
      passwordHash: 'hash',
      nested: { apiKey: 'sk-1', keep: 2 },
      list: [{ token: 't' }],
    }) as Record<string, unknown>;
    expect(out).toEqual({
      email: 'a@b.test',
      passwordHash: '[redacted]',
      nested: { apiKey: '[redacted]', keep: 2 },
      list: [{ token: '[redacted]' }],
    });
  });

  it('flattens dates so a stored blob compares cleanly', () => {
    expect(redactForAudit(new Date('2026-01-02T03:04:05.000Z'))).toBe(
      '2026-01-02T03:04:05.000Z',
    );
  });
});

describe('changedFields', () => {
  it('ignores timestamps the ORM maintains', () => {
    expect(
      changedFields(
        { status: 'DRAFT', updatedAt: '1', total: 10 },
        { status: 'APPROVED', updatedAt: '2', total: 10 },
      ),
    ).toEqual(['status']);
  });

  it('is empty when one side is missing', () => {
    expect(changedFields(null, { a: 1 })).toEqual([]);
  });
});

describe('auditActionFor', () => {
  it('names the action after the route, not the method', () => {
    expect(auditActionFor('POST', ['quotes'])).toBe('quote.create');
    expect(auditActionFor('PATCH', ['quotes', ':id'])).toBe('quote.update');
    expect(
      auditActionFor('POST', [
        'quotes',
        '7f1c2a3b-4d5e-6f70-8a9b-0c1d2e3f4a5b',
        'signal',
      ]),
    ).toBe('quote.signal');
    expect(auditActionFor('DELETE', ['purchase-orders', ':id'])).toBe(
      'purchase_order.delete',
    );
  });
});

describe('attachments', () => {
  it('refuses a type the browser would execute', () => {
    expect(isAllowedAttachmentType('application/pdf')).toBe(true);
    expect(isAllowedAttachmentType('APPLICATION/PDF; charset=utf-8')).toBe(true);
    expect(isAllowedAttachmentType('text/html')).toBe(false);
  });

  it('strips traversal out of a filename', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\Users\\art work.pdf')).toBe('art work.pdf');
    expect(safeFilename('...')).toBe('file');
  });
});
