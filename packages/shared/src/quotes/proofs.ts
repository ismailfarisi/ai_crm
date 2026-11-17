import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Artwork proofs and customer responses on the public quote link
 * ------------------------------------------------------------------ */

/** Proofs are what the floor builds from, so only files a person can look at. */
export const PROOF_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;

export function isAllowedProofType(contentType: string): boolean {
  return (PROOF_CONTENT_TYPES as readonly string[]).includes(contentType.split(';')[0].trim().toLowerCase());
}

export type QuoteProofStatus = 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED';

export const QUOTE_PROOF_STATUS_LABELS: Record<QuoteProofStatus, string> = {
  PENDING: 'Waiting for the customer',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
};

/** What the customer said about the quote itself, short of accepting it. */
export type CustomerQuoteResponse = 'DECLINED' | 'CHANGES_REQUESTED';

/** A proof version as staff see it. */
export interface QuoteProofDto {
  id: string;
  quoteId: string;
  version: number;
  status: QuoteProofStatus;
  attachmentId: string;
  filename: string;
  contentType: string;
  /** False once the file was removed from the quote's attachments. */
  fileAvailable: boolean;
  staffNote: string | null;
  uploadedByName: string | null;
  respondedAt: string | null;
  respondedByName: string | null;
  responseComment: string | null;
  /** Set once a newer version replaced this one. */
  supersededAt: string | null;
  createdAt: string;
}

/** A proof version as the customer sees it: no ids of other records, no staff names. */
export interface PublicQuoteProofDto {
  id: string;
  version: number;
  status: QuoteProofStatus;
  filename: string;
  contentType: string;
  /** A short-lived signed link, or null when the file is gone. */
  url: string | null;
  urlExpiresAt: string | null;
  staffNote: string | null;
  respondedAt: string | null;
  respondedByName: string | null;
  responseComment: string | null;
  superseded: boolean;
  createdAt: string;
}

/** The proof card on the quote screen: the versions, the rule, and the customer's last word. */
export interface QuoteProofsSummaryDto {
  proofRequired: boolean;
  /** True when the quote follows the organisation default rather than its own setting. */
  proofRequiredFromDefault: boolean;
  customerResponse: {
    kind: CustomerQuoteResponse;
    note: string | null;
    at: string | null;
    byName: string | null;
  } | null;
  proofs: QuoteProofDto[];
}

/** The proof a work order is built from, with a link the floor can open. */
export interface WorkOrderProofDto {
  quoteId: string;
  quoteNumber: string | null;
  proof: {
    id: string;
    version: number;
    filename: string;
    contentType: string;
    approvedAt: string | null;
    approvedByName: string | null;
    url: string | null;
    urlExpiresAt: string | null;
  } | null;
  /** A newer version than the approved one, still waiting or sent back. */
  newerVersion: { version: number; status: QuoteProofStatus } | null;
}

/** The latest live proof, or null. Superseded versions never count. */
export function latestProof<T extends { version: number; supersededAt?: string | null; superseded?: boolean }>(
  proofs: T[],
): T | null {
  const live = proofs.filter((p) => !(p.superseded ?? p.supersededAt));
  return live.sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Whether a proof requirement stops the customer accepting right now. */
export function proofBlocksAcceptance(
  required: boolean,
  latest: { status: QuoteProofStatus } | null,
): boolean {
  return required && latest?.status !== 'APPROVED';
}

const customerName = z
  .string({ error: 'Type your full name' })
  .trim()
  .min(2, 'Type your full name')
  .max(255);

const note = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters`);

export const declineQuoteSchema = z.object({
  name: customerName,
  reason: note(2000)
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type DeclineQuotePayload = z.output<typeof declineQuoteSchema>;

export const requestQuoteChangesSchema = z.object({
  name: customerName,
  note: note(2000).min(1, 'Say what you would like changed'),
});
export type RequestQuoteChangesPayload = z.output<typeof requestQuoteChangesSchema>;

export const approveProofSchema = z.object({ name: customerName });
export type ApproveProofPayload = z.output<typeof approveProofSchema>;

export const requestProofChangesSchema = z.object({
  name: customerName,
  comment: note(2000).min(1, 'Say what needs to change on the proof'),
});
export type RequestProofChangesPayload = z.output<typeof requestProofChangesSchema>;

export const proofRequirementSchema = z.object({ required: z.boolean() });
export type ProofRequirementPayload = z.output<typeof proofRequirementSchema>;

export const uploadProofSchema = z.object({
  note: note(1000)
    .nullish()
    .transform((v) => (v ? v : null)),
});
export type UploadProofPayload = z.output<typeof uploadProofSchema>;
