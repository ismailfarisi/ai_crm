'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileScan } from 'lucide-react';
import { toast } from 'sonner';
import {
  BILL_CAPTURE_CONTENT_TYPES,
  BILL_CAPTURE_MAX_BYTES,
  type BillCaptureResult,
  type PurchaseOrderStatus,
} from '@saas/shared';
import { useBillableLines, useCaptureBill } from '@/hooks/use-bills';
import { usePurchaseOrder, usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { useSuppliers } from '@/hooks/use-suppliers';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/field';
import { EnterBillDialog } from './enter-bill-dialog';
import { prefillFromCapture } from './capture-prefill';

/** Orders a supplier can still be billing against — the same set the API reads against. */
const BILLABLE: PurchaseOrderStatus[] = ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED'];

/** Shown on the review step; line pairing warnings belong to the bill form. */
const REVIEW_HIDES = new Set(['LINE_NOT_ON_ORDER']);

const money = (n: number | null) =>
  n == null ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "Read an invoice": a file in, the ordinary bill form out, filled in.
 *
 * Reading saves nothing. The person confirms the supplier and order here,
 * then checks the pre-filled form, and the bill is saved through the same
 * route — and the same three-way match — as one typed in by hand.
 */
export function CaptureBillFlow() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const capture = useCaptureBill();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BillCaptureResult | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setResult(null);
    setOrderId(null);
    if (input.current) input.current.value = '';
  };

  const read = async (picked: File) => {
    if (picked.size > BILL_CAPTURE_MAX_BYTES) {
      toast.error('That file is over 20 MB. Send a smaller scan or a photo of the invoice.');
      reset();
      return;
    }
    setFile(picked);
    try {
      setResult(await capture.mutateAsync(picked));
    } catch {
      // The hook has already said why.
      reset();
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={BILL_CAPTURE_CONTENT_TYPES.join(',')}
        className="hidden"
        aria-label="Supplier invoice file"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) void read(picked);
        }}
      />
      <Button variant="secondary" loading={capture.isPending} onClick={() => input.current?.click()}>
        <FileScan className="size-4" />
        {capture.isPending ? 'Reading invoice…' : 'Read an invoice'}
      </Button>

      {result && !orderId && (
        <ReviewDialog result={result} fileName={file?.name ?? ''} onCancel={reset} onContinue={setOrderId} />
      )}
      {result && orderId && (
        <PrefilledBill
          key={orderId}
          result={result}
          orderId={orderId}
          file={file}
          onClose={reset}
          onCreated={(id) => router.push(`/purchasing/bills/${id}`)}
        />
      )}
    </>
  );
}

function ReviewDialog({
  result,
  fileName,
  onCancel,
  onContinue,
}: {
  result: BillCaptureResult;
  fileName: string;
  onCancel: () => void;
  onContinue: (orderId: string) => void;
}) {
  const { invoice } = result;
  const [supplierId, setSupplierId] = useState(result.supplier?.id ?? '');
  const [chosenOrder, setChosenOrder] = useState<string | null>(null);

  const { data: suppliers } = useSuppliers({ page: 1, limit: 100, sortBy: 'companyName', sortOrder: 'ASC' });
  const { data: orders } = usePurchaseOrders({ page: 1, limit: 100, ...(supplierId ? { supplierId } : {}) });

  const openOrders = useMemo(
    () => (supplierId ? (orders?.items ?? []).filter((o) => o.supplierId === supplierId && BILLABLE.includes(o.status)) : []),
    [orders, supplierId],
  );
  // Capture's own choice stands only while the supplier it chose it for does.
  const suggested =
    supplierId === result.supplier?.id ? result.purchaseOrder?.id : openOrders.length === 1 ? openOrders[0].id : undefined;
  const orderId = chosenOrder ?? suggested ?? '';

  const notInvoice = result.warnings.some((w) => w.code === 'NOT_AN_INVOICE');
  const warnings = result.warnings.filter((w) => !REVIEW_HIDES.has(w.code));
  const candidateNames = result.supplierCandidates.map((c) => c.companyName).join(', ');

  return (
    <Dialog
      open
      onClose={onCancel}
      size="lg"
      title="Check what was read"
      description={fileName ? `From ${fileName}. Nothing is saved until you save the bill.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={notInvoice || !!result.duplicateOf || !orderId} onClick={() => onContinue(orderId)}>
            Continue to the bill
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded bg-surface-sunk p-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-subtle">Supplier on the invoice</dt>
            <dd className="text-ink">{invoice.supplierName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Their invoice</dt>
            <dd className="text-ink">{invoice.supplierInvoiceNumber ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Dated</dt>
            <dd className="text-ink">{invoice.billDate ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-subtle">Total</dt>
            <dd className="tabular-nums text-ink">
              {money(invoice.totalAmount)} {invoice.currency ?? ''}
            </dd>
          </div>
        </dl>

        {warnings.length > 0 && (
          <ul className="space-y-1 rounded border border-warning/40 bg-warning-soft/40 p-3 text-sm text-ink-muted">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        )}

        {result.duplicateOf && (
          <p className="text-sm">
            <Link href={`/purchasing/bills/${result.duplicateOf.id}`} className="font-medium text-ink underline underline-offset-2">
              Open {result.duplicateOf.billNumber}
            </Link>
          </p>
        )}

        {!notInvoice && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id="capture-supplier"
              label="Supplier"
              value={supplierId}
              placeholder="Choose the supplier"
              hint={!result.supplier && candidateNames ? `Closest names: ${candidateNames}` : undefined}
              options={(suppliers?.items ?? []).map((s) => ({ value: s.id, label: s.companyName }))}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setChosenOrder(null);
              }}
            />
            <Select
              id="capture-order"
              label="Purchase order"
              value={orderId}
              placeholder={supplierId ? 'Choose the order' : 'Choose a supplier first'}
              disabled={!supplierId}
              hint={
                supplierId && openOrders.length === 0
                  ? 'This supplier has no open orders. Bills are entered against an order.'
                  : undefined
              }
              options={openOrders.map((o) => ({
                value: o.id,
                label: `${o.poNumber} · ${money(o.totalAmount)} ${o.currency}`,
              }))}
              onChange={(e) => setChosenOrder(e.target.value)}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

function PrefilledBill({
  result,
  orderId,
  file,
  onClose,
  onCreated,
}: {
  result: BillCaptureResult;
  orderId: string;
  file: File | null;
  onClose: () => void;
  onCreated: (billId: string) => void;
}) {
  const { data: order } = usePurchaseOrder(orderId);
  const { data: billable } = useBillableLines(orderId);
  const prefill = useMemo(
    () => (billable ? prefillFromCapture(result, orderId, billable, file) : null),
    [billable, result, orderId, file],
  );

  // The form reads its prefill once, so it mounts only when everything is in.
  if (!order || !prefill) return null;
  return (
    <EnterBillDialog
      open
      order={order}
      prefill={prefill}
      onClose={onClose}
      onCreated={(bill) => onCreated(bill.id)}
    />
  );
}
