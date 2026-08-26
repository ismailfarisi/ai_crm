'use client';

import React, { useState, useRef } from 'react';
import {
  Upload,
  Sparkles,
  Plus,
  Trash2,
  Receipt,
  CheckCircle2,
  Calendar,
  Building2,
  DollarSign,
  Tag,
  User,
  FileText,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/primitives';
import type {
  CreateExpenseClaimPayload,
  ExpenseItemDto,
  ScanReceiptPayload,
  ScannedReceiptResult,
} from '@saas/shared';
import { useScanReceipt } from '@/hooks/use-expenses';

export interface SubmitExpenseModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateExpenseClaimPayload) => Promise<void> | void;
  onScanReceipt?: (payload: ScanReceiptPayload) => Promise<ScannedReceiptResult>;
  initialData?: Partial<CreateExpenseClaimPayload>;
  isLoading?: boolean;
}

export const EXPENSE_CATEGORIES = [
  { value: 'Travel', label: 'Travel & Lodging' },
  { value: 'Meals & Entertainment', label: 'Meals & Entertainment' },
  { value: 'Office Supplies', label: 'Office Supplies' },
  { value: 'Software & SaaS', label: 'Software & SaaS' },
  { value: 'Hardware', label: 'Hardware & Equipment' },
  { value: 'Marketing', label: 'Marketing & Advertising' },
  { value: 'Professional Services', label: 'Professional Services' },
  { value: 'Utilities', label: 'Utilities & Telecom' },
  { value: 'Other', label: 'Other' },
];

export const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'CAD', label: 'CAD ($)' },
  { value: 'AUD', label: 'AUD ($)' },
];

interface FormLineItem extends ExpenseItemDto {
  id: string;
}

const SAMPLE_RECEIPT_IMAGE =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><rect width="400" height="600" fill="%23fdfbf7"/><text x="200" y="60" font-family="sans-serif" font-size="20" font-weight="bold" text-anchor="middle" fill="%232d3748">ACME CLOUD CORP</text><text x="200" y="90" font-family="sans-serif" font-size="12" text-anchor="middle" fill="%23718096">100 Tech Boulevard, Suite 400</text><line x1="40" y1="120" x2="360" y2="120" stroke="%23cbd5e0" stroke-dasharray="4"/><text x="40" y="160" font-family="sans-serif" font-size="14" fill="%234a5568">Pro Enterprise Plan (1 Mo)</text><text x="360" y="160" font-family="sans-serif" font-size="14" text-anchor="end" fill="%232d3748">$240.00</text><text x="40" y="200" font-family="sans-serif" font-size="14" fill="%234a5568">API Add-on Capacity</text><text x="360" y="200" font-family="sans-serif" font-size="14" text-anchor="end" fill="%232d3748">$45.00</text><line x1="40" y1="240" x2="360" y2="240" stroke="%23cbd5e0"/><text x="40" y="280" font-family="sans-serif" font-size="16" font-weight="bold" fill="%232d3748">TOTAL AMOUNT</text><text x="360" y="280" font-family="sans-serif" font-size="18" font-weight="bold" text-anchor="end" fill="%23d97706">$285.00</text><text x="200" y="340" font-family="sans-serif" font-size="12" text-anchor="middle" fill="%23a0aec0">Date: 2026-08-15 • Tax Included: $23.50</text></svg>';

