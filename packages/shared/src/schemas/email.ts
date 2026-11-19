import { z } from 'zod';
import { EMAIL_FOLDERS } from '../email/types';

export const sendEmailSchema = z.object({
  /** Account to send from — must be one the caller can see. */
  accountId: z.string().uuid(),
  /** Replying inside a thread keeps the conversation together. */
  threadId: z.string().uuid().optional(),
  to: z.array(z.string().email()).min(1, 'Add at least one recipient'),
  cc: z.array(z.string().email()).default([]),
  bcc: z.array(z.string().email()).default([]),
  subject: z.string().max(500).default(''),
  bodyText: z.string().min(1, 'Message body is required'),
  bodyHtml: z.string().optional(),
});

export const emailThreadQuerySchema = z.object({
  folder: z.enum(EMAIL_FOLDERS).optional(),
  accountId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const updateEmailThreadSchema = z
  .object({
    isRead: z.boolean().optional(),
    isStarred: z.boolean().optional(),
    folder: z.enum(EMAIL_FOLDERS).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Nothing to update',
  });

export const updateEmailAccountSchema = z.object({
  isShared: z.boolean(),
});

/**
 * Connect a mailbox with a Gmail app password — the no-OAuth path that works
 * for any Google Workspace domain or plain Gmail account. Google shows the
 * password as four blocks of four; pasted spaces are stripped server-side.
 */
export const connectImapAccountSchema = z.object({
  emailAddress: z.string().email(),
  appPassword: z.string().min(8).max(200),
  isShared: z.boolean().default(false),
});

export type SendEmailPayload = z.infer<typeof sendEmailSchema>;
export type EmailThreadQuery = z.infer<typeof emailThreadQuerySchema>;
export type UpdateEmailThreadPayload = z.infer<typeof updateEmailThreadSchema>;
export type UpdateEmailAccountPayload = z.infer<typeof updateEmailAccountSchema>;
export type ConnectImapAccountPayload = z.infer<typeof connectImapAccountSchema>;
