import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { ExpenseClaimDto, ScannedReceiptResult } from '@saas/shared';
import {
  ExpenseStatusBadge,
  ExpenseStatusRibbon,
} from './expense-status-ribbon';
import {
  ReceiptPreviewCard,
  formatExpenseCurrency,
} from './receipt-preview-card';
import { SubmitExpenseModal } from './submit-expense-modal';
import {
  ExpenseClaimsTable,
} from './expense-claims-table';
import { ExpenseSummary } from './expense-summary';
import { ExpenseDetailView } from './expense-detail-view';
import { reimbursementAccount, summariseClaims } from './expense-money';

const mocks = vi.hoisted(() => ({
  baseCurrency: 'USD',
  allowed: true,
  useExpense: vi.fn(),
  accounts: [] as unknown[],
}));

// Polyfill HTMLDialogElement for jsdom if needed
beforeEach(() => {
  if (typeof HTMLDialogElement !== 'undefined') {
    HTMLDialogElement.prototype.showModal =
      HTMLDialogElement.prototype.showModal ||
      function (this: HTMLDialogElement) {
        this.open = true;
      };
    HTMLDialogElement.prototype.close =
      HTMLDialogElement.prototype.close ||
      function (this: HTMLDialogElement) {
        this.open = false;
      };
  }
});

// The modal defaults a claim's currency to the company's base currency.
vi.mock('@/hooks/use-organization', () => ({
  useOrganization: () => ({ data: { baseCurrency: mocks.baseCurrency } }),
}));

// Approve, reject and reimburse sit behind expense:approve.
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({ check: () => mocks.allowed }),
}));

vi.mock('@/hooks/use-finance', () => ({
  useFinanceAccounts: () => ({ data: mocks.accounts }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/platform/attachments-panel', () => ({
  AttachmentsPanel: () => null,
}));
vi.mock('@/components/platform/activity-timeline', () => ({
  ActivityTimeline: () => null,
}));

beforeEach(() => {
  mocks.baseCurrency = 'USD';
  mocks.allowed = true;
  mocks.accounts = [];
  mocks.useExpense.mockReset();
});

// Mock hook useScanReceipt
vi.mock('@/hooks/use-expenses', () => ({
  useExpense: (id: string) => mocks.useExpense(id),
  useReceiptSource: (url?: string | null) => ({ src: url ?? null, isPdf: /\.pdf$/i.test(url ?? ''), isLoading: false }),
  useScanReceipt: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      merchantName: 'Acme Cloud Corp',
      amount: 285.0,
      currency: 'USD',
      expenseDate: '2026-08-15',
      category: 'Software & SaaS',
      confidence: 0.96,
      taxAmount: 23.5,
      rawText: 'ACME CLOUD CORP\nTotal: $285.00\nDate: 2026-08-15',
      items: [
        { description: 'Pro Enterprise Plan', quantity: 1, unitPrice: 240, amount: 240 },
        { description: 'API Add-on', quantity: 1, unitPrice: 45, amount: 45 },
      ],
    }),
    isPending: false,
  }),
}));

