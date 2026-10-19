import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

const saved = {
  id: 's1',
  periodFrequency: 'QUARTERLY' as const,
  firstPeriodStart: '2026-02-01',
  registrationDate: '2026-01-15',
  vatStartDate: '2026-05-01',
  taxAgentName: null,
  taxAgencyName: null,
  tan: null,
  taan: null,
};

const valueOf = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

describe('VatSettingsCard', () => {
  beforeEach(() => {
    mockSave.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
    mockCan.mockReturnValue(true);
    // 19 Oct 2026, 22:00 in Dubai.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T18:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists what is missing, with links, and no form, when UAE mode is off', () => {
    withStatus({ enabled: false, problems: ['Add your 15-digit TRN'], settings: null, suggestedVatStartDate: null });
    render(<VatSettingsCard />);

    expect(screen.getByText('Add your 15-digit TRN')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Company settings' }).getAttribute('href')).toBe('/settings/company');
    expect(screen.getByRole('link', { name: 'Branches' }).getAttribute('href')).toBe('/settings/branches');
    expect(screen.queryByLabelText('VAT start date')).toBeNull();
  });

  it('suggests a start date at first-time setup from the periods typed, until the user picks one', () => {
    // What the API really sends before anything is saved: no suggestion.
    withStatus({ enabled: true, problems: [], settings: null, suggestedVatStartDate: null });
    render(<VatSettingsCard />);
    expect(valueOf('VAT start date')).toBe('');

    fireEvent.change(screen.getByLabelText('First tax period starts'), { target: { value: '2026-02-01' } });
    // Quarters from February: the one after today (Aug-Oct) starts 1 Nov.
    expect(valueOf('VAT start date')).toBe('2026-11-01');

    fireEvent.change(screen.getByLabelText('Return frequency'), { target: { value: 'MONTHLY' } });
    expect(valueOf('VAT start date')).toBe('2026-11-01');
    fireEvent.change(screen.getByLabelText('First tax period starts'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Return frequency'), { target: { value: 'QUARTERLY' } });
    expect(valueOf('VAT start date')).toBe('2027-01-01');

    fireEvent.change(screen.getByLabelText('VAT start date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('First tax period starts'), { target: { value: '2026-02-01' } });
    expect(valueOf('VAT start date')).toBe('2026-10-01');
  });

  it('shows the saved settings as they are', () => {
    withStatus({ enabled: true, problems: [], settings: saved, suggestedVatStartDate: '2026-11-01' });
    render(<VatSettingsCard />);

    expect(valueOf('First tax period starts')).toBe('2026-02-01');
    expect(valueOf('VAT start date')).toBe('2026-05-01');
    expect(
      screen.getByText('Kerf prepares returns from this period on. Earlier periods are treated as filed outside Kerf.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save VAT settings' })).toBeTruthy();
  });

  it('still lists what needs attention once UAE mode is on, above the form', () => {
    withStatus({ enabled: true, problems: ['Set the emirate of your head office'], settings: saved, suggestedVatStartDate: '2026-11-01' });
    render(<VatSettingsCard />);

    expect(screen.getByText('Set the emirate of your head office')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Branches' }).getAttribute('href')).toBe('/settings/branches');
    expect(screen.getByLabelText('VAT start date')).toBeTruthy();
  });

  it('is read-only without tax:manage', () => {
    mockCan.mockReturnValue(false);
    withStatus({ enabled: true, problems: [], settings: null, suggestedVatStartDate: null });
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
