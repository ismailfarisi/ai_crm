import { describe, expect, it } from 'vitest';
import { fromDraft, toDraft } from './notification-preferences-view';

describe('notification preferences form', () => {
  it('round-trips a saved choice', () => {
    const saved = {
      approvalChannels: ['BELL', 'CHAT'] as const,
      outcomeChannels: ['EMAIL'] as const,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      timezone: 'Asia/Dubai',
    };
    const prefs = { ...saved, approvalChannels: [...saved.approvalChannels], outcomeChannels: [...saved.outcomeChannels] };
    expect(fromDraft(toDraft(prefs))).toEqual(prefs);
  });

  it('sends no quiet hours when they are switched off', () => {
    const draft = toDraft({
      approvalChannels: ['BELL'],
      outcomeChannels: ['BELL'],
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: null,
    });
    expect(draft.quiet).toBe(false);
    expect(fromDraft(draft)).toMatchObject({ quietHoursStart: null, quietHoursEnd: null, timezone: null });
  });

  it('keeps channels in a stable order however they were ticked', () => {
    const draft = { ...toDraft({ approvalChannels: [], outcomeChannels: [], quietHoursStart: null, quietHoursEnd: null, timezone: null }), approvalChannels: ['CHAT', 'BELL'] as ('BELL' | 'EMAIL' | 'CHAT')[] };
    expect(fromDraft(draft).approvalChannels).toEqual(['BELL', 'CHAT']);
  });
});
