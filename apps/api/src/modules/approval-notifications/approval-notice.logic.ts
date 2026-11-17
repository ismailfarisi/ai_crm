import {
  DEFAULT_APPROVAL_CHANNELS,
  DEFAULT_APPROVAL_REMINDER_MINUTES,
  DEFAULT_OUTCOME_CHANNELS,
  type ApprovalNoticeEvent,
  type NotificationChannel,
  type NotificationType,
  type OrgNotificationPreferencesPayload,
  type UserNotificationPreferencesPayload,
} from '@saas/shared';
import type { NotificationPreference } from './entities/notification-preference.entity';
import type { ApprovalRequest } from './entities/approval-request.entity';

export function orgDefaultFrom(
  row: NotificationPreference | null | undefined,
): OrgNotificationPreferencesPayload {
  return {
    approvalChannels: row?.approvalChannels ?? [...DEFAULT_APPROVAL_CHANNELS],
    outcomeChannels: row?.outcomeChannels ?? [...DEFAULT_OUTCOME_CHANNELS],
    quietHoursStart: row?.quietHoursStart ?? null,
    quietHoursEnd: row?.quietHoursEnd ?? null,
    timezone: row?.timezone ?? null,
    reminderDelayMinutes:
      row?.reminderDelayMinutes ?? DEFAULT_APPROVAL_REMINDER_MINUTES,
  };
}

export function userPrefsFrom(
  row: NotificationPreference,
): UserNotificationPreferencesPayload {
  return {
    approvalChannels: row.approvalChannels,
    outcomeChannels: row.outcomeChannels,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    timezone: row.timezone,
  };
}

/** The user's own row wins as a whole; otherwise the organisation default. */
export function effectivePreferences(
  own: NotificationPreference | null | undefined,
  org: NotificationPreference | null | undefined,
): UserNotificationPreferencesPayload {
  if (own) return userPrefsFrom(own);
  const d = orgDefaultFrom(org);
  return {
    approvalChannels: d.approvalChannels,
    outcomeChannels: d.outcomeChannels,
    quietHoursStart: d.quietHoursStart,
    quietHoursEnd: d.quietHoursEnd,
    timezone: d.timezone,
  };
}

export function channelsFor(
  prefs: UserNotificationPreferencesPayload,
  event: ApprovalNoticeEvent,
): NotificationChannel[] {
  return event === 'REQUESTED' || event === 'REMINDER'
    ? prefs.approvalChannels
    : prefs.outcomeChannels;
}

function toMinutes(clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes past midnight in `timeZone` (UTC+4 when unset or unknown: the UAE). */
function localMinutes(now: Date, timeZone: string | null): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone ?? 'Asia/Dubai',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h * 60 + m;
  } catch {
    return (now.getUTCHours() * 60 + now.getUTCMinutes() + 240) % 1440;
  }
}

/**
 * When quiet hours are on now, the moment they end; otherwise null.
 * The window may cross midnight (22:00–07:00).
 */
export function quietUntil(
  prefs: Pick<
    UserNotificationPreferencesPayload,
    'quietHoursStart' | 'quietHoursEnd' | 'timezone'
  >,
  now: Date,
): Date | null {
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return null;
  const start = toMinutes(prefs.quietHoursStart);
  const end = toMinutes(prefs.quietHoursEnd);
  if (start === end) return null;
  const local = localMinutes(now, prefs.timezone);
  const inside =
    start < end ? local >= start && local < end : local >= start || local < end;
  if (!inside) return null;
  const wait = (end - local + 1440) % 1440;
  const until = new Date(now.getTime() + wait * 60_000);
  until.setSeconds(0, 0);
  return until;
}

/** Email and chat wait out quiet hours; the bell is silent anyway. */
export function deferredByQuietHours(channel: NotificationChannel): boolean {
  return channel !== 'BELL';
}

export interface NoticeText {
  type: NotificationType;
  title: string;
  body: string | null;
}

const ITEM_NOUN: Record<ApprovalRequest['itemType'], string> = {
  QUOTE: 'Quote',
  AUTOMATION_APPROVAL: 'Automation step',
  ASSISTANT_ACTION: 'Assistant action',
};

export function noticeText(
  request: Pick<ApprovalRequest, 'itemType' | 'title' | 'body' | 'comment'>,
  event: ApprovalNoticeEvent,
): NoticeText {
  switch (event) {
    case 'REQUESTED':
      return {
        type:
          request.itemType === 'QUOTE'
            ? 'QUOTE_AWAITING_APPROVAL'
            : 'APPROVAL_REQUESTED',
        title: `Needs approval: ${request.title}`.slice(0, 200),
        body: request.body,
      };
    case 'REMINDER':
      return {
        type: 'APPROVAL_REMINDER',
        title: `Still waiting: ${request.title}`.slice(0, 200),
        body: request.body,
      };
    case 'APPROVED':
    case 'REJECTED': {
      const verb = event === 'APPROVED' ? 'approved' : 'rejected';
      return {
        type: 'APPROVAL_DECIDED',
        title: `${ITEM_NOUN[request.itemType]} ${verb}: ${request.title}`.slice(
          0,
          200,
        ),
        body: request.comment ? `Note: ${request.comment}` : null,
      };
    }
  }
}

/** Can this be decided by replying in chat? */
export function chatReplyable(
  request: Pick<ApprovalRequest, 'itemType'>,
  event: ApprovalNoticeEvent,
): boolean {
  return event === 'REQUESTED' || event === 'REMINDER';
}

export function chatBody(
  text: NoticeText,
  link: string | null,
  replyable: boolean,
): string {
  const lines = [text.title];
  if (text.body) lines.push(text.body);
  if (replyable) lines.push('Reply YES to approve, or NO to reject.');
  if (link) lines.push(link);
  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function emailFor(
  text: NoticeText,
  link: string | null,
): { subject: string; html: string; text: string } {
  const plain = [text.title, text.body, link ? `Open in Kerf: ${link}` : null]
    .filter(Boolean)
    .join('\n\n');
  const html =
    `<p><strong>${escapeHtml(text.title)}</strong></p>` +
    (text.body ? `<p>${escapeHtml(text.body)}</p>` : '') +
    (link ? `<p><a href="${escapeHtml(link)}">Open in Kerf</a></p>` : '');
  return { subject: text.title, html, text: plain };
}
