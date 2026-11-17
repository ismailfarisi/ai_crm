import { describe, expect, it } from 'vitest';
import { userNotificationPreferencesSchema } from './preferences';

describe('userNotificationPreferencesSchema', () => {
  const base = {
    approvalChannels: ['BELL'],
    outcomeChannels: ['BELL'],
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
  };

  it('accepts a real time zone', () => {
    expect(
      userNotificationPreferencesSchema.safeParse({ ...base, timezone: 'Asia/Dubai' })
        .success,
    ).toBe(true);
  });

  it('rejects a time zone that does not exist', () => {
    expect(
      userNotificationPreferencesSchema.safeParse({ ...base, timezone: 'Mars/Olympus' })
        .success,
    ).toBe(false);
  });
});