export function SubmitExpenseModal({
  open,
  onClose,
  onSubmit,
  onScanReceipt,
  initialData,
  isLoading = false,
}: SubmitExpenseModalProps) {
  const scanReceiptMutation = useScanReceipt();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State
  const [employeeName, setEmployeeName] = useState(initialData?.employeeName || '');
  const [merchantName, setMerchantName] = useState(initialData?.merchantName || '');
  const [category, setCategory] = useState(initialData?.category || 'Software & SaaS');
  const [expenseDate, setExpenseDate] = useState(
    initialData?.expenseDate || new Date().toISOString().split('T')[0],
  );
  const [currency, setCurrency] = useState(initialData?.currency || 'USD');
  const [amount, setAmount] = useState<string>(
    initialData?.amount !== undefined ? String(initialData.amount) : '',
  );
  const [notes, setNotes] = useState('');

  // Receipt File State
  const [receiptUrl, setReceiptUrl] = useState<string | null>(initialData?.receiptUrl || null);
  const [receiptFileName, setReceiptFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // OCR Scan State
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScannedReceiptResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Line items state
  const [items, setItems] = useState<FormLineItem[]>(
    initialData?.items && initialData.items.length > 0
      ? initialData.items.map((it, idx) => ({ ...it, id: String(idx + 1) }))
      : [{ id: '1', description: '', quantity: 1, unitPrice: 0, amount: 0 }],
  );

  const resetForm = () => {
    setEmployeeName(initialData?.employeeName || '');
    setMerchantName(initialData?.merchantName || '');
    setCategory(initialData?.category || 'Software & SaaS');
    setExpenseDate(initialData?.expenseDate || new Date().toISOString().split('T')[0]);
    setCurrency(initialData?.currency || 'USD');
    setAmount(initialData?.amount !== undefined ? String(initialData.amount) : '');
    setNotes('');
    setReceiptUrl(initialData?.receiptUrl || null);
    setReceiptFileName(null);
    setIsDragging(false);
    setIsScanning(false);
    setScanResult(null);
    setError(null);
    setItems([{ id: '1', description: '', quantity: 1, unitPrice: 0, amount: 0 }]);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Recalculate item line total and claim total
  const handleItemChange = (
    id: string,
    field: keyof ExpenseItemDto,
    value: string | number,
  ) => {
    setItems((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== id) return item;
        const newItem = { ...item, [field]: value };
        if (field === 'quantity' || field === 'unitPrice') {
          const q = field === 'quantity' ? Number(value) || 0 : item.quantity;
          const u = field === 'unitPrice' ? Number(value) || 0 : item.unitPrice;
          newItem.amount = Math.round(q * u * 100) / 100;
        }
        return newItem;
      });

      // Auto calculate total if items have amounts
      const calculatedSum = updated.reduce((sum, it) => sum + (it.amount || 0), 0);
      if (calculatedSum > 0) {
        setAmount(String(calculatedSum));
      }

      return updated;
    });
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now().toString(), description: '', quantity: 1, unitPrice: 0, amount: 0 },
    ]);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) {
      setItems([{ id: '1', description: '', quantity: 1, unitPrice: 0, amount: 0 }]);
      return;
    }
    setItems((prev) => {
      const updated = prev.filter((it) => it.id !== id);
      const calculatedSum = updated.reduce((sum, it) => sum + (it.amount || 0), 0);
      if (calculatedSum > 0) {
        setAmount(String(calculatedSum));
      }
      return updated;
    });
  };

  // Handle Receipt Upload
  const handleFile = (file: File) => {
    setError(null);
    setReceiptFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setReceiptUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleLoadSampleReceipt = () => {
    setReceiptUrl(SAMPLE_RECEIPT_IMAGE);
    setReceiptFileName('sample-enterprise-receipt.png');
  };

  // Trigger AI OCR Scan
  const handleScanReceipt = async () => {
    if (!receiptUrl) {
      setError('Please upload a receipt file first to scan.');
      return;
    }

    try {
      setIsScanning(true);
      setError(null);

      let result: ScannedReceiptResult;
      if (onScanReceipt) {
        result = await onScanReceipt({
          base64: receiptUrl,
          imageUrl: receiptUrl,
          mimeType: receiptUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
        });
      } else {
        result = await scanReceiptMutation.mutateAsync({
          base64: receiptUrl,
          imageUrl: receiptUrl,
          mimeType: 'image/jpeg',
        });
      }

      setScanResult(result);

      // Auto populate fields
      if (result.merchantName) setMerchantName(result.merchantName);
      if (result.amount) setAmount(String(result.amount));
      if (result.currency) setCurrency(result.currency);
      if (result.expenseDate) setExpenseDate(result.expenseDate.split('T')[0]);
      if (result.category) {
        // match category or fallback
        const matched = EXPENSE_CATEGORIES.find(
          (c) => c.value.toLowerCase() === result.category.toLowerCase(),
        );
        setCategory(matched ? matched.value : result.category);
      }

      if (result.items && result.items.length > 0) {
        setItems(
          result.items.map((it, idx) => ({
            id: String(idx + 1),
            description: it.description || `Item #${idx + 1}`,
            quantity: it.quantity || 1,
            unitPrice: it.unitPrice || it.amount || 0,
            amount: it.amount || (it.quantity || 1) * (it.unitPrice || 0),
          })),
        );
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to scan receipt. Please check input and try again.');
    } finally {
      setIsScanning(false);
    }
  };

  // Submission handler
  const handleFormSubmit = async (status: 'DRAFT' | 'SUBMITTED') => {
    setError(null);

    const numericAmount = parseFloat(amount);
    if (!merchantName.trim() && items.every((i) => !i.description.trim())) {
      setError('Merchant name or at least one line item description is required.');
      return;
    }

    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('Please enter a valid expense amount greater than zero.');
      return;
    }

    const payload: CreateExpenseClaimPayload = {
      employeeName: employeeName.trim() || 'Current User',
      merchantName: merchantName.trim() || null,
      category,
      expenseDate,
      currency,
      amount: numericAmount,
      receiptUrl: receiptUrl || null,
      status,
      items: items
        .filter((it) => it.description.trim() || it.amount > 0)
        .map(({ id, ...it }) => it),
    };

    try {
      await onSubmit(payload);
      handleClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit expense claim.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Submit Expense Claim"
      description="Upload a receipt for AI auto-extraction or fill the claim details manually."
      size="lg"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          handleFormSubmit('SUBMITTED');
        }}
        data-testid="submit-expense-form"
        className="space-y-6 pb-2"
      >
        {error && (
          <div
            data-testid="form-error-alert"
            className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300"
          >
            <AlertCircle className="size-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Receipt Drag and Drop Upload Zone */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Receipt Document & AI Scanner
          </label>

          <div
            data-testid="receipt-dropzone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-5 text-center transition-all ${
              isDragging
                ? 'border-brand bg-brand-soft/40 scale-[0.99]'
                : receiptUrl
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-border/60 bg-surface-muted/20 hover:border-border-strong hover:bg-surface-muted/30'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              data-testid="receipt-file-input"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFile(e.target.files[0]);
                }
              }}
            />

            {receiptUrl ? (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 w-full px-2">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-emerald-500/10 p-2.5 text-emerald-600 border border-emerald-500/20 shrink-0">
                    <Receipt className="size-6" />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-ink truncate max-w-[200px] sm:max-w-xs">
                      {receiptFileName || 'Receipt Image Attached'}
                    </p>
                    <p className="text-xs text-ink-muted">Ready for AI parsing & submission</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="btn-scan-receipt"
                    disabled={isScanning}
                    onClick={handleScanReceipt}
                    className="gap-1.5 bg-brand-soft/80 border-brand/40 text-ink font-semibold hover:bg-brand-soft shadow-xs"
                  >
                    {isScanning ? (
                      <Loader2 className="size-3.5 animate-spin text-ink" />
                    ) : (
                      <Sparkles className="size-3.5 text-brand" />
                    )}
                    {isScanning ? 'Scanning...' : 'Scan with AI'}
                  </Button>

                  <button
                    type="button"
                    onClick={() => {
                      setReceiptUrl(null);
                      setReceiptFileName(null);
                      setScanResult(null);
                    }}
                    aria-label="Remove receipt"
                    data-testid="btn-remove-receipt"
                    className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="rounded-2xl bg-surface-muted/60 p-3 text-ink-subtle border border-border/30">
                  <Upload className="size-6 stroke-[1.8]" />
                </div>
                <p className="mt-2 text-sm font-medium text-ink">
                  Drag and drop receipt here, or{' '}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-brand font-semibold hover:underline cursor-pointer"
                  >
                    browse files
                  </button>
                </p>
                <p className="text-xs text-ink-subtle mt-0.5">Supports PNG, JPG, WEBP, or PDF scans</p>

                <div className="mt-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="btn-load-sample"
                    onClick={handleLoadSampleReceipt}
                    className="text-xs text-ink-muted hover:text-ink gap-1"
                  >
                    <Sparkles className="size-3 text-brand" />
                    Load Sample Receipt
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* AI Extraction Banner */}
          {scanResult && (
            <div
              data-testid="ai-scan-success-banner"
              className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-800 dark:text-emerald-300"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                <span>
                  <strong>AI Scan Completed:</strong> Auto-extracted {scanResult.merchantName} ({scanResult.items?.length || 0} items)
                </span>
              </div>
              <Badge tone="success" className="font-semibold text-[10px]">
                {Math.round((scanResult.confidence || 0.95) * 100)}% Confidence
              </Badge>
            </div>
          )}
        </div>

        {/* Claim Core Information Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Employee / Submitter"
            data-testid="input-employee-name"
            placeholder="e.g. Alex Morgan"
            value={employeeName}
            onChange={(e) => setEmployeeName(e.target.value)}
          />

          <Input
            label="Merchant / Vendor"
            data-testid="input-merchant-name"
            required
            placeholder="e.g. Acme Corp, Delta Air, Uber"
            value={merchantName}
            onChange={(e) => setMerchantName(e.target.value)}
          />

          <Select
            label="Expense Category"
            data-testid="select-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={EXPENSE_CATEGORIES}
          />

          <Input
            label="Expense Date"
            type="date"
            data-testid="input-expense-date"
            required
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
          />

          <Select
            label="Currency"
            data-testid="select-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            options={CURRENCY_OPTIONS}
          />

          <Input
            label="Total Amount"
            type="number"
            step="0.01"
            required
            data-testid="input-amount"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        {/* Line Items Table */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Line Items Breakdown ({items.length})
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="btn-add-line-item"
              onClick={handleAddItem}
              className="text-xs gap-1 text-ink-muted hover:text-ink"
            >
              <Plus className="size-3.5" />
              Add Item
            </Button>
          </div>

          <div
            data-testid="line-items-container"
            className="space-y-2 rounded-2xl border border-border/30 bg-surface-muted/15 p-3"
          >
            {items.map((item, index) => (
              <div
                key={item.id}
                data-testid={`line-item-row-${index}`}
                className="grid grid-cols-12 gap-2 items-center bg-surface p-2 rounded-xl border border-border/30"
              >
                <div className="col-span-12 sm:col-span-5">
                  <input
                    type="text"
                    placeholder="Description (e.g. Team Lunch)"
                    aria-label={`Item ${index + 1} description`}
                    data-testid={`line-item-desc-${index}`}
                    value={item.description}
                    onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                    className="w-full rounded-lg border border-border/70 bg-transparent px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-hidden focus:border-brand"
                  />
                </div>

                <div className="col-span-4 sm:col-span-2">
                  <input
                    type="number"
                    min="1"
                    placeholder="Qty"
                    aria-label={`Item ${index + 1} quantity`}
                    data-testid={`line-item-qty-${index}`}
                    value={item.quantity}
                    onChange={(e) => handleItemChange(item.id, 'quantity', Number(e.target.value))}
                    className="w-full rounded-lg border border-border/70 bg-transparent px-2.5 py-1.5 text-xs text-ink text-right focus:outline-hidden focus:border-brand"
                  />
                </div>

                <div className="col-span-4 sm:col-span-2">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Price"
                    aria-label={`Item ${index + 1} unit price`}
                    data-testid={`line-item-price-${index}`}
                    value={item.unitPrice || ''}
                    onChange={(e) => handleItemChange(item.id, 'unitPrice', Number(e.target.value))}
                    className="w-full rounded-lg border border-border/70 bg-transparent px-2.5 py-1.5 text-xs text-ink text-right focus:outline-hidden focus:border-brand"
                  />
                </div>

                <div className="col-span-3 sm:col-span-2 text-right pr-1">
                  <span
                    data-testid={`line-item-total-${index}`}
                    className="font-mono text-xs font-semibold text-ink"
                  >
                    ${(item.amount || 0).toFixed(2)}
                  </span>
                </div>

                <div className="col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.id)}
                    aria-label={`Remove item ${index + 1}`}
                    data-testid={`btn-remove-line-item-${index}`}
                    className="rounded-lg p-1 text-ink-subtle hover:text-danger hover:bg-danger-soft/50 transition-colors cursor-pointer"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notes & Justification */}
        <Textarea
          label="Business Purpose / Notes (Optional)"
          data-testid="input-notes"
          placeholder="Add business justification or client details..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {/* Modal Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/25">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            data-testid="btn-cancel"
            disabled={isLoading || isScanning}
          >
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              data-testid="btn-save-draft"
              disabled={isLoading || isScanning}
              onClick={() => handleFormSubmit('DRAFT')}
            >
              Save as Draft
            </Button>

            <Button
              type="submit"
              variant="primary"
              data-testid="btn-submit-claim"
              loading={isLoading}
              disabled={isScanning}
            >
              Submit Claim
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
