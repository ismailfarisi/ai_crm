import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecordAdvanceModal } from './record-advance-modal';
import { SalaryPackageModal } from './salary-package-modal';

vi.mock('@/hooks/use-finance', () => ({
  useFinanceAccounts: () => ({
    data: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Main bank', currency: 'AED' }],
  }),
}));
vi.mock('@/hooks/use-organization', () => ({ useOrganization: () => ({ data: { baseCurrency: 'AED' } }) }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ||= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ||= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

describe('RecordAdvanceModal', () => {
  it('submits without a date and sends no issuedAt', async () => {
    const onSubmit = vi.fn();
    render(<RecordAdvanceModal open onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Paid from'), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    });
    fireEvent.submit(screen.getByTestId('advance-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].issuedAt).toBeUndefined();
    expect(onSubmit.mock.calls[0][0].amount).toBe(500);
  });
});

describe('SalaryPackageModal', () => {
  it('shows an error for an empty allowance label', async () => {
    const onSubmit = vi.fn();
    render(<SalaryPackageModal open onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Basic'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /add allowance/i }));
    fireEvent.submit(screen.getByTestId('salary-package-form'));
    await waitFor(() => expect(screen.getByText(/too small|required|at least/i)).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
