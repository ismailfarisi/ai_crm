'use client';

import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import {
  Upload,
  Sparkles,
  Plus,
  Trash2,
  Receipt,
  CheckCircle2,
  Camera,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type {
  CreateExpenseClaimPayload,
  ExpenseItemDto,
  ScannedReceiptResult,
} from '@saas/shared';
import {
  BILL_CAPTURE_MAX_BYTES as RECEIPT_SCAN_MAX_BYTES,
  CURRENCY_OPTIONS as SHARED_CURRENCIES,
  EXPENSE_CATEGORIES as SHARED_EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_GROUPS,
  EXPENSE_NOTES_MAX_LENGTH,
  currencyLabel,
  isBillCaptureContentType,
  normaliseExpenseCategory,
} from '@saas/shared';
import { useScanReceipt } from '@/hooks/use-expenses';
import { useOrganization } from '@/hooks/use-organization';
import { receiptScanInput, type ReceiptScanInput } from '@/lib/receipt-scan-input';
import { formatExpenseCurrency } from './expense-money';

export interface SubmitExpenseModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * `receipt` is the file to store on the claim once it exists. The claim
   * itself never carries the file, only a link to one already saved.
   */
  onSubmit: (payload: CreateExpenseClaimPayload, receipt: File | null) => Promise<unknown> | void;
  onScanReceipt?: (input: ReceiptScanInput) => Promise<ScannedReceiptResult>;
  initialData?: Partial<CreateExpenseClaimPayload>;
  isLoading?: boolean;
}

/**
 * One shared list with the budget screen, which previously offered different
 * values for the same categories — so no claim ever matched the budget set to
 * guard it. Value and label are now the same string on both sides.
 */
export const EXPENSE_CATEGORIES = SHARED_EXPENSE_CATEGORIES.map((category) => ({
  value: category,
  label: category,
}));

/** One shared list, so a claim can be filed in any currency the books hold. */
export const CURRENCY_OPTIONS = SHARED_CURRENCIES.map((currency) => ({
  value: currency.code,
  label: currencyLabel(currency.code),
}));

interface FormLineItem extends ExpenseItemDto {
  id: string;
}

type FieldName = 'merchantName' | 'category' | 'expenseDate' | 'amount';
type FieldErrors = Partial<Record<FieldName, string>>;

/** In the order the fields appear, so focus goes to the first one wrong. */
const FIELD_ORDER: FieldName[] = ['merchantName', 'category', 'expenseDate', 'amount'];

const COARSE_POINTER = '(pointer: coarse)';

function subscribeToPointer(onChange: () => void) {
  const query = typeof window !== 'undefined' ? window.matchMedia?.(COARSE_POINTER) : undefined;
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}

/** A touch screen, where a straight-to-camera button is worth offering. */
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeToPointer,
    () => window.matchMedia?.(COARSE_POINTER).matches ?? false,
    () => false,
  );
}

const emptyItem = (): FormLineItem => ({ id: '1', description: '', quantity: 1, unitPrice: 0, amount: 0 });