const mockClaims: ExpenseClaimDto[] = [
  {
    id: 'exp-1',
    tenantId: 'tenant-1',
    claimNumber: 'EXP-101',
    employeeId: 'emp-1',
    employeeName: 'Sarah Connor',
    category: 'Travel',
    amount: 450.0,
    currency: 'USD',
    status: 'SUBMITTED',
    merchantName: 'Delta Air Lines',
    expenseDate: '2026-08-10',
    receiptUrl: 'https://example.com/receipt1.jpg',
    items: [{ description: 'Flight to SF', quantity: 1, unitPrice: 450, amount: 450 }],
    createdAt: '2026-08-10T10:00:00Z',
    updatedAt: '2026-08-10T10:00:00Z',
  },
  {
    id: 'exp-2',
    tenantId: 'tenant-1',
    claimNumber: 'EXP-102',
    employeeId: 'emp-2',
    employeeName: 'John Doe',
    category: 'Meals & Entertainment',
    amount: 125.5,
    currency: 'USD',
    status: 'APPROVED',
    merchantName: 'Bistro Central',
    expenseDate: '2026-08-12',
    receiptUrl: 'https://example.com/receipt2.png',
    approvedById: 'Manager Alice',
    approvedAt: '2026-08-13T14:30:00Z',
    items: [{ description: 'Client Dinner', quantity: 1, unitPrice: 125.5, amount: 125.5 }],
    createdAt: '2026-08-12T18:00:00Z',
    updatedAt: '2026-08-13T14:30:00Z',
  },
  {
    id: 'exp-3',
    tenantId: 'tenant-1',
    claimNumber: 'EXP-103',
    employeeId: 'emp-3',
    employeeName: 'Emily Watson',
    category: 'Software & SaaS',
    amount: 79.99,
    currency: 'USD',
    status: 'PAID',
    merchantName: 'GitHub Inc',
    expenseDate: '2026-08-01',
    receiptUrl: 'https://example.com/receipt3.pdf',
    approvedById: 'Finance Team',
    approvedAt: '2026-08-02T09:00:00Z',
    reimbursedAt: '2026-08-05T11:00:00Z',
    items: [{ description: 'Copilot Seats', quantity: 1, unitPrice: 79.99, amount: 79.99 }],
    createdAt: '2026-08-01T08:00:00Z',
    updatedAt: '2026-08-05T11:00:00Z',
  },
  {
    id: 'exp-4',
    tenantId: 'tenant-1',
    claimNumber: 'EXP-104',
    employeeId: 'emp-1',
    employeeName: 'Sarah Connor',
    category: 'Office Supplies',
    amount: 320.0,
    currency: 'USD',
    status: 'REJECTED',
    merchantName: 'OfficeMax',
    expenseDate: '2026-08-08',
    receiptUrl: null,
    rejectionReason: 'Missing itemized tax receipt and pre-approval form',
    items: [{ description: 'Desk chair', quantity: 1, unitPrice: 320, amount: 320 }],
    createdAt: '2026-08-08T15:00:00Z',
    updatedAt: '2026-08-09T10:00:00Z',
  },
  {
    id: 'exp-5',
    tenantId: 'tenant-1',
    claimNumber: 'EXP-105',
    employeeId: 'emp-4',
    employeeName: 'Michael Scott',
    category: 'Marketing',
    amount: 600.0,
    currency: 'USD',
    status: 'DRAFT',
    merchantName: 'Google Ads',
    expenseDate: '2026-08-14',
    receiptUrl: null,
    items: [{ description: 'Search Campaigns', quantity: 1, unitPrice: 600, amount: 600 }],
    createdAt: '2026-08-14T12:00:00Z',
    updatedAt: '2026-08-14T12:00:00Z',
  },
];

describe('ExpenseStatusBadge Component', () => {
  it('renders DRAFT status badge', () => {
    render(<ExpenseStatusBadge status="DRAFT" />);
    expect(screen.getByTestId('status-badge-draft')).toHaveTextContent('Draft');
  });

  it('renders SUBMITTED status badge', () => {
    render(<ExpenseStatusBadge status="SUBMITTED" />);
    expect(screen.getByTestId('status-badge-submitted')).toHaveTextContent('Submitted');
  });

  it('renders APPROVED status badge', () => {
    render(<ExpenseStatusBadge status="APPROVED" />);
    expect(screen.getByTestId('status-badge-approved')).toHaveTextContent('Approved');
  });

  it('renders PAID status badge', () => {
    render(<ExpenseStatusBadge status="PAID" />);
    expect(screen.getByTestId('status-badge-paid')).toHaveTextContent('Paid');
  });

  it('renders REJECTED status badge', () => {
    render(<ExpenseStatusBadge status="REJECTED" />);
    expect(screen.getByTestId('status-badge-rejected')).toHaveTextContent('Rejected');
  });
});

