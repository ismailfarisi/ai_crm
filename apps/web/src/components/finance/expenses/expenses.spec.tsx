import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ExpenseClaimDto, ScannedReceiptResult } from '@saas/shared';
import {
  ExpenseStatusBadge,
  ExpenseStatusRibbon,
} from './expense-status-ribbon';
import {
  ReceiptPreviewCard,
  formatExpenseCurrency,
} from './receipt-preview-card';
import {
  SubmitExpenseModal,
  EXPENSE_CATEGORIES,
} from './submit-expense-modal';
import {
  ExpenseClaimsTable,
} from './expense-claims-table';

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

// Mock hook useScanReceipt
vi.mock('@/hooks/use-expenses', () => ({
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
    expect(screen.getByText(/Payment settled & disbursed/i)).toBeInTheDocument();
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

  it('loads sample receipt and triggers AI scan to auto-populate fields', async () => {
    const mockScan = vi.fn().mockResolvedValue({
      merchantName: 'Acme Cloud Corp',
      amount: 285.0,
      currency: 'USD',
      expenseDate: '2026-08-15',
      category: 'Software & SaaS',
      confidence: 0.96,
      taxAmount: 23.5,
      items: [
        { description: 'Pro Plan', quantity: 1, unitPrice: 240, amount: 240 },
        { description: 'API Addon', quantity: 1, unitPrice: 45, amount: 45 },
      ],
    });

    render(
      <SubmitExpenseModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        onScanReceipt={mockScan}
      />,
    );

    // Click Load Sample Receipt
    const loadSampleBtn = screen.getByTestId('btn-load-sample');
    fireEvent.click(loadSampleBtn);

    // Click Scan with AI
    const scanBtn = screen.getByTestId('btn-scan-receipt');
    fireEvent.click(scanBtn);

    await waitFor(() => {
      expect(mockScan).toHaveBeenCalledTimes(1);
    });

    // Form inputs should be auto-populated
    expect(screen.getByTestId('input-merchant-name')).toHaveValue('Acme Cloud Corp');
    expect(screen.getByTestId('input-amount')).toHaveValue(285);
    expect(screen.getByTestId('input-expense-date')).toHaveValue('2026-08-15');
    expect(screen.getByTestId('ai-scan-success-banner')).toBeInTheDocument();
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
        }),
      );
    });
  });

  it('displays error alert if validation fails', () => {
    render(
      <SubmitExpenseModal
        open={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    // Submitting with empty merchant/amount
    const submitBtn = screen.getByTestId('btn-submit-claim');
    fireEvent.click(submitBtn);

    expect(screen.getByTestId('form-error-alert')).toBeInTheDocument();
  });
});

describe('ExpenseClaimsTable Component', () => {
  it('renders summary KPI strip and claims table rows', () => {
    render(<ExpenseClaimsTable claims={mockClaims} />);

    expect(screen.getByTestId('expense-claims-table-container')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-total-claims')).toHaveTextContent('5');
    expect(screen.getByTestId('kpi-pending-count')).toHaveTextContent('1');
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

  it('handles Approve quick action for submitted claim', async () => {
    const handleApprove = vi.fn().mockResolvedValue(undefined);
    render(<ExpenseClaimsTable claims={mockClaims} onApprove={handleApprove} />);

    const approveBtn = screen.getByTestId('btn-approve-claim-exp-1');
    await act(async () => {
      fireEvent.click(approveBtn);
    });

    expect(handleApprove).toHaveBeenCalledWith(mockClaims[0]);
  });

  it('handles Reject action and modal confirmation', async () => {
    const handleReject = vi.fn().mockResolvedValue(undefined);
    render(<ExpenseClaimsTable claims={mockClaims} onReject={handleReject} />);

    // Click Reject button on row
    const rejectBtn = screen.getByTestId('btn-reject-claim-exp-1');
    fireEvent.click(rejectBtn);

    // Modal should appear
    expect(screen.getByTestId('input-rejection-reason')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('input-rejection-reason'), {
      target: { value: 'Policy limit exceeded' },
    });

    const confirmRejectBtn = screen.getByTestId('btn-confirm-reject');
    await act(async () => {
      fireEvent.click(confirmRejectBtn);
    });

    expect(handleReject).toHaveBeenCalledWith(mockClaims[0], 'Policy limit exceeded');
  });

  it('handles Reimburse action for approved claim', async () => {
    const handleReimburse = vi.fn().mockResolvedValue(undefined);
    render(<ExpenseClaimsTable claims={mockClaims} onReimburse={handleReimburse} />);

    const reimburseBtn = screen.getByTestId('btn-reimburse-claim-exp-2');
    await act(async () => {
      fireEvent.click(reimburseBtn);
    });

    expect(handleReimburse).toHaveBeenCalledWith(mockClaims[1]);
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
