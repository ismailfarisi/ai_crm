import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { StarterTemplatePreviewDto } from '@saas/shared';
import { StarterTemplatePicker } from './starter-template-picker';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const mutateAsync = vi.fn();
const starterState = {
  data: [] as StarterTemplatePreviewDto[],
  isPending: false,
  isError: false,
};
vi.mock('@/hooks/use-catalog-admin', () => ({
  useStarterTemplates: () => starterState,
  useInstallStarterTemplate: () => ({ mutateAsync, isPending: false }),
}));

function starter(
  key: string,
  industry: string,
  industryLabel: string,
  name: string,
): StarterTemplatePreviewDto {
  return {
    key,
    industry,
    industryLabel,
    name,
    description: `${name} description`,
    currency: 'AED',
    parameters: [{ key: 'width_mm', label: 'Width', type: 'NUMBER', unit: 'mm' }],
    materials: [
      { label: `${name} board`, name: 'Board', uom: 'SHEET', costPerUom: 10, optional: false },
    ],
    operations: [{ label: `${name} cut`, workCenterName: 'Cutter', optional: false }],
    tooling: [],
    example: {
      quantity: 500,
      parameters: { width_mm: 200 },
      unitCost: 6.05,
      unitPrice: 9.35,
      grandTotal: 4675,
      workingDays: 3,
    },
  };
}

describe('StarterTemplatePicker', () => {
  beforeEach(() => {
    push.mockReset();
    mutateAsync.mockReset();
    starterState.data = [
      starter('rigid-box', 'PACKAGING', 'Packaging', 'Rigid box'),
      starter('rsc-carton', 'PACKAGING', 'Packaging', 'Shipping carton'),
      starter('cabinet-carcass', 'JOINERY', 'Joinery', 'Cabinet'),
    ];
  });

  it('previews the first starter of the first industry with its example price', () => {
    render(<StarterTemplatePicker open onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Rigid box' })).toBeDefined();
    expect(screen.getByText('Rigid box board')).toBeDefined();
    expect(screen.getByText('Rigid box cut')).toBeDefined();
    expect(screen.getByText(/9\.35 each/)).toBeDefined();
    expect(screen.getByText(/Replace them with your own/)).toBeDefined();
  });

  it('switches industry and template', () => {
    render(<StarterTemplatePicker open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('radio', { name: /Shipping carton/ }));
    expect(screen.getByRole('heading', { name: 'Shipping carton' })).toBeDefined();

    fireEvent.click(screen.getByRole('tab', { name: 'Joinery' }));
    expect(screen.getByRole('heading', { name: 'Cabinet' })).toBeDefined();
    // One template in the industry: no choice to make.
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('installs the chosen starter and opens it in the editor', async () => {
    mutateAsync.mockResolvedValue({ id: 'tpl-9', templateKey: 'cabinet-carcass' });
    const onClose = vi.fn();
    render(<StarterTemplatePicker open onClose={onClose} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Joinery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Install template' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/catalog/templates/tpl-9?starter=1'));
    expect(mutateAsync).toHaveBeenCalledWith('cabinet-carcass');
    expect(onClose).toHaveBeenCalled();
  });
});