describe('ExpenseStatusRibbon Component', () => {
  it('renders step pipeline correctly for SUBMITTED claim', () => {
    render(<ExpenseStatusRibbon status="SUBMITTED" claim={mockClaims[0]} />);

    expect(screen.getByTestId('expense-status-ribbon')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-step-draft')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-step-submitted')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-step-approved')).toBeInTheDocument();
    expect(screen.getByTestId('ribbon-step-paid')).toBeInTheDocument();
  });

  it('renders approval banner with manager actor when APPROVED', () => {
    render(
      <ExpenseStatusRibbon
        status="APPROVED"
        claim={mockClaims[1]}
        approvedBy="Manager Alice"
        approvedAt="2026-08-13T14:30:00Z"
      />,
    );

    expect(screen.getByTestId('approval-info-banner')).toBeInTheDocument();
    expect(screen.getByText('Manager Alice')).toBeInTheDocument();
  });

  it('renders reimbursement banner when status is PAID', () => {
    render(
      <ExpenseStatusRibbon
        status="PAID"
        claim={mockClaims[2]}
        reimbursedAt="2026-08-05T11:00:00Z"
      />,
    );

    expect(screen.getByTestId('reimbursement-info-banner')).toBeInTheDocument();
    expect(screen.getByText(/Reimbursed on/i)).toBeInTheDocument();
  });

  it('renders rejection banner with reason when status is REJECTED', () => {
    render(
      <ExpenseStatusRibbon
        status="REJECTED"
        claim={mockClaims[3]}
        rejectionReason="Missing itemized tax receipt"
      />,
    );

    expect(screen.getByTestId('rejection-info-banner')).toBeInTheDocument();
    expect(screen.getByText(/Missing itemized tax receipt/i)).toBeInTheDocument();
  });

  it('renders compact mode correctly', () => {
    render(
      <ExpenseStatusRibbon
        status="APPROVED"
        approvedBy="Alice"
        compact={true}
      />,
    );

    expect(screen.getByTestId('expense-status-ribbon-compact')).toBeInTheDocument();
    expect(screen.getByText('by Alice')).toBeInTheDocument();
  });
});

describe('ReceiptPreviewCard Component', () => {
  const sampleOcrData: ScannedReceiptResult = {
    merchantName: 'Acme Cloud Corp',
    amount: 285.0,
    currency: 'USD',
    expenseDate: '2026-08-15',
    category: 'Software & SaaS',
    confidence: 0.96,
    taxAmount: 23.5,
    rawText: 'ACME CLOUD CORP\nTotal: $285.00',
    items: [
      { description: 'Pro Enterprise Plan', quantity: 1, unitPrice: 240, amount: 240 },
      { description: 'API Add-on', quantity: 1, unitPrice: 45, amount: 45 },
    ],
  };

  it('renders zoomable receipt image with zoom controls', () => {
    render(
      <ReceiptPreviewCard
        receiptUrl="https://example.com/receipt.jpg"
        merchantName="Acme Corp"
        amount={285.0}
      />,
    );

    expect(screen.getByTestId('receipt-preview-card')).toBeInTheDocument();
    expect(screen.getByTestId('receipt-image')).toHaveAttribute('src', 'https://example.com/receipt.jpg');

    const zoomInBtn = screen.getByTestId('receipt-zoom-in');
    const zoomOutBtn = screen.getByTestId('receipt-zoom-out');
    const resetZoomBtn = screen.getByTestId('receipt-zoom-reset');
    const rotateBtn = screen.getByTestId('receipt-rotate');

    expect(resetZoomBtn).toHaveTextContent('100%');

    // Click Zoom In
    fireEvent.click(zoomInBtn);
    expect(resetZoomBtn).toHaveTextContent('125%');

    // Click Zoom Out
    fireEvent.click(zoomOutBtn);
    expect(resetZoomBtn).toHaveTextContent('100%');

    // Click Rotate
    fireEvent.click(rotateBtn);
    const container = screen.getByTestId('receipt-image-container');
    expect(container).toHaveStyle({ transform: 'scale(1) rotate(90deg)' });
  });

  it('renders OCR metadata panel and confidence score', () => {
    render(
      <ReceiptPreviewCard
        receiptUrl="https://example.com/receipt.jpg"
        ocrData={sampleOcrData}
      />,
    );

    expect(screen.getByTestId('ocr-metadata-panel')).toBeInTheDocument();
    expect(screen.getByTestId('ocr-confidence-badge')).toHaveTextContent('96% AI Match');
    expect(screen.getByText('Acme Cloud Corp')).toBeInTheDocument();
    expect(screen.getByText('Software & SaaS')).toBeInTheDocument();
    expect(screen.getByText('Pro Enterprise Plan')).toBeInTheDocument();
  });

  it('toggles raw OCR text accordion', () => {
    render(
      <ReceiptPreviewCard
        receiptUrl="https://example.com/receipt.jpg"
        ocrData={sampleOcrData}
      />,
    );

    const toggleBtn = screen.getByText('View OCR Raw Text');
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId('ocr-raw-text')).toHaveTextContent('ACME CLOUD CORP');
    expect(screen.getByText('Hide OCR Raw Text')).toBeInTheDocument();
  });

  it('renders clean empty state when no receipt URL is provided', () => {
    const handleUpload = vi.fn();
    render(<ReceiptPreviewCard onUploadNewReceipt={handleUpload} />);

    expect(screen.getByTestId('receipt-empty-state')).toBeInTheDocument();
    expect(screen.getByText('No Receipt Attached')).toBeInTheDocument();

    const uploadBtn = screen.getByText('Upload Receipt');
    fireEvent.click(uploadBtn);
    expect(handleUpload).toHaveBeenCalledTimes(1);
  });

  it('offers a PDF receipt as a link to open, not as an image', () => {
    render(<ReceiptPreviewCard receiptUrl="https://files.example/dewa-october.pdf" />);

    expect(screen.getByTestId('receipt-pdf')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open PDF/ })).toHaveAttribute(
      'href',
      'https://files.example/dewa-october.pdf',
    );
    expect(screen.queryByTestId('receipt-image')).not.toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
  });
});

