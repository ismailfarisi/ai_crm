import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BankStatementLineDto, LedgerMovementDto, ReconciliationSuggestion } from '@saas/shared';
import { GroupMatchDialog, SuggestionsPanel } from './reconciliation-matching';
import { useAutoMatch, useCreateBankMatch } from '@/hooks/use-books';

vi.mock('@/hooks/use-books', () => ({ useAutoMatch: vi.fn(), useCreateBankMatch: vi.fn() }));

const line = (id: string, amount: number, description: string): BankStatementLineDto => ({
  id,
  financeAccountId: 'acc-1',
  date: '2026-10-10',
  description,
  amount,
  reference: null,
  status: 'UNMATCHED',
  matchId: null,
  matchedEntries: [],
  matchedLineCount: 0,
  createdAt: '2026-10-10T00:00:00Z',
});

const entry = (id: string, amount: number, description: string): LedgerMovementDto => ({
  journalEntryId: id,
  entryNumber: `JNL-${id}`,
  entryDate: '2026-10-09T00:00:00.000Z',
  referenceType: 'PAYMENT',
  description,
  amount,
});

const lines = [line('L1', 1000, 'CHEQUE DEPOSIT'), line('L2', -61, 'CARD FEE')];
const movements = [entry('E1', 310, 'Receipt Al Noor'), entry('E2', 460, 'Receipt Gulf Board'), entry('E3', 230, 'Receipt Inks'), entry('E4', -61, 'Card fee')];

const suggestions: ReconciliationSuggestion[] = [
  { kind: 'ONE_TO_ONE', lineIds: ['L2'], journalEntryIds: ['E4'], certain: true, score: 0.95, reason: 'The only entry for this amount.' },
  {
    kind: 'ONE_LINE_MANY_ENTRIES',
    lineIds: ['L1'],
    journalEntryIds: ['E1', 'E2', 'E3'],
    certain: false,
    score: 0.6,
    reason: '3 entries add up to this line.',
  },
];

describe('reconciliation matching', () => {
  let create: ReturnType<typeof vi.fn>;
  let auto: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    create = vi.fn();
    auto = vi.fn();
    vi.mocked(useCreateBankMatch).mockReturnValue({ mutate: create, isPending: false, variables: undefined } as never);
    vi.mocked(useAutoMatch).mockReturnValue({ mutate: auto, isPending: false } as never);
  });

  it('lists suggestions with both sides, and accepts one as a whole group', () => {
    render(
      <SuggestionsPanel
        financeAccountId="acc-1"
        suggestions={suggestions}
        lines={lines}
        movements={movements}
        currency="AED"
        base="AED"
        editable
      />,
    );
    expect(screen.getAllByTestId('suggestion')).toHaveLength(2);
    expect(screen.getByText('One deposit, several entries')).toBeInTheDocument();
    expect(screen.getByText(/JNL-E2/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Accept/ })[1]);
    expect(create).toHaveBeenCalledWith({ lineIds: ['L1'], journalEntryIds: ['E1', 'E2', 'E3'] });
  });

  it('applies the certain ones together, and only offers that when there are some', () => {
    const { rerender } = render(
      <SuggestionsPanel financeAccountId="acc-1" suggestions={suggestions} lines={lines} movements={movements} currency="AED" base="AED" editable />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Match 1 certain' }));
    expect(auto).toHaveBeenCalledWith('acc-1');

    rerender(
      <SuggestionsPanel financeAccountId="acc-1" suggestions={[suggestions[1]]} lines={lines} movements={movements} currency="AED" base="AED" editable />,
    );
    expect(screen.queryByRole('button', { name: /certain/ })).not.toBeInTheDocument();
  });

  it('offers no actions to someone who may only look', () => {
    render(
      <SuggestionsPanel financeAccountId="acc-1" suggestions={suggestions} lines={lines} movements={movements} currency="AED" base="AED" editable={false} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lets a group be saved only when its totals agree', () => {
    render(
      <GroupMatchDialog
        startLine={lines[0]}
        lines={lines}
        movements={movements}
        comparable
        currency="AED"
        base="AED"
        onClose={vi.fn()}
      />,
    );
    const save = () => screen.getByRole('button', { name: /^Match \d+ line/ });
    expect(save()).toBeDisabled();

    fireEvent.click(screen.getByLabelText('JNL-E1 Receipt Al Noor'));
    fireEvent.click(screen.getByLabelText('JNL-E2 Receipt Gulf Board'));
    expect(save()).toBeDisabled();
    expect(screen.getByTestId('group-difference').textContent).toMatch(/230/);

    fireEvent.click(screen.getByLabelText('JNL-E3 Receipt Inks'));
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(create).toHaveBeenCalledWith(
      { lineIds: ['L1'], journalEntryIds: ['E1', 'E2', 'E3'] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('does not require agreeing totals when the account is in another currency', () => {
    render(
      <GroupMatchDialog startLine={lines[0]} lines={lines} movements={movements} comparable={false} currency="USD" base="AED" onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText('JNL-E1 Receipt Al Noor'));
    expect(screen.getByRole('button', { name: /^Match \d+ line/ })).toBeEnabled();
  });
});
