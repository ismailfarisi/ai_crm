import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TaxCodeDto } from '@saas/shared';
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

function setup({ uae, codes }: { uae: boolean; codes: TaxCodeDto[] }) {
  vi.mocked(useTaxCodes).mockReturnValue({ data: codes } as never);
  vi.mocked(useTaxRules).mockReturnValue({ data: [] } as never);
  vi.mocked(useTaxReport).mockReturnValue({ data: undefined, isError: false } as never);
  vi.mocked(useTaxSettingsAction).mockReturnValue({ mutate, isPending: false } as never);
  vi.mocked(useUaeVatStatus).mockReturnValue({ data: { enabled: uae } } as never);
  vi.mocked(useOrganization).mockReturnValue({ data: { country: uae ? 'AE' : 'GB' } } as never);
  return render(<TaxView />);
}

describe('TaxView', () => {
  beforeEach(() => {
    mutate.mockReset();
    vi.mocked(useCan).mockReturnValue(true);
  });

  it('lets a UAE manager treat an existing code, sending the whole code back', () => {
    setup({ uae: true, codes: [code({})] });
    const select = screen.getByLabelText('Treatment for ZERO (sales)') as HTMLSelectElement;
    // Only treatments that keep the code at 0%.
    const options = [...select.options].map((o) => o.value);
    expect(options).toEqual(['', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE']);

    fireEvent.change(select, { target: { value: 'ZERO_RATED' } });
    expect(mutate).toHaveBeenCalledWith({
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
});
