import { describe, expect, it } from 'vitest';
import { isReceiptContentType, receiptAttachmentId, receiptAttachmentRef } from './receipts';

describe('receipt references', () => {
  it('round-trips an attachment id', () => {
    expect(receiptAttachmentId(receiptAttachmentRef('a1b2'))).toBe('a1b2');
  });

  it('treats links, data URLs and empties as not stored', () => {
    expect(receiptAttachmentId('https://files.example/r.png')).toBeNull();
    expect(receiptAttachmentId('data:image/png;base64,AAAA')).toBeNull();
    expect(receiptAttachmentId('attachment:')).toBeNull();
    expect(receiptAttachmentId(null)).toBeNull();
  });

  it('stores PDFs and images only', () => {
    expect(isReceiptContentType('application/pdf')).toBe(true);
    expect(isReceiptContentType('image/svg+xml')).toBe(true);
    expect(isReceiptContentType('text/html')).toBe(false);
  });
});