const today = () => new Date().toISOString().split('T')[0];

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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const isTouch = useCoarsePointer();

  const merchantRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const categoryId = useId();

  // Form State
  const [employeeName, setEmployeeName] = useState(initialData?.employeeName || '');
  const [merchantName, setMerchantName] = useState(initialData?.merchantName || '');
  // No default: the category picks the account the cost posts to, so it is a choice.
  const [category, setCategory] = useState(initialData?.category || '');
  const [expenseDate, setExpenseDate] = useState(initialData?.expenseDate || today());
  // A claim is converted into base currency when it posts, so defaulting to
  // anything else would ask for an exchange rate nobody meant to use.
  const baseCurrency = useOrganization().data?.baseCurrency;
  const [currency, setCurrency] = useState(initialData?.currency || baseCurrency || '');
  const currencyTouched = useRef(Boolean(initialData?.currency));
  useEffect(() => {
    if (baseCurrency && !currencyTouched.current) setCurrency(baseCurrency);
  }, [baseCurrency]);
  const [amount, setAmount] = useState<string>(
    initialData?.amount !== undefined ? String(initialData.amount) : '',
  );
  const [notes, setNotes] = useState(initialData?.notes || '');

  // Receipt File State
  const [receiptUrl, setReceiptUrl] = useState<string | null>(initialData?.receiptUrl || null);
  const [receiptFileName, setReceiptFileName] = useState<string | null>(null);
  // The picked file itself, so the scan uploads it rather than its data URL.
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // OCR Scan State
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScannedReceiptResult | null>(null);

  // Each problem shows where it is: under its field, under the scanner, or by the buttons.
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [scanError, setScanError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Line items state
  const [items, setItems] = useState<FormLineItem[]>(
    initialData?.items && initialData.items.length > 0
      ? initialData.items.map((it, idx) => ({ ...it, id: String(idx + 1) }))
      : [emptyItem()],
  );

  const clearFieldError = (field: FieldName) => {
    if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const resetForm = () => {
    setEmployeeName(initialData?.employeeName || '');
    setMerchantName(initialData?.merchantName || '');
    setCategory(initialData?.category || '');
    setExpenseDate(initialData?.expenseDate || today());
    setCurrency(initialData?.currency || baseCurrency || '');
    currencyTouched.current = Boolean(initialData?.currency);
    setAmount(initialData?.amount !== undefined ? String(initialData.amount) : '');
    setNotes(initialData?.notes || '');
    setReceiptUrl(initialData?.receiptUrl || null);
    setReceiptFileName(null);
    setReceiptFile(null);
    setIsDragging(false);
    setIsScanning(false);
    setScanResult(null);
    setFieldErrors({});
    setScanError(null);
    setSubmitError(null);
    setItems([emptyItem()]);
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
        setAmount(String(Math.round(calculatedSum * 100) / 100));
      }

      return updated;
    });
    if (field === 'description') clearFieldError('merchantName');
    if (field === 'quantity' || field === 'unitPrice') clearFieldError('amount');
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      { id: Date.now().toString(), description: '', quantity: 1, unitPrice: 0, amount: 0 },
    ]);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) {
      setItems([emptyItem()]);
      return;
    }
    setItems((prev) => {
      const updated = prev.filter((it) => it.id !== id);
      const calculatedSum = updated.reduce((sum, it) => sum + (it.amount || 0), 0);
      if (calculatedSum > 0) {
        setAmount(String(Math.round(calculatedSum * 100) / 100));
      }
      return updated;
    });
  };

  // Handle Receipt Upload
  const handleFile = (file: File) => {
    setScanError(null);
    setReceiptFileName(file.name);
    setReceiptFile(file);

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

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
    // The same photo can be picked again after it is removed.
    e.target.value = '';
  };

  // Trigger AI OCR Scan
  const handleScanReceipt = async () => {
    if (!receiptUrl) {
      setScanError('Add the receipt first, then scan it.');
      return;
    }
    if (receiptFile && receiptFile.size > RECEIPT_SCAN_MAX_BYTES) {
      setScanError('That file is over 20 MB. Upload a smaller scan or a photo of the receipt.');
      return;
    }
    if (receiptFile && !isBillCaptureContentType(receiptFile.type)) {
      setScanError('The scanner reads JPEG, PNG, WebP or PDF. This file can still go on the claim; type the details in.');
      return;
    }

    try {
      setIsScanning(true);
      setScanError(null);

      const input = receiptScanInput(receiptUrl, receiptFile);
      const result: ScannedReceiptResult = onScanReceipt
        ? await onScanReceipt(input)
        : await scanReceiptMutation.mutateAsync(input);

      setScanResult(result);

      // Auto populate fields
      if (result.merchantName) setMerchantName(result.merchantName);
      if (result.amount) setAmount(String(result.amount));
      if (result.currency) {
        currencyTouched.current = true;
        setCurrency(result.currency);
      }
      if (result.expenseDate) setExpenseDate(result.expenseDate.split('T')[0]);
      if (result.category) {
        // match category or fallback
        const suggested = normaliseExpenseCategory(result.category);
        const matched = EXPENSE_CATEGORIES.find(
          (c) => c.value.toLowerCase() === suggested.toLowerCase(),
        );
        setCategory(matched ? matched.value : suggested);
      }
      setFieldErrors({});

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
    } catch (err: unknown) {
      setScanError(
        err instanceof Error && err.message
          ? err.message
          : 'The scan did not go through. Try again, or type the details in.',
      );
    } finally {
      setIsScanning(false);
    }
  };

  const validate = (status: 'DRAFT' | 'SUBMITTED'): FieldErrors => {
    const errors: FieldErrors = {};
    if (!merchantName.trim() && items.every((i) => !i.description.trim())) {
      errors.merchantName = 'Enter the merchant, or describe at least one line item.';
    }
    // A draft can wait for its category; a submitted claim posts to one.
    if (status === 'SUBMITTED' && !category) {
      errors.category = 'Choose a category.';
    }
    if (!expenseDate) {
      errors.expenseDate = 'Enter the date it was spent.';
    }
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      errors.amount = 'Enter an amount above zero.';
    }
    return errors;
  };

  // Submission handler
  const handleFormSubmit = async (status: 'DRAFT' | 'SUBMITTED') => {
    setSubmitError(null);

    const errors = validate(status);
    setFieldErrors(errors);
    const firstWrong = FIELD_ORDER.find((field) => errors[field]);
    if (firstWrong) {
      const field = {
        merchantName: merchantRef,
        category: categoryRef,
        expenseDate: dateRef,
        amount: amountRef,
      }[firstWrong];
      field.current?.focus();
      return;
    }

    // A picked receipt is uploaded as a file after the claim is created; one
    // already stored is kept as the link it is.
    const keptReceiptUrl = receiptUrl && !receiptUrl.startsWith('data:') ? receiptUrl : null;

    const payload: CreateExpenseClaimPayload = {
      // Blank means the person signed in, which the API fills in.
      employeeName: employeeName.trim() || undefined,
      merchantName: merchantName.trim() || null,
      category,
      expenseDate,
      // Blank only while the organisation loads; the API then uses the base currency.
      currency: currency || undefined,
      amount: parseFloat(amount),
      receiptUrl: receiptFile ? null : keptReceiptUrl,
      notes: notes.trim() || null,
      status,
      items: items
        .filter((it) => it.description.trim() || it.amount > 0)
        .map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
    };

    try {
      await onSubmit(payload, receiptFile);
      handleClose();
    } catch (err: unknown) {
      setSubmitError(
        err instanceof Error && err.message ? err.message : 'The claim was not saved. Try again.',
      );
    }
  };

  const categoryListed = !category || SHARED_EXPENSE_CATEGORIES.includes(category);
  const lineControl =
    'h-10 w-full rounded-xl border border-border-control bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-hidden focus:border-brand-ring focus:ring-1 focus:ring-brand-ring';

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Submit Expense Claim"
      description="Add the receipt and let the scanner fill in the details, or type them in."
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
        {/* Receipt */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Receipt</p>

          <div
            data-testid="receipt-dropzone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-5 text-center transition-colors',
              isDragging
                ? 'border-brand-ring bg-brand-soft'
                : receiptUrl
                  ? 'border-success/40 bg-success-soft'
                  : 'border-border-control bg-surface-muted',
            )}
          >
            {/* image/* so a phone offers its camera as well as its files. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              data-testid="receipt-file-input"
              className="hidden"
              onChange={pickFile}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              data-testid="receipt-camera-input"
              className="hidden"
              onChange={pickFile}
            />

            {receiptUrl ? (
              <div className="flex w-full flex-col items-center justify-between gap-4 px-2 sm:flex-row">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="shrink-0 rounded-xl border border-success/20 bg-surface p-2.5 text-success">
                    <Receipt className="size-6" aria-hidden />
                  </div>
                  <div className="min-w-0 text-start">
                    <p className="max-w-[200px] truncate text-sm font-medium text-ink sm:max-w-xs">
                      {receiptFileName || 'Receipt attached'}
                    </p>
                    <p className="text-xs text-ink-muted">Attached. Scan it to fill in the details.</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    data-testid="btn-scan-receipt"
                    disabled={isScanning}
                    onClick={handleScanReceipt}
                  >
                    {isScanning ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="size-4" aria-hidden />
                    )}
                    {isScanning ? 'Scanning…' : 'Scan with AI'}
                  </Button>

                  <button
                    type="button"
                    onClick={() => {
                      setReceiptUrl(null);
                      setReceiptFileName(null);
                      setReceiptFile(null);
                      setScanResult(null);
                      setScanError(null);
                    }}
                    aria-label="Remove receipt"
                    data-testid="btn-remove-receipt"
                    className="grid size-11 cursor-pointer place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Upload className="size-6 stroke-[1.8] text-ink-subtle" aria-hidden />
                <p className="text-sm text-ink-muted">Drop the receipt here, or</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    data-testid="btn-choose-receipt"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="size-4" aria-hidden />
                    Take photo or choose file
                  </Button>
                  {isTouch && (
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      data-testid="btn-take-photo"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="size-4" aria-hidden />
                      Take photo
                    </Button>
                  )}
                </div>
                <p className="text-xs text-ink-muted">A photo or a PDF. The scanner reads JPEG, PNG, WebP and PDF.</p>
              </div>
            )}
          </div>

          {scanError && (
            <p
              data-testid="scan-error"
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-ink"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <span>{scanError}</span>
            </p>
          )}

          {scanResult && (
            <div
              data-testid="ai-scan-success-banner"
              className="flex items-center justify-between gap-2 rounded-xl border border-success/25 bg-success-soft px-3.5 py-2 text-xs text-ink"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                <span>
                  Scanned: filled in {scanResult.merchantName || 'the details'} ({scanResult.items?.length || 0}{' '}
                  {scanResult.items?.length === 1 ? 'item' : 'items'}). Check them before you submit.
                </span>
              </div>
              {typeof scanResult.confidence === 'number' && (
                <Badge tone="success" className="tabular-nums">
                  {Math.round(scanResult.confidence * 100)}% sure
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* Claim details */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Employee / Submitter"
            data-testid="input-employee-name"
            placeholder="You, if left blank"
            value={employeeName}
            onChange={(e) => setEmployeeName(e.target.value)}
          />

          <Input
            ref={merchantRef}
            label="Merchant / Vendor"
            data-testid="input-merchant-name"
            required
            placeholder="e.g. ENOC, Dragon Mart, Ace Hardware"
            value={merchantName}
            error={fieldErrors.merchantName}
            onChange={(e) => {
              setMerchantName(e.target.value);
              clearFieldError('merchantName');
            }}
          />

          {/* Native select, grouped as the shared list groups them. */}
          <div className="space-y-1.5">
            <label htmlFor={categoryId} className="block text-sm font-medium text-ink">
              Expense Category
              <span className="ms-0.5 text-danger" aria-hidden>
                *
              </span>
            </label>
            <select
              ref={categoryRef}
              id={categoryId}
              data-testid="select-category"
              value={category}
              aria-invalid={fieldErrors.category ? true : undefined}
              aria-describedby={fieldErrors.category ? `${categoryId}-message` : undefined}
              onChange={(e) => {
                setCategory(e.target.value);
                clearFieldError('category');
              }}
              className={cn(
                'h-10 w-full appearance-none rounded-xl border bg-surface px-3 pe-8 text-sm text-ink transition-colors focus:outline-hidden focus:ring-1 focus:ring-brand-ring focus:border-brand-ring',
                fieldErrors.category ? 'border-danger' : 'border-border-control hover:border-ink-subtle',
              )}
            >
              <option value="">Choose a category</option>
              {!categoryListed && <option value={category}>{category}</option>}
              {EXPENSE_CATEGORY_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {fieldErrors.category && (
              <p id={`${categoryId}-message`} className="text-xs text-danger" role="alert">
                {fieldErrors.category}
              </p>
            )}
          </div>

          <Input
            ref={dateRef}
            label="Expense Date"
            type="date"
            data-testid="input-expense-date"
            required
            value={expenseDate}
            error={fieldErrors.expenseDate}
            onChange={(e) => {
              setExpenseDate(e.target.value);
              clearFieldError('expenseDate');
            }}
          />

          <Select
            label="Currency"
            data-testid="select-currency"
            value={currency}
            placeholder={currency ? undefined : 'Base currency'}
            onChange={(e) => {
              currencyTouched.current = true;
              setCurrency(e.target.value);
            }}
            options={CURRENCY_OPTIONS}
          />

          <Input
            ref={amountRef}
            label="Total Amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            required
            data-testid="input-amount"
            placeholder="0.00"
            className="tabular-nums"
            value={amount}
            error={fieldErrors.amount}
            onChange={(e) => {
              setAmount(e.target.value);
              clearFieldError('amount');
            }}
          />
        </div>

        {/* Line items */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Line items ({items.length})
            </p>
            <Button
              type="button"
              variant="ghost"
              data-testid="btn-add-line-item"
              onClick={handleAddItem}
            >
              <Plus className="size-4" aria-hidden />
              Add item
            </Button>
          </div>

          <div
            data-testid="line-items-container"
            className="space-y-2 rounded-2xl border border-border bg-surface-muted p-3"
          >
            {items.map((item, index) => (
              <div
                key={item.id}
                data-testid={`line-item-row-${index}`}
                className="grid grid-cols-12 items-center gap-2 rounded-xl border border-border bg-surface p-2"
              >
                <div className="col-span-12 sm:col-span-5">
                  <input
                    type="text"
                    placeholder="Description (e.g. Cutting discs)"
                    aria-label={`Item ${index + 1} description`}
                    data-testid={`line-item-desc-${index}`}
                    value={item.description}
                    onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                    className={lineControl}
                  />
                </div>

                <div className="col-span-3 sm:col-span-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="1"
                    placeholder="Qty"
                    aria-label={`Item ${index + 1} quantity`}
                    data-testid={`line-item-qty-${index}`}
                    value={item.quantity}
                    onChange={(e) => handleItemChange(item.id, 'quantity', Number(e.target.value))}
                    className={cn(lineControl, 'text-end tabular-nums')}
                  />
                </div>

                <div className="col-span-4 sm:col-span-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="Price"
                    aria-label={`Item ${index + 1} unit price`}
                    data-testid={`line-item-price-${index}`}
                    value={item.unitPrice || ''}
                    onChange={(e) => handleItemChange(item.id, 'unitPrice', Number(e.target.value))}
                    className={cn(lineControl, 'text-end tabular-nums')}
                  />
                </div>

                <div className="col-span-3 text-end sm:col-span-2">
                  <span
                    data-testid={`line-item-total-${index}`}
                    className="text-sm font-semibold tabular-nums text-ink"
                  >
                    {formatExpenseCurrency(item.amount || 0, currency)}
                  </span>
                </div>

                <div className="col-span-2 flex justify-end sm:col-span-1">
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.id)}
                    aria-label={`Remove item ${index + 1}`}
                    data-testid={`btn-remove-line-item-${index}`}
                    className="grid size-10 cursor-pointer place-items-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Textarea
          label="Business purpose / notes (optional)"
          data-testid="input-notes"
          placeholder="What it was for, and for which job or customer"
          maxLength={EXPENSE_NOTES_MAX_LENGTH}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {submitError && (
          <p
            data-testid="form-error-alert"
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-ink"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <span>{submitError}</span>
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
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
              Save as draft
            </Button>

            <Button
              type="submit"
              variant="primary"
              data-testid="btn-submit-claim"
              loading={isLoading}
              disabled={isScanning}
            >
              Submit claim
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