describe('SubmitExpenseModal Component', () => {
  it('renders all form fields when opened', () => {
    render(
      <SubmitExpenseModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId('submit-expense-form')).toBeInTheDocument();
    expect(screen.getByTestId('input-employee-name')).toBeInTheDocument();
    expect(screen.getByTestId('input-merchant-name')).toBeInTheDocument();
    expect(screen.getByTestId('select-category')).toBeInTheDocument();
    expect(screen.getByTestId('input-expense-date')).toBeInTheDocument();
    expect(screen.getByTestId('input-amount')).toBeInTheDocument();
    expect(screen.getByTestId('receipt-dropzone')).toBeInTheDocument();
  });

  it('scans a picked photo and fills in the fields', async () => {
    const mockScan = vi.fn().mockResolvedValue({
      merchantName: 'ENOC',
      amount: 120,
      currency: 'AED',
      expenseDate: '2026-10-15',
      category: 'Travel',
      confidence: 0.96,
      items: [{ description: 'Diesel', quantity: 1, unitPrice: 120, amount: 120 }],
    });

    render(<SubmitExpenseModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} onScanReceipt={mockScan} />);

    const photo = new File(['jpeg'], 'enoc.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('receipt-file-input'), { target: { files: [photo] } });
    fireEvent.click(await screen.findByTestId('btn-scan-receipt'));

    await waitFor(() => expect(mockScan).toHaveBeenCalledWith({ file: photo }));
    expect(screen.getByTestId('input-merchant-name')).toHaveValue('ENOC');
    expect(screen.getByTestId('input-amount')).toHaveValue(120);
    expect(screen.getByTestId('input-expense-date')).toHaveValue('2026-10-15');
    // The legacy short value resolves to the listed category.
    expect(screen.getByTestId('select-category')).toHaveValue('Travel & Lodging');
    expect(screen.getByTestId('select-currency')).toHaveValue('AED');
    expect(screen.getByTestId('ai-scan-success-banner')).toBeInTheDocument();
  });

  it('offers no sample receipt to file as evidence', () => {
    render(<SubmitExpenseModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByTestId('btn-load-sample')).toBeNull();
    expect(screen.queryByText(/sample/i)).toBeNull();
  });

  it('picks a receipt with a thumb-sized button that takes photos and PDFs', () => {
    render(<SubmitExpenseModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const input = screen.getByTestId('receipt-file-input');
    const click = vi.spyOn(input, 'click');

    const button = screen.getByRole('button', { name: 'Take photo or choose file' });
    expect(button.className).toContain('h-11');
    expect(input).toHaveAttribute('accept', 'image/*,application/pdf');
    fireEvent.click(button);
    expect(click).toHaveBeenCalled();
    // The camera input exists for touch screens, straight to the back camera.
    expect(screen.getByTestId('receipt-camera-input')).toHaveAttribute('capture', 'environment');
  });

  it('submits a picked receipt as a file, never inline in the claim', async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    render(<SubmitExpenseModal open={true} onClose={vi.fn()} onSubmit={handleSubmit} />);

    const pdf = new File(['%PDF-1.7'], 'dewa-october.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('receipt-file-input'), { target: { files: [pdf] } });
    await screen.findByTestId('btn-scan-receipt');
    fireEvent.change(screen.getByTestId('input-merchant-name'), { target: { value: 'DEWA' } });
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '512.40' } });
    fireEvent.click(screen.getByTestId('btn-save-draft'));

    await waitFor(() =>
      expect(handleSubmit).toHaveBeenCalledWith(expect.objectContaining({ receiptUrl: null }), pdf),
    );
  });

  it('scans an uploaded PDF by sending the file itself', async () => {
    const mockScan = vi.fn().mockResolvedValue({
      merchantName: 'DEWA',
      amount: 512.4,
      currency: 'AED',
      expenseDate: '2026-10-01',
      category: 'General Expense',
      confidence: 0.9,
      items: [],
    });
    render(<SubmitExpenseModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} onScanReceipt={mockScan} />);

    const pdf = new File(['%PDF-1.7'], 'dewa-october.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('receipt-file-input'), { target: { files: [pdf] } });
    fireEvent.click(await screen.findByTestId('btn-scan-receipt'));

    await waitFor(() => expect(mockScan).toHaveBeenCalledWith({ file: pdf }));
    expect(screen.getByTestId('input-merchant-name')).toHaveValue('DEWA');
  });

  it('adds and removes line items, calculating dynamic totals', () => {
    render(
      <SubmitExpenseModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    // Initial has 1 row
    expect(screen.getByTestId('line-item-row-0')).toBeInTheDocument();

    // Type description, quantity, price
    const descInput = screen.getByTestId('line-item-desc-0');
    const qtyInput = screen.getByTestId('line-item-qty-0');
    const priceInput = screen.getByTestId('line-item-price-0');

    fireEvent.change(descInput, { target: { value: 'Lunch with Client' } });
    fireEvent.change(qtyInput, { target: { value: '2' } });
    fireEvent.change(priceInput, { target: { value: '50' } });

    expect(screen.getByTestId('line-item-total-0')).toHaveTextContent('$100.00');
    expect(screen.getByTestId('input-amount')).toHaveValue(100);

    // A line total is in the claim's currency, not a hard-coded dollar.
    fireEvent.change(screen.getByTestId('select-currency'), { target: { value: 'AED' } });
    expect(screen.getByTestId('line-item-total-0')).toHaveTextContent('AED 100.00');

    // Click Add Line Item
    const addBtn = screen.getByTestId('btn-add-line-item');
    fireEvent.click(addBtn);

    expect(screen.getByTestId('line-item-row-1')).toBeInTheDocument();
  });

  it('submits valid form as draft or submitted claim', async () => {
    const handleSubmit = vi.fn();
    render(
      <SubmitExpenseModal
        open={true}
        onClose={vi.fn()}
        onSubmit={handleSubmit}
      />,
    );

    fireEvent.change(screen.getByTestId('input-employee-name'), { target: { value: 'Alex Morgan' } });
    fireEvent.change(screen.getByTestId('input-merchant-name'), { target: { value: 'Uber' } });
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '45.50' } });

    // Click Save as Draft
    const saveDraftBtn = screen.getByTestId('btn-save-draft');
    fireEvent.click(saveDraftBtn);

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeName: 'Alex Morgan',
          merchantName: 'Uber',
          amount: 45.5,
          status: 'DRAFT',
          receiptUrl: null,
          notes: null,
        }),
        null,
      );
    });
  });

  it('sends the notes with the claim', async () => {
    const handleSubmit = vi.fn();
    render(<SubmitExpenseModal open={true} onClose={vi.fn()} onSubmit={handleSubmit} />);

    fireEvent.change(screen.getByTestId('input-merchant-name'), { target: { value: 'Ace Hardware' } });
    fireEvent.change(screen.getByTestId('select-category'), { target: { value: 'Consumables' } });
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '86' } });
    fireEvent.change(screen.getByTestId('input-notes'), {
      target: { value: '  Sanding discs for the Marina kitchen job  ' },
    });
    fireEvent.click(screen.getByTestId('btn-submit-claim'));

    await waitFor(() =>
      expect(handleSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: 'Sanding discs for the Marina kitchen job',
          category: 'Consumables',
          status: 'SUBMITTED',
        }),
        null,
      ),
    );
  });

  it('has no category picked until one is chosen, grouped as the shared list groups them', () => {
    render(<SubmitExpenseModal open={true} onClose={vi.fn()} onSubmit={vi.fn()} />);
    const select = screen.getByTestId('select-category');
    expect(select).toHaveValue('');
    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label);
    expect(groups).toEqual(['Cost of sales', 'Operations', 'People', 'Overheads']);
  });

  it('shows each problem under its field and moves focus to the first', () => {
    const handleSubmit = vi.fn();
    render(<SubmitExpenseModal open={true} onClose={vi.fn()} onSubmit={handleSubmit} />);

    fireEvent.click(screen.getByTestId('btn-submit-claim'));

    expect(handleSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the merchant, or describe at least one line item.')).toBeInTheDocument();
    expect(screen.getByText('Choose a category.')).toBeInTheDocument();
    expect(screen.getByText('Enter an amount above zero.')).toBeInTheDocument();
    expect(screen.getByTestId('input-merchant-name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('input-merchant-name')).toHaveFocus();
    // No banner at the top for problems that belong to fields.
    expect(screen.queryByTestId('form-error-alert')).toBeNull();

    // Fixing a field clears its message.
    fireEvent.change(screen.getByTestId('input-merchant-name'), { target: { value: 'ENOC' } });
    expect(screen.queryByText('Enter the merchant, or describe at least one line item.')).toBeNull();
  });
});

describe('ExpenseClaimsTable Component', () => {
  it('renders the claims table rows, with no second row of totals', () => {
    render(<ExpenseClaimsTable claims={mockClaims} />);

    expect(screen.getByTestId('expense-claims-table-container')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-total-claims')).toBeNull();
    expect(screen.queryByTestId('btn-new-claim')).toBeNull();
    expect(screen.getByTestId('expense-claims-table')).toBeInTheDocument();

    // Check row renders
    expect(screen.getByText('EXP-101')).toBeInTheDocument();
    expect(screen.getByText('EXP-102')).toBeInTheDocument();
    expect(screen.getByText('EXP-103')).toBeInTheDocument();
  });

  it('filters claims via search input', () => {
    render(<ExpenseClaimsTable claims={mockClaims} />);

    const searchInput = screen.getByTestId('input-search-claims');
    fireEvent.change(searchInput, { target: { value: 'Delta Air' } });

    expect(screen.getByText('EXP-101')).toBeInTheDocument();
    expect(screen.queryByText('EXP-102')).toBeNull();
    expect(screen.queryByText('EXP-103')).toBeNull();
  });

  it('filters claims via category dropdown', () => {
    render(<ExpenseClaimsTable claims={mockClaims} />);

    const categorySelect = screen.getByTestId('select-filter-category');
    fireEvent.change(categorySelect, { target: { value: 'Software & SaaS' } });

    expect(screen.getByText('EXP-103')).toBeInTheDocument();
    expect(screen.queryByText('EXP-101')).toBeNull();
  });

  it('filters claims via status tabs', () => {
    render(<ExpenseClaimsTable claims={mockClaims} />);

    const approvedTab = screen.getByTestId('status-tab-approved');
    fireEvent.click(approvedTab);

    expect(screen.getByText('EXP-102')).toBeInTheDocument();
    expect(screen.queryByText('EXP-101')).toBeNull();
    expect(screen.queryByText('EXP-103')).toBeNull();
  });

  it('asks before approving, naming the claimant, the amount and what posts', async () => {
    const handleApprove = vi.fn().mockResolvedValue(undefined);
    render(<ExpenseClaimsTable claims={mockClaims} onApprove={handleApprove} />);

    fireEvent.click(screen.getByTestId('btn-approve-claim-exp-1'));
    expect(handleApprove).not.toHaveBeenCalled();

    expect(screen.getByText('Approve $450.00 for Sarah Connor?')).toBeInTheDocument();
    expect(screen.getByText(/posts the cost to the books under Travel/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve claim' }));
    });
    expect(handleApprove).toHaveBeenCalledWith(mockClaims[0]);
  });

  it('will not reject without a reason, and rejects with one', async () => {
    const handleReject = vi.fn().mockResolvedValue(undefined);
    render(<ExpenseClaimsTable claims={mockClaims} onReject={handleReject} />);

    fireEvent.click(screen.getByTestId('btn-reject-claim-exp-1'));
    expect(screen.getByTestId('input-rejection-reason')).toBeInTheDocument();
    expect(screen.getByTestId('btn-confirm-reject').className).toContain('bg-danger');

    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-confirm-reject'));
    });
    expect(handleReject).not.toHaveBeenCalled();
    expect(screen.getByText(/Say why the claim is rejected/)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('input-rejection-reason'), {
      target: { value: '  Policy limit exceeded ' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-confirm-reject'));
    });
    expect(handleReject).toHaveBeenCalledWith(mockClaims[0], 'Policy limit exceeded');
  });

  it('asks before reimbursing, naming the account the money leaves', async () => {
    const handleReimburse = vi.fn().mockResolvedValue(undefined);
    render(
      <ExpenseClaimsTable
        claims={mockClaims}
        onReimburse={handleReimburse}
        reimbursementAccountName="Petty Cash"
      />,
    );

    fireEvent.click(screen.getByTestId('btn-reimburse-claim-exp-2'));
    expect(handleReimburse).not.toHaveBeenCalled();
    expect(screen.getByText('Reimburse $125.50 to John Doe?')).toBeInTheDocument();
    expect(screen.getByText('This records the payment from Petty Cash.')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reimburse claim' }));
    });
    expect(handleReimburse).toHaveBeenCalledWith(mockClaims[1]);
  });

  it('hides approve, reject and reimburse from someone who cannot approve', () => {
    mocks.allowed = false;
    render(<ExpenseClaimsTable claims={mockClaims} onApprove={vi.fn()} onReimburse={vi.fn()} />);
    expect(screen.queryByTestId('btn-approve-claim-exp-1')).toBeNull();
    expect(screen.queryByTestId('btn-reject-claim-exp-1')).toBeNull();
    expect(screen.queryByTestId('btn-reimburse-claim-exp-2')).toBeNull();
  });

  it('shows each amount in its own currency', () => {
    const aed = { ...mockClaims[0], id: 'exp-aed', claimNumber: 'EXP-200', currency: 'AED', amount: 120 };
    render(<ExpenseClaimsTable claims={[aed]} />);
    expect(screen.getByTestId('claim-row-exp-aed')).toHaveTextContent('AED 120.00');
  });

  it('renders loading skeletons when isLoading is true', () => {
    render(<ExpenseClaimsTable claims={[]} isLoading={true} />);
    expect(screen.getByTestId('table-loading-skeleton')).toBeInTheDocument();
  });

  it('renders empty state when no claims exist', () => {
    const handleNewClaim = vi.fn();
    render(<ExpenseClaimsTable claims={[]} onNewClaim={handleNewClaim} />);

    expect(screen.getByTestId('table-empty-state')).toBeInTheDocument();
    expect(screen.getByText('No Expense Claims Found')).toBeInTheDocument();

    const newClaimBtn = screen.getByTestId('btn-empty-new-claim');
    fireEvent.click(newClaimBtn);
    expect(handleNewClaim).toHaveBeenCalledTimes(1);
  });
});

