import { z } from 'zod';

/** Staff may type a number for this one message instead of the one on the customer record. */
export const sendOnWhatsAppSchema = z.object({
  to: z.string().trim().max(40).nullish(),
});
export type SendOnWhatsAppPayload = z.output<typeof sendOnWhatsAppSchema>;

/**
 * How a document went out on WhatsApp.
 * - `CHANNEL`: the business's connected WhatsApp number sent it, and it is in the inbox.
 * - `CLICK_TO_CHAT`: the business number could not send it, so `chatUrl` opens
 *   WhatsApp on the staff member's own phone or computer with the message filled in.
 */
export const WHATSAPP_SEND_METHODS = ['CHANNEL', 'CLICK_TO_CHAT'] as const;
export type WhatsAppSendMethod = (typeof WHATSAPP_SEND_METHODS)[number];

export interface WhatsAppSendResultDto {
  method: WhatsAppSendMethod;
  /** The number in international form, digits only. */
  to: string;
  /** The text that was sent, or that is filled in for click-to-chat. */
  text: string;
  /** The customer's link inside the message, when there is one. */
  url: string | null;
  /** wa.me link for click-to-chat; null when the business number sent it. */
  chatUrl: string | null;
  /** Why the business number did not send it, in plain words. Null when it did. */
  reason: string | null;
  /** True when it went out as the approved template, because the customer last wrote over 24 hours ago. */
  usedTemplate: boolean;
}
