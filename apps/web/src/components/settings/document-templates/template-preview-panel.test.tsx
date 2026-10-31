import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_DOCUMENT_TEMPLATE_CONFIG, type DocumentTemplateConfig } from '@saas/shared';
import { TemplatePreviewPanel, sampleTotals, lineNet } from './template-preview-panel';

const withTotals = (totals: Partial<DocumentTemplateConfig['totals']>): DocumentTemplateConfig => ({
  ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  totals: { ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.totals, ...totals },
});

const totalsText = () => screen.getByTestId('template-totals').textContent ?? '';

describe('TemplatePreviewPanel', () => {
  it('works the totals out once from the rows', () => {
    const totals = sampleTotals([
      { code: 'A', description: 'A', quantity: 5000, unitPrice: 4.6, discount: 0, taxRate: 5 },
      { code: 'B', description: 'B', quantity: 5000, unitPrice: 0.4, discount: 5, taxRate: 5 },
    ]);
    expect(totals).toMatchObject({ gross: 25000, net: 24900, discounts: 100, tax: 1245, total: 26145 });
    expect(lineNet({ code: 'B', description: 'B', quantity: 5000, unitPrice: 0.4, discount: 5, taxRate: 5 })).toBe(1900);
  });

  it('shows the Al Noor invoice in AED with 5% VAT, and the page adds up', () => {
    render(<TemplatePreviewPanel config={DEFAULT_DOCUMENT_TEMPLATE_CONFIG} />);
    const paper = screen.getByTestId('template-paper');

    expect(within(paper).getByText('Al Noor Sweets')).toBeInTheDocument();
    expect(within(paper).getByText(/Sharjah, UAE/)).toBeInTheDocument();
    expect(within(paper).getAllByText(/^TRN \d{15}$/).length).toBeGreaterThan(0);
    // The sleeve line already carries its 5% discount.
    expect(within(paper).getByText(/1,900\.00/)).toBeInTheDocument();

    const text = totalsText();
    expect(text).toMatch(/Subtotal:AED\s29,250\.00/);
    expect(text).toMatch(/Discount:-AED\s100\.00/);
    expect(text).toMatch(/VAT \(5%\):AED\s1,457\.50/);
    expect(text).toMatch(/Total:AED\s30,607\.50/);
    expect(text).toMatch(/Balance due:AED\s15,607\.50/);
    expect(paper.textContent).not.toMatch(/\$|Austin|Estimated Tax/);
  });

  it('shows the subtotal after discounts when the Discount row is hidden', () => {
    render(<TemplatePreviewPanel config={withTotals({ showDiscountTotal: false })} />);
    const text = totalsText();
    expect(text).toMatch(/Subtotal:AED\s29,150\.00/);
    expect(text).not.toMatch(/Discount/);
    expect(text).toMatch(/Total:AED\s30,607\.50/);
  });

  it('leaves payments off a quote', () => {
    render(<TemplatePreviewPanel config={DEFAULT_DOCUMENT_TEMPLATE_CONFIG} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
    const text = totalsText();
    expect(text).toMatch(/Total:AED\s30,607\.50/);
    expect(text).not.toMatch(/Balance due|Amount paid/);
  });

  it('draws a statement whose balance and ageing agree', () => {
    render(<TemplatePreviewPanel config={DEFAULT_DOCUMENT_TEMPLATE_CONFIG} />);
    fireEvent.click(screen.getByRole('button', { name: 'Statement' }));
    const paper = screen.getByTestId('template-paper').textContent ?? '';
    // 4,200.00 opening + 30,607.50 invoiced - 15,000.00 paid.
    expect(paper).toMatch(/Closing balance: AED\s19,807\.50/);
    expect(paper).toMatch(/CurrentAED\s15,607\.50/);
    expect(paper).toMatch(/1–30 daysAED\s4,200\.00/);
  });
});
