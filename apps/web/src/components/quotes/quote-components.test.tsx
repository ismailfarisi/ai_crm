import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuoteStatusPipeline } from './quote-status-pipeline';
import { QuoteLinesTable } from './quote-editor/quote-lines-table';
import { QuoteTotalsCard } from './quote-editor/quote-totals-card';
import { QuoteTabsSection } from './quote-editor/quote-tabs-section';
import type { QuoteLineItem } from '@saas/shared';

describe('QuoteStatusPipeline', () => {
  it('renders all pipeline stages for DRAFT', () => {
    render(<QuoteStatusPipeline status="DRAFT" />);
    expect(screen.getByText('Quotation (Draft)')).toBeDefined();
    expect(screen.getByText('Awaiting Approval')).toBeDefined();
    expect(screen.getByText('Quotation Confirmed')).toBeDefined();
  });

  it('renders rejected badge when status is REJECTED', () => {
    render(<QuoteStatusPipeline status="REJECTED" />);
    expect(screen.getByText(/Rejected \/ Revision Needed/i)).toBeDefined();
  });
});

describe('QuoteLinesTable', () => {
  const sampleItems: QuoteLineItem[] = [
    {
      id: 'sec-1',
      type: 'section',
      description: 'Phase 1: Architecture',
    },
    {
      id: 'prod-1',
      type: 'product',
      description: 'System Setup',
      quantity: 2,
      uom: 'Units',
      unitPrice: 500,
      discount: 10,
      taxRate: 5,
      subtotal: 900,
    },
    {
      id: 'note-1',
      type: 'note',
      description: 'Standard SLA applies',
    },
  ];

  it('renders sections, products, and notes', () => {
    const handleChange = vi.fn();
    render(<QuoteLinesTable items={sampleItems} onChange={handleChange} currency="USD" />);

    expect(screen.getByDisplayValue('Phase 1: Architecture')).toBeDefined();
    expect(screen.getByDisplayValue('System Setup')).toBeDefined();
    expect(screen.getByDisplayValue('Standard SLA applies')).toBeDefined();
    expect(screen.getByText('$900.00')).toBeDefined();
  });

  it('allows adding product, section, and note when not read-only', () => {
    const handleChange = vi.fn();
    render(<QuoteLinesTable items={[]} onChange={handleChange} currency="USD" />);

    const addProductBtn = screen.getByText('Add a product');
    fireEvent.click(addProductBtn);
    expect(handleChange).toHaveBeenCalledTimes(1);

    const addSectionBtn = screen.getByText('Add a section');
    fireEvent.click(addSectionBtn);
    expect(handleChange).toHaveBeenCalledTimes(2);

    const addNoteBtn = screen.getByText('Add a note');
    fireEvent.click(addNoteBtn);
    expect(handleChange).toHaveBeenCalledTimes(3);
  });

  it('hides add buttons when readOnly is true', () => {
    const handleChange = vi.fn();
    render(<QuoteLinesTable items={sampleItems} onChange={handleChange} readOnly={true} />);

    expect(screen.queryByText('Add a product')).toBeNull();
    expect(screen.queryByText('Add a section')).toBeNull();
    expect(screen.queryByText('Add a note')).toBeNull();
  });
});

describe('QuoteTotalsCard', () => {
  it('renders financial summary and totals accurately', () => {
    render(
      <QuoteTotalsCard
        totals={{
          subtotalAmount: 1000,
          discountAmount: 100,
          taxAmount: 50,
          totalAmount: 1050,
        }}
        currency="USD"
      />,
    );

    expect(screen.getByText('Untaxed Amount')).toBeDefined();
    expect(screen.getByText('$1,000.00')).toBeDefined();
    expect(screen.getByText('Total Discount')).toBeDefined();
    expect(screen.getByText('-$100.00')).toBeDefined();
    expect(screen.getByText('Taxes')).toBeDefined();
    expect(screen.getByText('$50.00')).toBeDefined();
    expect(screen.getByText('$1,050.00')).toBeDefined();
  });
});

describe('QuoteTabsSection', () => {
  it('switches between Terms and Notes tabs', () => {
    const handleChangeTerms = vi.fn();
    const handleChangeNotes = vi.fn();

    render(
      <QuoteTabsSection
        termsAndConditions="Custom payment schedule."
        notes="Internal target margin: 40%."
        onChangeTerms={handleChangeTerms}
        onChangeNotes={handleChangeNotes}
      />,
    );

    // Initial tab is Terms
    expect(screen.getByDisplayValue('Custom payment schedule.')).toBeDefined();

    // Click Internal Notes tab
    fireEvent.click(screen.getByText('Internal Notes'));
    expect(screen.getByDisplayValue('Internal target margin: 40%.')).toBeDefined();
  });
});
