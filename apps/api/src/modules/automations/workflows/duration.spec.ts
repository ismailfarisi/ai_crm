import { durationToMs } from './duration';

describe('durationToMs', () => {
  it.each([
    ['3 days', 259200000],
    ['24 hours', 86400000],
    ['1 week', 604800000],
    ['90s', 90000],
    ['1500', 1500],
    ['1.5h', 5400000],
    ['2 MIN', 120000],
  ])('parses %s', (input, ms) => {
    expect(durationToMs(input)).toBe(ms);
  });

  it.each(['soon', '', '3 fortnights', '-5s'])('rejects %p', (input) => {
    expect(durationToMs(input)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(durationToMs(undefined)).toBeNull();
  });
});
