/**
 * Waits and time limits as "an amount and a unit". What is saved is the text
 * the engine already understands ("1 day", "3 hours"; see the API's
 * workflows/duration.ts), so nothing changes for runs.
 */
export const DURATION_UNITS = ['seconds', 'minutes', 'hours', 'days', 'weeks'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export interface Duration {
  amount: number;
  unit: DurationUnit;
}

const UNIT_MS: Record<DurationUnit, number> = {
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

const UNIT_ALIASES: Record<string, DurationUnit> = {
  s: 'seconds', sec: 'seconds', second: 'seconds', seconds: 'seconds',
  m: 'minutes', min: 'minutes', minute: 'minutes', minutes: 'minutes',
  h: 'hours', hr: 'hours', hour: 'hours', hours: 'hours',
  d: 'days', day: 'days', days: 'days',
  w: 'weeks', week: 'weeks', weeks: 'weeks',
};

/** Milliseconds as the largest unit that divides them evenly. */
function fromMs(ms: number): Duration {
  for (const unit of [...DURATION_UNITS].reverse()) {
    if (ms >= UNIT_MS[unit] && ms % UNIT_MS[unit] === 0) return { amount: ms / UNIT_MS[unit], unit };
  }
  return { amount: Math.max(1, Math.round(ms / 1000)), unit: 'seconds' };
}

/** "3 days", "24h", "90s", 5000 or "5000" (milliseconds); null when it is none of those. */
export function parseDuration(value: unknown): Duration | null {
  if (typeof value === 'number' && Number.isFinite(value)) return fromMs(value);
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  if (match[2] === '' || match[2].toLowerCase() === 'ms') return fromMs(amount);
  const unit = UNIT_ALIASES[match[2].toLowerCase()];
  return unit ? { amount, unit } : null;
}

/** "1 day", "3 hours": readable, and what the engine parses. */
export function formatDuration({ amount, unit }: Duration): string {
  return `${amount} ${amount === 1 ? unit.slice(0, -1) : unit}`;
}

const DEFAULT_DELAY: Duration = { amount: 5, unit: 'minutes' };

/**
 * How long a Wait step waits. `delayMinutes` is what older builds saved; the
 * engine never read it, so `normalizeDelayNodes` moves it to `duration`.
 */
export function readDelay(config: Record<string, unknown> | undefined): Duration {
  for (const key of ['durationMs', 'duration', 'delay'] as const) {
    const value = config?.[key];
    if (value == null || (typeof value === 'string' && value.trim() === '')) continue;
    return parseDuration(value) ?? DEFAULT_DELAY;
  }
  const minutes = Number(config?.delayMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? { amount: minutes, unit: 'minutes' } : DEFAULT_DELAY;
}

/** The config keys for a wait: one field, `duration`, and the older ones cleared. */
export function delayConfig(duration: Duration): Record<string, unknown> {
  return { duration: formatDuration(duration), durationMs: undefined, delay: undefined, delayMinutes: undefined };
}

type NodeLike = { type?: string; data?: { config?: Record<string, unknown> } & Record<string, unknown> };

/**
 * A Wait step saved with only `delayMinutes` showed "5 minutes" but waited one
 * second, because the engine reads `duration`. Read it as the wait it showed.
 */
export function normalizeDelayNodes<N extends NodeLike>(nodes: N[]): N[] {
  return nodes.map((node) => {
    const config = node.data?.config;
    if (node.type !== 'delayNode' || !config || !('delayMinutes' in config)) return node;
    const rest = { ...config };
    delete rest.delayMinutes;
    const hasOwn = ['durationMs', 'duration', 'delay'].some((k) => rest[k] != null && rest[k] !== '');
    const next = hasOwn ? rest : { ...rest, duration: formatDuration(readDelay(config)) };
    return { ...node, data: { ...node.data, config: next } };
  });
}
