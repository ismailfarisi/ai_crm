import { z } from 'zod';
import { AUDIT_ORIGINS } from '../platform/audit';
import { ATTACHMENT_OWNER_TYPES } from '../platform/attachments';

const isoDate = z.coerce.date();

export const auditQuerySchema = z.object({
  subjectType: z.string().trim().max(40).optional(),
  subjectId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().trim().max(80).optional(),
  origin: z.enum(AUDIT_ORIGINS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const attachmentOwnerSchema = z.object({
  ownerType: z.enum(ATTACHMENT_OWNER_TYPES),
  ownerId: z.string().uuid(),
});

export type AuditQueryPayload = z.output<typeof auditQuerySchema>;
export type AttachmentOwnerPayload = z.output<typeof attachmentOwnerSchema>;
