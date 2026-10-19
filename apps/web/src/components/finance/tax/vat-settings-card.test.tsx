import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { UaeVatStatusDto } from '@saas/shared';
import { VatSettingsCard } from './vat-settings-card';
import { useSaveVatSettings, useUaeVatStatus } from '@/hooks/use-credits';
import { useCan } from '@/lib/session-context';

vi.mock('@/hooks/use-credits', () => ({
  useUaeVatStatus: vi.fn(),
  useSaveVatSettings: vi.fn(),
}));

vi.mock('@/lib/session-context', () => ({ useCan: vi.fn() }));

const mockStatus = vi.mocked(useUaeVatStatus);
const mockSave = vi.mocked(useSaveVatSettings);
const mockCan = vi.mocked(useCan);

function withStatus(status: UaeVatStatusDto) {
  mockStatus.mockReturnValue({ data: status, isPending: false } as never);
}

describe('VatSettingsCard', () => {
  beforeEach(() => {
    mockSave.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
    mockCan.mockReturnValue(true);
  });

  it('lists what is missing, with links, and no form, when UAE mode is off', () => {
    withStatus({ enabled: false, problems: ['Add your 15-digit TRN'], settings: null, suggestedVatStartDate: null });
    render(<VatSettingsCard />);

    expect(screen.getByText('Add your 15-digit TRN')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Company settings' }).getAttribute('href')).toBe('/settings/company');
    expect(screen.getByRole('link', { name: 'Branches' }).getAttribute('href')).toBe('/settings/branches');
    expect(screen.queryByLabelText('VAT start date')).toBeNull();
  });

  it('shows the form with the suggested start date when UAE mode is on and nothing is saved', () => {
    withStatus({ enabled: true, problems: [], settings: null, suggestedVatStartDate: '2026-11-01' });
    render(<VatSettingsCard />);

    expect((screen.getByLabelText('VAT start date') as HTMLInputElement).value).toBe('2026-11-01');
    expect(
      screen.getByText('Kerf prepares returns from this period on. Earlier periods are treated as filed outside Kerf.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save VAT settings' })).toBeTruthy();
  });

  it('is read-only without tax:manage', () => {
    mockCan.mockReturnValue(false);
    withStatus({ enabled: true, problems: [], settings: null, suggestedVatStartDate: '2026-11-01' });
    render(<VatSettingsCard />);

    expect(screen.getByLabelText('VAT start date').matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save VAT settings' })).toBeNull();
  });

  it('renders nothing while the status loads', () => {
    mockStatus.mockReturnValue({ data: undefined, isPending: true } as never);
    const { container } = render(<VatSettingsCard />);
    expect(container.textContent).toBe('');
  });
});
