import { CUSTOMER_LOOKUP_TOOLS, type ChannelAgentKind } from '@saas/shared';

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

/** Tools that read a customer's own records for them. */
export const CUSTOMER_LOOKUP_TOOL_NAMES: readonly string[] = CUSTOMER_LOOKUP_TOOLS;

const TOOL_LABELS: Record<string, string> = {
  check_order_status: 'Answer "where is my order"',
  check_quote_status: 'Answer "what is the status of my quote"',
};

/** `quote.create` → "Quote create", for tools that have no nicer name. */
export function toolLabel(name: string): string {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  const words = name.replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
