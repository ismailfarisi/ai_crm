import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CatalogItemDto, ProductTemplateDto } from '@saas/shared';
import { CatalogPicker } from './quote-editor/catalog-picker';
import { QuoteMarginCard } from './quote-editor/quote-margin-card';
import { lineMargin, marginStatus } from './quote-editor/margin-status';
import { BlankPreview } from './quote-editor/blank-preview';

const canSeeCost = vi.fn(() => true);

vi.mock('@/lib/session-context', () => ({
  useCan: () => canSeeCost(),
}));

const searchState = {
  items: [] as CatalogItemDto[],
  templates: [] as ProductTemplateDto[],
  isLoading: false,
};

vi.mock('@/hooks/use-catalog', () => ({
  useCatalogSearch: () => searchState,
  useDebounced: (value: unknown) => value,
}));

const ITEM: CatalogItemDto = {
  id: 'item-1',
  sku: 'BOX-MAILER-S',
  name: 'Small mailer box',
  description: null,
  uom: 'Units',
  listPrice: 1.4,
  standardCost: 0.82,
  taxRate: 5,
  leadTimeDays: 7,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const TEMPLATE = {
  id: 'template-1',
  templateKey: 'rigid-box-2pc',
  version: 3,
  isCurrent: true,
  name: 'Rigid gift box',
  description: 'Base and lid',
  currency: 'USD',
  parameters: [],
  derived: [],
  materials: [],
  operations: [],
  tooling: [],
  pricing: { method: 'MARGIN', rate: 0.35, overheadPct: 0.12 },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as ProductTemplateDto;

describe('CatalogPicker', () => {
  beforeEach(() => {
    canSeeCost.mockReturnValue(true);
    searchState.items = [ITEM];
    searchState.templates = [TEMPLATE];
    searchState.isLoading = false;
  });

  it('lists templates and catalog items under their own headings', () => {
    render(<CatalogPicker open onClose={vi.fn()} onChoose={vi.fn()} />);

    expect(screen.getByText('Product templates')).toBeDefined();
    expect(screen.getByText('Catalog items')).toBeDefined();
    expect(screen.getByText('Rigid gift box')).toBeDefined();
    expect(screen.getByText('Small mailer box')).toBeDefined();
  });

  it('marks a template as configurable rather than showing a single price', () => {
    render(<CatalogPicker open onClose={vi.fn()} onChoose={vi.fn()} />);

    expect(screen.getByText('Configure')).toBeDefined();
    // What it is, not its internal key and version.
    expect(screen.getByText('Base and lid')).toBeDefined();
    expect(screen.queryByText(/rigid-box-2pc/)).toBeNull();
  });

  it('shows cost alongside price when the actor may see it', () => {
    render(<CatalogPicker open onClose={vi.fn()} onChoose={vi.fn()} />);
    expect(screen.getByText(/cost \$0\.82/)).toBeDefined();
  });

  it('hides cost when the actor may not', () => {
    canSeeCost.mockReturnValue(false);
    render(<CatalogPicker open onClose={vi.fn()} onChoose={vi.fn()} />);

    expect(screen.queryByText(/cost \$0\.82/)).toBeNull();
    // The customer-facing price is still there.
    expect(screen.getByText('$1.40')).toBeDefined();
  });

  it('returns the chosen row to the caller', () => {
    const onChoose = vi.fn();
    render(<CatalogPicker open onClose={vi.fn()} onChoose={onChoose} />);

    fireEvent.click(screen.getByText('Small mailer box'));
    expect(onChoose).toHaveBeenCalledWith({ kind: 'CATALOG_ITEM', item: ITEM });
  });

  it('picks the highlighted row on Enter', () => {
    const onChoose = vi.fn();
    render(<CatalogPicker open onClose={vi.fn()} onChoose={onChoose} />);

    const search = screen.getByRole('combobox', { name: 'Search the catalog' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });

    // Templates are listed first, so one step down lands on the catalog item.
    expect(onChoose).toHaveBeenCalledWith({ kind: 'CATALOG_ITEM', item: ITEM });
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<CatalogPicker open onClose={onClose} onChoose={vi.fn()} />);

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search the catalog' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  /** Focus stays in the search box, so the highlighted row has to be announced from there. */
  it('points the search box at the highlighted row as the arrows move', () => {
    render(<CatalogPicker open onClose={vi.fn()} onChoose={vi.fn()} />);

    const search = screen.getByRole('combobox', { name: 'Search the catalog' });
    const options = screen.getAllByRole('option');
    expect(search.getAttribute('aria-activedescendant')).toBe(options[0].id);
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(search.getAttribute('aria-activedescendant')).toBe(options[1].id);
    expect(screen.getByRole('group', { name: 'Catalog items' })).toBeDefined();
  });

  it('explains an empty catalog instead of showing a blank list', () => {
    searchState.items = [];
    searchState.templates = [];
    render(<CatalogPicker open onClose={vi.fn()} onChoose={vi.fn()} />);

    expect(screen.getByText('Your catalog is empty')).toBeDefined();
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <CatalogPicker open={false} onClose={vi.fn()} onChoose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('QuoteMarginCard', () => {
  const floor20 = { minMarginPct: 0.2, maxDiscountPct: 20, requireKnownCost: false, enforce: true };
  const healthy = {
    subtotalAmount: 2000,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 2000,
    costAmount: 1200,
    marginAmount: 800,
    marginPct: 0.4,
    hasCompleteCost: true,
  };

  beforeEach(() => canSeeCost.mockReturnValue(true));

  it('shows the margin and its parts', () => {
    render(<QuoteMarginCard totals={healthy} violations={[]} status={marginStatus(healthy, floor20)} />);

    expect(screen.getByText('40.0%')).toBeDefined();
    expect(screen.getByText(/Above 20% floor/)).toBeDefined();
    expect(screen.getByText('$1,200.00')).toBeDefined();
    expect(screen.getByText('$800.00')).toBeDefined();
  });

  /**
   * The API already strips cost for this actor, so every figure would be zero.
   * A card reading "0.0% margin" is worse than no card.
   */
  it('renders nothing without cost rights', () => {
    canSeeCost.mockReturnValue(false);
    const { container } = render(
      <QuoteMarginCard totals={healthy} violations={[]} status={marginStatus(healthy, floor20)} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('warns that margin is an over-estimate when a line has no cost', () => {
    render(
      <QuoteMarginCard
        totals={{ ...healthy, hasCompleteCost: false }}
        violations={[]}
        status={marginStatus(healthy, floor20)}
      />,
    );
    expect(screen.getByText(/over-estimate/)).toBeDefined();
  });

  it('lists policy breaches', () => {
    render(
      <QuoteMarginCard
        totals={{ ...healthy, marginPct: 0.04 }}
        status={marginStatus({ ...healthy, marginPct: 0.04 }, floor20)}
        violations={[
          {
            code: 'MARGIN_BELOW_FLOOR',
            message: 'Margin is 4.0%, below the 20.0% floor',
            actual: 0.04,
            limit: 0.2,
          },
        ]}
      />,
    );

    expect(screen.getByText('Margin is 4.0%, below the 20.0% floor')).toBeDefined();
    expect(screen.getByText(/Below 20% floor/)).toBeDefined();
    expect(screen.getByText('Your margin floor')).toBeDefined();
  });

  /** A loss used to read as a green, healthy margin whenever no floor was configured. */
  it('calls a loss a loss even with no floor set', () => {
    const loss = { ...healthy, costAmount: 2400, marginAmount: -400, marginPct: -0.2 };
    render(<QuoteMarginCard totals={loss} violations={[]} status={marginStatus(loss, undefined)} />);
    expect(screen.getByText(/Loss/)).toBeDefined();
  });
});

describe('marginStatus', () => {
  const policy = { minMarginPct: 0.2, maxDiscountPct: 20, requireKnownCost: false, enforce: true };
  const at = (marginPct: number, subtotalAmount = 1000) => ({ marginPct, subtotalAmount });

  it('reads the margin against the floor', () => {
    expect(marginStatus(at(0.35), policy)).toMatchObject({ tone: 'success', label: 'Above 20% floor' });
    expect(marginStatus(at(0.21), policy)).toMatchObject({ tone: 'warning', label: 'Close to 20% floor' });
    expect(marginStatus(at(0.12), policy)).toMatchObject({ tone: 'danger', label: 'Below 20% floor' });
    expect(marginStatus(at(-0.05), policy)).toMatchObject({ tone: 'danger', label: 'Loss' });
  });

  it('claims no floor the organisation has not switched on', () => {
    const off = { ...policy, enforce: false };
    expect(marginStatus(at(0.35), off)).toMatchObject({ tone: 'neutral', floor: null });
    expect(marginStatus(at(-0.05), off)).toMatchObject({ tone: 'danger', label: 'Loss' });
    expect(marginStatus(at(0, 0), policy)).toMatchObject({ tone: 'neutral', label: 'Not priced yet' });
  });

  /** A percentage before anything is priced, or mid re-cost, is a number nobody should act on. */
  it('shows no figure until there is one to trust', () => {
    expect(marginStatus(at(0, 0), policy).showFigure).toBe(false);
    expect(marginStatus(at(0.35), policy, 0, 1)).toMatchObject({ label: 'Re-costing…', showFigure: false });
    expect(marginStatus(at(0.35), policy).showFigure).toBe(true);
  });
});

describe('lineMargin', () => {
  const line = (subtotal: number, totalCost?: number) => ({
    id: 'l1',
    type: 'product' as const,
    description: 'Rigid box',
    quantity: 500,
    unitPrice: subtotal / 500,
    subtotal,
    ...(totalCost === undefined ? {} : { cost: { unitCost: totalCost / 500, totalCost, source: 'STANDARD' as const } }),
  });

  it('works the margin out on the line itself', () => {
    expect(lineMargin(line(2300, 1590), 0.2)).toMatchObject({ cost: 1590, tone: 'neutral' });
    expect(lineMargin(line(2300, 1590), 0.2)!.marginPct).toBeCloseTo(0.3087, 3);
  });

  it('flags a line below the floor or at a loss', () => {
    expect(lineMargin(line(2000, 1700), 0.2)!.tone).toBe('danger');
    expect(lineMargin(line(1495, 1590), null)!.tone).toBe('danger');
  });

  it('has nothing to say about a line with no cost', () => {
    expect(lineMargin(line(2300), 0.2)).toBeNull();
  });
});

describe('BlankPreview', () => {
  it('derives the flat blank from the box dimensions', () => {
    render(<BlankPreview lengthMm={200} widthMm={150} heightMm={80} />);

    // width + 2*height + 4*thickness = 150 + 160 + 8 = 318
    // length + 2*height + 4*thickness = 200 + 160 + 8 = 368
    expect(screen.getByText('318 × 368 mm')).toBeDefined();
    expect(screen.getByText('200 × 150 × 80 mm')).toBeDefined();
  });

  it('renders nothing for dimensions that make no sense', () => {
    const { container } = render(<BlankPreview lengthMm={0} widthMm={0} heightMm={0} />);
    expect(container.firstChild).toBeNull();
  });
});