describe('ExpenseSummary', () => {
  const claim = (over: Partial<ExpenseClaimDto>): ExpenseClaimDto => ({
    ...mockClaims[0],
    id: Math.random().toString(36).slice(2),
    ...over,
  });
  const now = new Date('2026-10-30T12:00:00Z');

  it('totals in the base currency and says which claims it leaves out', () => {
    const claims = [
      claim({ status: 'SUBMITTED', currency: 'AED', amount: 120 }),
      claim({ status: 'SUBMITTED', currency: 'AED', amount: 80.5 }),
      claim({ status: 'SUBMITTED', currency: 'USD', amount: 100 }),
      claim({ status: 'APPROVED', currency: 'AED', amount: 300 }),
    ];
    render(<ExpenseSummary claims={claims} baseCurrency="AED" now={now} />);

    // 120 + 80.50, never 300.50 with the dollars added at face value.
    expect(screen.getByTestId('stat-pending-amount')).toHaveTextContent('AED 200.50');
    expect(screen.getByTestId('stat-pending-caption')).toHaveTextContent('3 claims');
    expect(screen.getByTestId('stat-pending-caption')).toHaveTextContent('Leaves out 1 in USD');
    expect(screen.getByTestId('stat-approved-unpaid-amount')).toHaveTextContent('AED 300.00');
    expect(screen.getByTestId('stat-approved-unpaid-caption')).not.toHaveTextContent('Leaves out');
  });

  it('counts paid claims in the month they were paid', () => {
    const summary = summariseClaims(
      [
        claim({ status: 'PAID', currency: 'AED', amount: 50, reimbursedAt: '2026-10-02T09:00:00Z' }),
        claim({ status: 'PAID', currency: 'AED', amount: 70, reimbursedAt: '2026-09-28T09:00:00Z' }),
      ],
      'AED',
      now,
    );
    expect(summary.paidThisMonth).toEqual({ count: 1, amount: 50, excluded: [] });
  });

  it('shows no figure until the base currency is known', () => {
    render(<ExpenseSummary claims={mockClaims} baseCurrency={undefined} />);
    expect(screen.getByTestId('stat-pending-amount')).toHaveTextContent('—');
  });
});

