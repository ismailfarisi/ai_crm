import type { ChannelAgentKind } from '@saas/shared';

export const AGENT_KIND_LABELS: Record<ChannelAgentKind, string> = {
  CUSTOMER: 'Talks to customers',
  STAFF: 'Works for staff',
};

export const AGENT_CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP_META: 'WhatsApp',
  TELEGRAM: 'Telegram',
  SLACK: 'Slack',
  EMAIL_SMTP: 'Email (SMTP)',
  EMAIL_RESEND: 'Email (Resend)',
};

/** Staff link their own chat on these; nobody links an email address. */
const STAFF_CHANNELS = ['WHATSAPP_META', 'TELEGRAM', 'SLACK'];

export function agentChannelOptions(kind: ChannelAgentKind) {
  return Object.entries(AGENT_CHANNEL_LABELS)
    .filter(([value]) => kind === 'CUSTOMER' || STAFF_CHANNELS.includes(value))
    .map(([value, label]) => ({ value, label }));
}

/** `quote.create` → "Quote create", for tools that have no nicer name. */
export function toolLabel(name: string): string {
  const words = name.replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
