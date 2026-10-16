import type { StatementLineDto } from '@saas/shared';

export interface NestedLine {
  line: StatementLineDto;
  depth: number;
  /** Set on a parent that has children: its own amount plus theirs. */
  subtotal?: number;
  /** Marks the row that closes a group, rendered as "Total {name}". */
  isSubtotalRow?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Orders statement lines so each child follows its parent, and works out the
 * group subtotal. A child whose parent is not on the statement is treated as
 * a top-level line, so nothing is ever dropped.
 */
export function nestStatementLines(lines: StatementLineDto[]): NestedLine[] {
  const ids = new Set(lines.map((l) => l.ledgerAccountId));
  const byParent = new Map<string | null, StatementLineDto[]>();
  for (const l of lines) {
    const key = l.parentId && ids.has(l.parentId) && l.parentId !== l.ledgerAccountId ? l.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), l]);
  }

  const out: NestedLine[] = [];
  const seen = new Set<string>();
  const total = (l: StatementLineDto): number =>
    round2(l.amount + (byParent.get(l.ledgerAccountId) ?? []).reduce((s, k) => s + total(k), 0));

  const walk = (line: StatementLineDto, depth: number) => {
    if (seen.has(line.ledgerAccountId)) return;
    seen.add(line.ledgerAccountId);
    const kids = byParent.get(line.ledgerAccountId) ?? [];
    out.push({ line, depth, subtotal: kids.length ? total(line) : undefined });
    for (const k of kids) walk(k, depth + 1);
    if (kids.length) out.push({ line, depth, subtotal: total(line), isSubtotalRow: true });
  };
  for (const top of byParent.get(null) ?? []) walk(top, 0);
  return out;
}
