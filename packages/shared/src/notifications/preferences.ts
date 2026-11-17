import { z } from 'zod';

/** Where an approval notice can be delivered. */
export const NOTIFICATION_CHANNELS = ['BELL', 'EMAIL', 'CHAT'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** What a notice is about: a new request, its one reminder, or its outcome. */
export type ApprovalNoticeEvent = 'REQUESTED' | 'REMINDER' | 'APPROVED' | 'REJECTED';

/** Bell and email on, chat off until someone links a chat and opts in. */
export const DEFAULT_APPROVAL_CHANNELS: NotificationChannel[] = ['BELL', 'EMAIL'];
export const DEFAULT_OUTCOME_CHANNELS: NotificationChannel[] = ['BELL', 'EMAIL'];
/** Four hours: long enough not to nag, short enough to save the day. */
export const DEFAULT_APPROVAL_REMINDER_MINUTES = 240;

const channelList = z
  .array(z.enum(NOTIFICATION_CHANNELS))
  .max(NOTIFICATION_CHANNELS.length)
  .transform((list) => NOTIFICATION_CHANNELS.filter((c) => list.includes(c)));

/** "HH:MM", 24-hour. */
const clock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
  .nullable()
  .optional()
  .transform((v) => v ?? null);

function knownTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const quietHours = {
  quietHoursStart: clock,
  quietHoursEnd: clock,
  timezone: z
    .string()
    .trim()
    .max(60)
    .refine((v) => !v || knownTimeZone(v), 'Unknown time zone')
    .nullable()
    .optional()
    .transform((v) => (v ? v : null)),
};

function quietHoursPaired(v: { quietHoursStart: string | null; quietHoursEnd: string | null }) {
  return (v.quietHoursStart === null) === (v.quietHoursEnd === null);
}

export const userNotificationPreferencesSchema = z
  .object({
    approvalChannels: channelList,
    outcomeChannels: channelList,
    ...quietHours,
  })
  .refine(quietHoursPaired, {
    message: 'Set both a start and an end, or neither',
    path: ['quietHoursEnd'],
  });

export const orgNotificationPreferencesSchema = z
  .object({
    approvalChannels: channelList,
    outcomeChannels: channelList,
    ...quietHours,
    /** Minutes an approval waits before its one reminder (15 min to 7 days). */
    reminderDelayMinutes: z.coerce.number().int().min(15).max(10080),
  })
  .refine(quietHoursPaired, {
    message: 'Set both a start and an end, or neither',
    path: ['quietHoursEnd'],
  });

export type UserNotificationPreferencesInput = z.input<typeof userNotificationPreferencesSchema>;
export type UserNotificationPreferencesPayload = z.output<typeof userNotificationPreferencesSchema>;
export type OrgNotificationPreferencesInput = z.input<typeof orgNotificationPreferencesSchema>;
export type OrgNotificationPreferencesPayload = z.output<typeof orgNotificationPreferencesSchema>;

export interface NotificationPreferencesView {
  /** The user's own choice, or null while they follow the organisation default. */
  own: UserNotificationPreferencesPayload | null;
  orgDefault: OrgNotificationPreferencesPayload;
  /** What applies right now. */
  effective: UserNotificationPreferencesPayload;
  /** The user's linked Kerf chats, e.g. ['TELEGRAM']. Chat delivery needs one. */
  linkedChats: string[];
  canEditOrgDefault: boolean;
}
