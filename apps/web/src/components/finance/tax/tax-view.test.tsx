import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TaxCodeDto, TaxRuleDto } from '@saas/shared';
import { TaxView } from './tax-view';
import { useTaxCodes, useTaxReport, useTaxRules, useTaxSettingsAction, useUaeVatStatus } from '@/hooks/use-credits';
import { useOrganization } from '@/hooks/use-organization';
import { useCan } from '@/lib/session-context';

vi.mock('@/hooks/use-credits', () => ({
  useTaxCodes: vi.fn(),
  useTaxRules: vi.fn(),
  useTaxReport: vi.fn(),
  useTaxSettingsAction: vi.fn(),
  useUaeVatStatus: vi.fn(),
}));
vi.mock('@/hooks/use-organization', () => ({ useOrganization: vi.fn() }));
vi.mock('@/lib/session-context', () => ({ useCan: vi.fn() }));
vi.mock('../finance-nav', () => ({ FinanceNav: () => null }));
vi.mock('./vat-settings-card', () => ({ VatSettingsCard: () => null }));
vi.mock('./vat-return-card', () => ({ VatReturnCard: () => null }));

const code = (over: Partial<TaxCodeDto>): TaxCodeDto => ({
  id: 'zero-s',
  code: 'ZERO',
  name: 'No tax (0%)',
  rate: 0,
  kind: 'SALES',
  isReverseCharge: false,
  treatment: null,
  ledgerAccountId: null,
  isActive: true,
  ...over,
});

const mutate = vi.fn();
const mutateAsync = vi.fn();

function setup({ uae, codes, rules = [] }: { uae: boolean; codes: TaxCodeDto[]; rules?: TaxRuleDto[] }) {
  vi.mocked(useTaxCodes).mockReturnValue({ data: codes } as never);
  vi.mocked(useTaxRules).mockReturnValue({ data: rules } as never);
  vi.mocked(useTaxReport).mockReturnValue({ data: undefined, isError: false } as never);
  vi.mocked(useTaxSettingsAction).mockReturnValue({ mutate, mutateAsync, isPending: false } as never);
  vi.mocked(useUaeVatStatus).mockReturnValue({ data: { enabled: uae } } as never);
  vi.mocked(useOrganization).mockReturnValue({ data: { country: uae ? 'AE' : 'GB' } } as never);
  return render(<TaxView />);
}

describe('TaxView', () => {
  beforeEach(() => {
    mutate.mockReset();
    mutateAsync.mockReset().mockResolvedValue(undefined);
    vi.mocked(useCan).mockReturnValue(true);
  });

  it('lets a UAE manager treat an existing code once confirmed, sending the whole code back', async () => {
    setup({ uae: true, codes: [code({})] });
    const select = screen.getByLabelText('Treatment for ZERO (sales)') as HTMLSelectElement;
    // Only treatments that keep the code at 0%.
    const options = [...select.options].map((o) => o.value);
    expect(options).toEqual(['', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE']);

    fireEvent.change(select, { target: { value: 'ZERO_RATED' } });
    // Nothing is saved on change: the dialog says what moves on the return first.
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: "Treat 'No tax (0%)' as zero rated?" });
    expect(dialog).toHaveTextContent('Sales on it go onto the VAT return in box 4. Sales already raised on ZERO move too.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change treatment' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      kind: 'updateCode',
      id: 'zero-s',
      input: {
        code: 'ZERO',
        name: 'No tax (0%)',
        rate: 0,
        kind: 'SALES',
        isReverseCharge: false,
        ledgerAccountId: null,
        isActive: true,
        treatment: 'ZERO_RATED',
      },
    });
  });

  it('shows a self-assessed purchase reverse charge with its rate, and hides the checkbox in UAE mode', () => {
    setup({
      uae: true,
      codes: [code({ id: 'rc', code: 'RC', kind: 'PURCHASE', rate: 5, isReverseCharge: true, treatment: 'REVERSE_CHARGE' })],
    });
    expect(screen.getByText('purchase · 5% reverse charge')).toBeTruthy();
    expect(screen.queryByText(/Reverse charge — charged at 0%/)).toBeNull();
  });

  it('is unchanged outside UAE mode: no treatment controls, reverse-charge checkbox kept', () => {
    setup({ uae: false, codes: [code({ id: 'rc', code: 'RC', isReverseCharge: true })] });
    expect(screen.queryByLabelText(/^Treatment/)).toBeNull();
    expect(screen.getByText('sales · reverse charge')).toBeTruthy();
    expect(screen.getByText(/Reverse charge — charged at 0%/)).toBeTruthy();
  });

  it('names the boxes a change moves sales between', () => {
    setup({ uae: true, codes: [code({ name: 'Zero rated', treatment: 'ZERO_RATED' })] });
    fireEvent.change(screen.getByLabelText('Treatment for ZERO (sales)'), { target: { value: 'EXEMPT' } });
    const dialog = screen.getByRole('dialog', { name: "Treat 'Zero rated' as exempt?" });
    expect(dialog).toHaveTextContent('Sales on it move from box 4 to box 5 on the VAT return.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('asks before removing a rule, and removes it only on confirm', async () => {
    setup({
      uae: false,
      codes: [code({ id: 'std', code: 'SR', name: 'Standard rate', rate: 5 })],
      rules: [{ id: 'r1', kind: 'SALES', country: 'AE', requiresTaxId: false, taxCodeId: 'std', priority: 0 }],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove the rule for customers in ae' }));
    expect(mutateAsync).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Remove this rule?' });
    expect(dialog).toHaveTextContent('Customers in AE will no longer get SR chosen for them.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove rule' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ kind: 'deleteRule', id: 'r1' }));
  });

  it('suggests the UAE rate in the new-code form', () => {
    setup({ uae: false, codes: [] });
    expect(screen.getByLabelText('Rate %')).toHaveAttribute('placeholder', '5');
  });
});
