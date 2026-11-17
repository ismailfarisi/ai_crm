import { describe, it, expect } from 'vitest';
import {
  declineQuoteSchema,
  isAllowedProofType,
  latestProof,
  proofBlocksAcceptance,
  requestProofChangesSchema,
  requestQuoteChangesSchema,
} from './proofs';

describe('isAllowedProofType', () => {
  it('takes PDFs and common images only', () => {
    expect(isAllowedProofType('application/pdf')).toBe(true);
    expect(isAllowedProofType('IMAGE/PNG; charset=binary')).toBe(true);
    expect(isAllowedProofType('image/svg+xml')).toBe(false);
    expect(isAllowedProofType('text/html')).toBe(false);
  });
});

describe('latestProof and proofBlocksAcceptance', () => {
  const v1 = { version: 1, status: 'APPROVED' as const, superseded: true };
  const v2 = { version: 2, status: 'PENDING' as const, superseded: false };

  it('picks the live version, whatever order it arrives in', () => {
    expect(latestProof([v1, v2])).toBe(v2);
    expect(latestProof([])).toBeNull();
  });

  it('blocks until the latest version is approved, and only when required', () => {
    expect(proofBlocksAcceptance(true, latestProof([v2, v1]))).toBe(true);
    expect(proofBlocksAcceptance(true, null)).toBe(true);
    expect(proofBlocksAcceptance(true, latestProof([{ ...v2, status: 'APPROVED' as const }, v1]))).toBe(false);
    expect(proofBlocksAcceptance(false, v2)).toBe(false);
  });
});

describe('customer response schemas', () => {
  it('needs a note to request changes, but not to decline', () => {
    expect(requestQuoteChangesSchema.safeParse({ name: 'Jo Bloggs', note: '   ' }).success).toBe(false);
    expect(declineQuoteSchema.parse({ name: ' Jo Bloggs ', reason: '' })).toEqual({
      name: 'Jo Bloggs',
      reason: null,
    });
  });

  it('needs a name and a comment to send a proof back', () => {
    expect(requestProofChangesSchema.safeParse({ name: 'J', comment: 'Bigger logo' }).success).toBe(false);
    expect(requestProofChangesSchema.safeParse({ name: 'Jo', comment: 'Bigger logo' }).success).toBe(true);
  });
});
