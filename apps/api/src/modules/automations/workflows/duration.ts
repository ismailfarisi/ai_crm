// Sandbox-safe: no imports. Used by workflow code and the run-record activities.
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  sec: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

/** "3 days", "24h", "90s", "1500" (ms) to milliseconds; null when unparseable. */
export function durationToMs(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(value);
  if (!match) return null;
  const unit = match[2].toLowerCase();
  const factor = unit === '' ? 1 : UNIT_MS[unit];
  if (factor === undefined) return null;
  return Math.round(Number(match[1]) * factor);
}
