import type { Repository } from 'typeorm';
import {
  ChannelMessage,
  MessageDirection,
} from './entities/channel-message.entity';
import { ChannelProviderType } from './entities/channel-config.entity';

/**
 * WhatsApp lets a business send ordinary text only within 24 hours of the
 * customer's last message; after that only an approved template goes through.
 */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The customer's most recent WhatsApp message to the business, if any. */
export function lastWhatsAppMessageFrom(
  messages: Repository<ChannelMessage>,
  organizationId: string,
  address: string,
): Promise<ChannelMessage | null> {
  return messages.findOne({
    where: {
      organizationId,
      provider: ChannelProviderType.WHATSAPP_META,
      direction: MessageDirection.INBOUND,
      sender: address,
    },
    order: { createdAt: 'DESC' },
  });
}

export function insideWhatsAppWindow(
  last: { createdAt: Date } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!last) return false;
  return now.getTime() - new Date(last.createdAt).getTime() < WHATSAPP_WINDOW_MS;
}
