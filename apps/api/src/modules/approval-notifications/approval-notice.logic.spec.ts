import {
  channelsFor,
  chatBody,
  effectivePreferences,
  orgDefaultFrom,
  quietUntil,
} from './approval-notice.logic';
import type { NotificationPreference } from './entities/notification-preference.entity';

const row = (over: Partial<NotificationPreference>): NotificationPreference =>
  ({
    approvalChannels: ['BELL'],
    outcomeChannels: ['CHAT'],
    quietHoursStart: null,
    quietHoursEnd: null,
    timezone: null,
    reminderDelayMinutes: null,
    ...over,
  }) as NotificationPreference;

describe('approval notice preferences', () => {
  it('defaults to bell and email for both, with a four-hour reminder', () => {
    expect(orgDefaultFrom(null)).toEqual({
      approvalChannels: ['BELL', 'EMAIL'],
      outcomeChannels: ['BELL', 'EMAIL'],
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: null,
      reminderDelayMinutes: 240,
    });
  });

  it('uses the organisation default until the user makes their own choice', () => {
    const org = row({
      userId: null,
      approvalChannels: ['EMAIL'],
      outcomeChannels: ['EMAIL'],
    });
    expect(effectivePreferences(null, org).approvalChannels).toEqual(['EMAIL']);
    const own = row({ userId: 'u1', approvalChannels: ['CHAT'] });
    expect(effectivePreferences(own, org).approvalChannels).toEqual(['CHAT']);
  });

  it('picks approval channels for requests and reminders, outcome channels for decisions', () => {
    const prefs = effectivePreferences(row({ userId: 'u1' }), null);
    expect(channelsFor(prefs, 'REQUESTED')).toEqual(['BELL']);
    expect(channelsFor(prefs, 'REMINDER')).toEqual(['BELL']);
    expect(channelsFor(prefs, 'APPROVED')).toEqual(['CHAT']);
    expect(channelsFor(prefs, 'REJECTED')).toEqual(['CHAT']);
  });
});

describe('quietUntil', () => {
  const quiet = {
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    timezone: 'Asia/Dubai',
  };

  it('is null with no quiet hours', () => {
    expect(
      quietUntil(
        { quietHoursStart: null, quietHoursEnd: null, timezone: null },
        new Date(),
      ),
    ).toBeNull();
  });

  it('holds a message sent at 23:30 Dubai time until 07:00 across midnight', () => {
    const now = new Date('2026-11-17T19:30:00Z'); // 23:30 in Dubai
    expect(quietUntil(quiet, now)?.toISOString()).toBe(
      '2026-11-18T03:00:00.000Z',
    );
  });

  it('lets a message through outside quiet hours', () => {
    expect(quietUntil(quiet, new Date('2026-11-17T08:00:00Z'))).toBeNull(); // 12:00
  });

  it('handles a same-day window', () => {
    const lunch = {
      quietHoursStart: '13:00',
      quietHoursEnd: '14:00',
      timezone: 'UTC',
    };
    expect(
      quietUntil(lunch, new Date('2026-11-17T13:15:00Z'))?.toISOString(),
    ).toBe('2026-11-17T14:00:00.000Z');
    expect(quietUntil(lunch, new Date('2026-11-17T14:00:00Z'))).toBeNull();
  });
});

describe('chatBody', () => {
  it('asks for a YES/NO reply only on requests and reminders', () => {
    const text = {
      type: 'APPROVAL_REQUESTED' as const,
      title: 'Needs approval: QT-1',
      body: null,
    };
    expect(chatBody(text, 'https://app/q/1', true)).toContain(
      'Reply YES to approve',
    );
    expect(chatBody(text, null, false)).not.toContain('Reply YES');
  });

  it('says to decide in the app when another approval is already open', () => {
    const text = {
      type: 'APPROVAL_REQUESTED' as const,
      title: 'Needs approval: QT-2',
      body: null,
    };
    const body = chatBody(text, 'https://app/q/2', false, true);
    expect(body).not.toContain('Reply YES');
    expect(body).toContain('More than one approval');
  });
});
