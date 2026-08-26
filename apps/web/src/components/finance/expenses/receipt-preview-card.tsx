'use client';

import React, { useState } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Minimize2,
  ExternalLink,
  Receipt,
  Sparkles,
  FileText,
  Upload,
  Calendar,
  Building2,
  Tag,
  DollarSign,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { ExpenseClaimDto, ScannedReceiptResult } from '@saas/shared';
import { cn } from '@/lib/utils';
import { Badge, Card, CardBody, CardHeader, CardTitle } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

export interface ReceiptPreviewCardProps {
  receiptUrl?: string | null;
  merchantName?: string | null;
  amount?: number | null;
  currency?: string;
  expenseDate?: string | null;
  category?: string | null;
  ocrData?: ScannedReceiptResult | null;
  claim?: ExpenseClaimDto | null;
  onUploadNewReceipt?: () => void;
  showOcrMetadata?: boolean;
  enableFullscreen?: boolean;
  className?: string;
}

export function formatExpenseCurrency(
  amount: number | null | undefined,
  currency: string = 'USD',
): string {
  const value = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export function ReceiptPreviewCard({
  receiptUrl,
  merchantName,
  amount,
  currency = 'USD',
  expenseDate,
  category,
  ocrData,
  claim,
  onUploadNewReceipt,
  showOcrMetadata = true,
  enableFullscreen = true,
  className,
}: ReceiptPreviewCardProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [showRawText, setShowRawText] = useState(false);

  const effectiveReceiptUrl = receiptUrl ?? claim?.receiptUrl;
  const effectiveMerchant = merchantName ?? ocrData?.merchantName ?? claim?.merchantName ?? 'Unknown Merchant';
  const effectiveAmount = amount ?? ocrData?.amount ?? claim?.amount ?? 0;
  const effectiveCurrency = currency ?? ocrData?.currency ?? claim?.currency ?? 'USD';
  const effectiveDate = expenseDate ?? ocrData?.expenseDate ?? claim?.expenseDate;
  const effectiveCategory = category ?? ocrData?.category ?? claim?.category;
  const confidence = ocrData?.confidence;

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3.0));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => {
    setZoom(1);
    setRotation(0);
  };
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);

  const getConfidenceBadgeTone = (conf?: number) => {
    if (typeof conf !== 'number') return 'brand';
    if (conf >= 0.85) return 'success';
    if (conf >= 0.6) return 'warning';
    return 'danger';
  };

  return (
    <Card
      data-testid="receipt-preview-card"
      className={cn('flex flex-col overflow-hidden border border-border/40 shadow-xs bg-surface/90', className)}
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/25 bg-surface-muted/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <Receipt className="size-4 text-ink-muted" />
          <CardTitle className="text-sm font-semibold text-ink">Receipt Document</CardTitle>
          {effectiveReceiptUrl && (
            <Badge tone="neutral" className="text-[10px] uppercase font-mono tracking-wider">
              {effectiveReceiptUrl.startsWith('data:') ? 'Image' : effectiveReceiptUrl.split('.').pop()?.toUpperCase() || 'Attachment'}
            </Badge>
          )}
        </div>

        {effectiveReceiptUrl && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              aria-label="Zoom Out"
              data-testid="receipt-zoom-out"
              title="Zoom Out"
              className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-40 cursor-pointer"
            >
              <ZoomOut className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              aria-label="Reset Zoom"
              data-testid="receipt-zoom-reset"
              title="Reset Zoom (100%)"
              className="rounded-lg px-1.5 py-1 text-xs font-mono text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink cursor-pointer"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= 3.0}
              aria-label="Zoom In"
              data-testid="receipt-zoom-in"
              title="Zoom In"
              className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-40 cursor-pointer"
            >
              <ZoomIn className="size-4" />
            </button>
            <button
              type="button"
              onClick={handleRotate}
              aria-label="Rotate Image"
              data-testid="receipt-rotate"
              title="Rotate 90°"
              className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink cursor-pointer"
            >
              <RotateCw className="size-4" />
            </button>
            {enableFullscreen && (
              <button
                type="button"
                onClick={() => setIsFullscreenOpen(true)}
                aria-label="Fullscreen Preview"
                data-testid="receipt-fullscreen-toggle"
                title="Fullscreen Preview"
                className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink cursor-pointer"
              >
                <Maximize2 className="size-4" />
              </button>
            )}
            {effectiveReceiptUrl && !effectiveReceiptUrl.startsWith('data:') && (
              <a
                href={effectiveReceiptUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open in new tab"
                title="Open original file"
                className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
        )}
      </CardHeader>

      <CardBody className="p-0">
        {effectiveReceiptUrl ? (
          <div
            data-testid="receipt-viewport"
            className="relative flex min-h-[300px] max-h-[480px] w-full items-center justify-center overflow-auto bg-stone-900/5 p-4 scrollbar-thin dark:bg-stone-950/40"
          >
            <div
              data-testid="receipt-image-container"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                transformOrigin: 'center center',
                transition: 'transform 0.15s ease-out',
              }}
              className="flex items-center justify-center shadow-md rounded-lg overflow-hidden bg-surface"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={effectiveReceiptUrl}
                alt={`Receipt for ${effectiveMerchant}`}
                data-testid="receipt-image"
                className="max-h-[420px] w-auto object-contain select-none"
              />
            </div>
          </div>
        ) : (
          <div
            data-testid="receipt-empty-state"
            className="flex flex-col items-center justify-center p-8 text-center bg-surface-muted/10 min-h-[240px]"
          >
            <div className="rounded-2xl bg-surface-muted/50 p-4 text-ink-subtle border border-border/30">
              <FileText className="size-8 stroke-[1.5]" />
            </div>
            <h4 className="mt-3 text-sm font-semibold text-ink">No Receipt Attached</h4>
            <p className="mt-1 text-xs text-ink-muted max-w-xs">
              Upload a digital receipt, snapshot, or invoice scan to view details and trigger AI parsing.
            </p>
            {onUploadNewReceipt && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onUploadNewReceipt}
                className="mt-4 gap-1.5 text-xs"
              >
                <Upload className="size-3.5" />
                Upload Receipt
              </Button>
            )}
          </div>
        )}

        {/* OCR metadata badges and extraction panel */}
        {showOcrMetadata && (ocrData || claim) && (
          <div
            data-testid="ocr-metadata-panel"
            className="border-t border-border/25 bg-surface px-4 py-3.5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-brand" />
                <span className="text-xs font-semibold text-ink">Extracted Receipt Metadata</span>
              </div>
              {confidence !== undefined && (
                <Badge
                  data-testid="ocr-confidence-badge"
                  tone={getConfidenceBadgeTone(confidence)}
                  className="gap-1 text-[11px] font-medium"
                >
                  <Sparkles className="size-2.5" />
                  {Math.round(confidence * 100)}% AI Match
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="rounded-xl border border-border/30 bg-surface-muted/30 p-2">
                <div className="flex items-center gap-1 text-[11px] text-ink-muted mb-0.5">
                  <Building2 className="size-3 text-ink-subtle" />
                  Merchant
                </div>
                <span className="font-medium text-ink truncate block" title={effectiveMerchant}>
                  {effectiveMerchant}
                </span>
              </div>

              <div className="rounded-xl border border-border/30 bg-surface-muted/30 p-2">
                <div className="flex items-center gap-1 text-[11px] text-ink-muted mb-0.5">
                  <Calendar className="size-3 text-ink-subtle" />
                  Date
                </div>
                <span className="font-medium text-ink block">
                  {effectiveDate ? new Date(effectiveDate).toLocaleDateString() : '—'}
                </span>
              </div>

              <div className="rounded-xl border border-border/30 bg-surface-muted/30 p-2">
                <div className="flex items-center gap-1 text-[11px] text-ink-muted mb-0.5">
                  <DollarSign className="size-3 text-ink-subtle" />
                  Amount
                </div>
                <span className="font-semibold text-ink block">
                  {formatExpenseCurrency(effectiveAmount, effectiveCurrency)}
                </span>
              </div>

              <div className="rounded-xl border border-border/30 bg-surface-muted/30 p-2">
                <div className="flex items-center gap-1 text-[11px] text-ink-muted mb-0.5">
                  <Tag className="size-3 text-ink-subtle" />
                  Category
                </div>
                <span className="font-medium text-ink capitalize truncate block">
                  {effectiveCategory || 'Uncategorized'}
                </span>
              </div>
            </div>

            {/* Line items extracted summary if available */}
            {ocrData?.items && ocrData.items.length > 0 && (
              <div className="mt-2 text-xs">
                <div className="flex items-center justify-between text-ink-muted mb-1 text-[11px]">
                  <span>Extracted Items ({ocrData.items.length})</span>
                  {ocrData.taxAmount !== undefined && (
                    <span>Tax: {formatExpenseCurrency(ocrData.taxAmount, effectiveCurrency)}</span>
                  )}
                </div>
                <div className="divide-y divide-border/20 rounded-xl border border-border/30 bg-surface-muted/15 overflow-hidden">
                  {ocrData.items.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between px-3 py-1.5 text-xs">
                      <span className="text-ink truncate mr-2">{item.description || `Item #${idx + 1}`}</span>
                      <span className="font-mono text-ink-muted shrink-0">
                        {formatExpenseCurrency(item.amount, effectiveCurrency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Raw OCR Text toggle */}
            {ocrData?.rawText && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowRawText(!showRawText)}
                  className="flex items-center gap-1 text-[11px] font-medium text-brand hover:underline cursor-pointer"
                >
                  {showRawText ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  {showRawText ? 'Hide OCR Raw Text' : 'View OCR Raw Text'}
                </button>
                {showRawText && (
                  <pre
                    data-testid="ocr-raw-text"
                    className="mt-2 max-h-32 overflow-auto rounded-xl border border-border/30 bg-surface-muted/40 p-2.5 font-mono text-[10px] text-ink-muted whitespace-pre-wrap"
                  >
                    {ocrData.rawText}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </CardBody>

      {/* Fullscreen Dialog Modal */}
      {enableFullscreen && effectiveReceiptUrl && (
        <Dialog
          open={isFullscreenOpen}
          onClose={() => setIsFullscreenOpen(false)}
          title={`Receipt Preview - ${effectiveMerchant}`}
          description={`Amount: ${formatExpenseCurrency(effectiveAmount, effectiveCurrency)} • Date: ${effectiveDate ? new Date(effectiveDate).toLocaleDateString() : 'N/A'}`}
          size="lg"
        >
          <div className="flex flex-col items-center justify-center p-2">
            <div className="flex items-center gap-2 mb-3 bg-surface-muted/40 p-1.5 rounded-xl border border-border/30">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoom <= 0.5}
                className="rounded-lg p-1.5 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-40"
              >
                <ZoomOut className="size-4" />
              </button>
              <span className="text-xs font-mono text-ink">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoom >= 3.0}
                className="rounded-lg p-1.5 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-40"
              >
                <ZoomIn className="size-4" />
              </button>
              <button
                type="button"
                onClick={handleRotate}
                className="rounded-lg p-1.5 text-ink-muted hover:bg-surface hover:text-ink"
              >
                <RotateCw className="size-4" />
              </button>
            </div>
            <div className="max-h-[60vh] w-full overflow-auto rounded-xl bg-stone-900/5 p-4 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={effectiveReceiptUrl}
                alt={`Receipt for ${effectiveMerchant}`}
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transformOrigin: 'center center',
                }}
                className="max-h-[50vh] w-auto object-contain transition-transform"
              />
            </div>
          </div>
        </Dialog>
      )}
    </Card>
  );
}
