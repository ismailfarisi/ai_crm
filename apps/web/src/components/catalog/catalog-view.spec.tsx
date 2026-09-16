import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CatalogItemDto, MaterialDto } from '@saas/shared';
import { CatalogView } from './catalog-view';
import {
  useCatalogItems,
  useDeleteCatalogItem,
  useDeleteMaterial,
  useDeleteTooling,
  useDeleteWorkCenter,
  useMaterials,
  useTooling,
  useWorkCenters,
} from '@/hooks/use-catalog-admin';

vi.mock('@/hooks/use-catalog-admin', () => ({
  useCatalogItems: vi.fn(),
  useMaterials: vi.fn(),
  useWorkCenters: vi.fn(),
  useTooling: vi.fn(),
  useDeleteCatalogItem: vi.fn(),
  useDeleteMaterial: vi.fn(),
  useDeleteWorkCenter: vi.fn(),
  useDeleteTooling: vi.fn(),
}));

// The "New …" button is gated on catalog:manage, which PageGuard already
// enforces before this component renders at all.
vi.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The form dialogs each pull in react-hook-form and a zod resolver; what
// matters here is the table and the tabs, not their internals.
vi.mock('./catalog-item-form-dialog', () => ({
  CatalogItemFormDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="item-dialog" /> : null,
}));
vi.mock('./material-form-dialog', () => ({
  MaterialFormDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="material-dialog" /> : null,
}));
vi.mock('./work-center-form-dialog', () => ({
  WorkCenterFormDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="work-center-dialog" /> : null,
}));
vi.mock('./tooling-form-dialog', () => ({
  ToolingFormDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="tooling-dialog" /> : null,
}));

const item: CatalogItemDto = {
  id: 'item-1',
  sku: 'BOX-200',
  name: 'Rigid gift box 200×150×80',
  description: null,
  uom: 'Units',
  listPrice: 3.7,
  standardCost: 2.22,
  taxRate: 0,
  leadTimeDays: 10,
  isActive: true,
  createdAt: '2026-09-16T00:00:00Z',
  updatedAt: '2026-09-16T00:00:00Z',
};

const material: MaterialDto = {
  id: 'mat-1',
  sku: 'FBB-350',
  name: '350gsm folding boxboard',
  uom: 'SHEET',
  costPerUom: 0.42,
  sheetWidthMm: 700,
  sheetHeightMm: 1000,
  grain: 'LENGTH',
  wastePct: 0.05,
  isActive: true,
  createdAt: '2026-09-16T00:00:00Z',
  updatedAt: '2026-09-16T00:00:00Z',
};

function listResult<T>(data: T[]) {
  return { data, isPending: false, isError: false, error: null } as never;
}

describe('CatalogView', () => {
  beforeEach(() => {
    vi.mocked(useCatalogItems).mockReturnValue(listResult([item]));
    vi.mocked(useMaterials).mockReturnValue(listResult([material]));
    vi.mocked(useWorkCenters).mockReturnValue(listResult([]));
    vi.mocked(useTooling).mockReturnValue(listResult([]));

    for (const hook of [
      useDeleteCatalogItem,
      useDeleteMaterial,
      useDeleteWorkCenter,
      useDeleteTooling,
    ]) {
      vi.mocked(hook).mockReturnValue({
        mutateAsync: vi.fn().mockResolvedValue(undefined),
        isPending: false,
      } as never);
    }
  });

  it('lists products with the margin their cost implies', () => {
    render(<CatalogView />);

    expect(screen.getByText('Rigid gift box 200×150×80')).toBeInTheDocument();
    expect(screen.getByText('$3.70')).toBeInTheDocument();
    // (3.70 - 2.22) / 3.70 = 40%
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('switches to materials and shows the sheet size the nesting engine needs', () => {
    render(<CatalogView />);

    fireEvent.click(screen.getByRole('button', { name: /materials/i }));

    expect(screen.getByText('350gsm folding boxboard')).toBeInTheDocument();
    expect(screen.getByText('700 × 1000 mm')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
  });

  it('opens the right form for the tab in view', () => {
    render(<CatalogView />);

    fireEvent.click(screen.getByRole('button', { name: /^new product$/i }));
    expect(screen.getByTestId('item-dialog')).toBeInTheDocument();
  });

  it('tells an empty work centre list what work centres are for', () => {
    render(<CatalogView />);

    fireEvent.click(screen.getByRole('button', { name: /work centres/i }));

    expect(screen.getByText('No work centres yet')).toBeInTheDocument();
  });
});
