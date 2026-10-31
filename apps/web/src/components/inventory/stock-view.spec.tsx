import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StockView } from './stock-view';

const item = {
  id: 'i1',
  materialId: 'm1',
  materialName: '350gsm folding boxboard',
  materialSku: 'FBB-350',
  uom: 'SHEET',
  locationId: 'loc1',
  locationName: 'Main',
  qtyOnHand: 12000,
  qtyReserved: 0,
  qtyOnOrder: 0,
  avgUnitCost: 0.42,
  reorderPoint: null,
  reorderQty: null,
};

vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: () => true }),
  useCan: () => true,
}));
vi.mock('@/hooks/use-inventory', () => ({
  useStock: () => ({ data: [item], isPending: false, isError: false }),
  useReorderSuggestions: () => ({ data: [] }),
}));
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ data: { baseCurrency: 'AED' } }),
}));
vi.mock('./stock-actions-dialog', () => ({ StockActionsDialog: () => null }));
vi.mock('./opening-stock-dialog', () => ({ OpeningStockDialog: () => null }));

describe('StockView', () => {
  it('values stock in the base currency, with thousands separators', () => {
    render(<StockView />);

    expect(screen.getByText(/valued at AED 5,040\.00 at moving-average cost/)).toBeInTheDocument();
    expect(screen.getAllByText('AED 5,040.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('5040.00')).not.toBeInTheDocument();
  });
});
