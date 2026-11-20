import { z } from 'zod';
import { ChannelProviderEnum } from './channel';

/**
 * Tools that read a customer's own orders and quotes. An agent holding one
 * only gets an answer for a sender Kerf can tie to exactly one customer.
 */
export const CUSTOMER_LOOKUP_TOOLS = ['check_order_status', 'check_quote_status'] as const;
export type CustomerLookupTool = (typeof CUSTOMER_LOOKUP_TOOLS)[number];

/** Staff confirm that a sender on a channel is a customer. */
export const linkCustomerSenderSchema = z.object({
  customerId: z.string().uuid(),
  provider: ChannelProviderEnum,
  /** The number, address or chat id exactly as the channel reports it. */
  identifier: z.string().trim().min(1).max(255),
});
export type LinkCustomerSenderPayload = z.infer<typeof linkCustomerSenderSchema>;

export type CustomerSenderStatus =
  /** Staff linked this sender to the customer. */
  | 'LINKED'
  /** The sender's number or address is the one on exactly one customer's record. */
  | 'ON_RECORD'
  /** The number or address is on more than one customer's record. */
  | 'AMBIGUOUS'
  /** Nothing ties this sender to a customer. */
  | 'UNKNOWN'
  /** A sender that cannot be tied to one person, such as a group chat. */
  | 'UNSUPPORTED';

/** Which customer, if any, an agent would treat a sender as. */
export interface CustomerSenderCheckDto {
  status: CustomerSenderStatus;
  customer: { id: string; companyName: string } | null;
  /** The link to remove, for LINKED. */
  linkId: string | null;
}

export interface CustomerSenderLinkDto {
  id: string;
  customerId: string;
  provider: string;
  identifier: string;
  createdAt: string;
}