describe('formatExpenseCurrency', () => {
  it('never assumes dollars', () => {
    expect(formatExpenseCurrency(120, 'AED')).toMatch(/^AED\s120\.00$/);
    expect(formatExpenseCurrency(120, undefined)).toBe('120.00');
  });
});

describe('reimbursementAccount', () => {
  it('picks the default account, as the API does', () => {
    const account = (over: object) => ({
      id: 'a',
      tenantId: 't',
      name: 'Bank',
      accountType: 'BANK' as const,
      currency: 'AED',
      balance: 0,
      isDefault: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...over,
    });
    expect(
      reimbursementAccount([account({ id: 'old', name: 'Emirates NBD' }), account({ id: 'pc', name: 'Petty Cash', isDefault: true })])
        ?.name,
    ).toBe('Petty Cash');
    expect(reimbursementAccount([])).toBeNull();
  });
});

describe('ExpenseDetailView', () => {
  const signalClaim = vi.fn().mockResolvedValue(undefined);
  const withClaim = (over: Partial<ExpenseClaimDto>) =>
    mocks.useExpense.mockReturnValue({
      claim: { ...mockClaims[0], ...over },
      isLoading: false,
      isError: false,
      signalClaim,
      isSignaling: false,
    });

  beforeEach(() => signalClaim.mockClear());

  it('shows the notes the claimant wrote', () => {
    withClaim({ notes: 'Flight to the Riyadh fit-out survey' });
    render(<ExpenseDetailView id="exp-1" />);
    expect(screen.getByTestId('claim-notes')).toHaveTextContent('Flight to the Riyadh fit-out survey');
    expect(screen.queryByText(/expense incurred by/)).toBeNull();
  });

  it('says "None given" rather than making a justification up', () => {
    withClaim({ notes: null });
    render(<ExpenseDetailView id="exp-1" />);
    expect(screen.getByTestId('claim-notes')).toHaveTextContent('None given');
    expect(screen.queryByText(/expense incurred by/)).toBeNull();
  });

  it('confirms before reimbursing, from the account it names', async () => {
    mocks.accounts = [
      {
        id: 'pc',
        tenantId: 't',
        name: 'Petty Cash',
        accountType: 'CASH',
        currency: 'AED',
        balance: 500,
        isDefault: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    withClaim({ status: 'APPROVED', currency: 'AED', amount: 120, employeeName: 'Rashid' });
    render(<ExpenseDetailView id="exp-1" />);

    fireEvent.click(screen.getByTestId('detail-reimburse-btn'));
    expect(signalClaim).not.toHaveBeenCalled();
    expect(screen.getByText(/^Reimburse AED\s120\.00 to Rashid\?$/)).toBeInTheDocument();
    expect(screen.getByText('This records the payment from Petty Cash.')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reimburse claim' }));
    });
    expect(signalClaim).toHaveBeenCalledWith({ action: 'REIMBURSE', accountId: 'pc' });
  });

  it('hides the approval actions without expense:approve', () => {
    mocks.allowed = false;
    withClaim({ status: 'SUBMITTED' });
    render(<ExpenseDetailView id="exp-1" />);
    expect(screen.queryByTestId('detail-approve-btn')).toBeNull();
    expect(screen.queryByTestId('detail-reject-btn')).toBeNull();
  });
});
