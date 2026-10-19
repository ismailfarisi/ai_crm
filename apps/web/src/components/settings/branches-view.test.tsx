import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BranchesView } from './branches-view';

const saveBranch = vi.fn(async () => undefined);
vi.mock('@/hooks/use-organization', () => ({
  useBranches: () => ({
    isPending: false,
    data: [
      {
        id: 'b1',
        name: 'Head office',
        addressLine1: null,
        addressLine2: null,
        city: 'Dubai',
        emirate: 'DXB',
        isHeadOffice: true,
        invoicePrefix: null,
        isActive: true,
      },
    ],
  }),
  useSaveBranch: () => ({ mutateAsync: saveBranch, isPending: false }),
}));
vi.mock('@/lib/session-context', () => ({ useCan: () => true }));

describe('BranchesView', () => {
  it('clears the emirate when the empty option is chosen', async () => {
    render(<BranchesView />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Emirate'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save branch' }));

    await waitFor(() => expect(saveBranch).toHaveBeenCalled());
    expect(saveBranch).toHaveBeenCalledWith({
      id: 'b1',
      payload: expect.objectContaining({ emirate: null }),
    });
  });
});
