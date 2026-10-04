'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, Download, Loader2 } from 'lucide-react';
import type { UniversalDocumentData, DocumentType, DocumentTemplateConfig } from '@saas/shared';
import { Button } from '@/components/ui/button';
import { DocumentTemplateSheet } from './document-template-sheet';
import { useResolveDocumentTemplate } from '@/hooks/use-document-templates';
import { toast } from 'sonner';

export interface DocumentPrintModalProps {
  open: boolean;
  onClose: () => void;
  documentType: DocumentType;
  data: UniversalDocumentData;
  templateConfig?: DocumentTemplateConfig;
  documentId?: string | null;
  downloadPdfFn?: (id: string) => Promise<Blob>;
  onSaveBeforeDownload?: () => Promise<string | null>;
  organizationName?: string;
}

export function DocumentPrintModal({
  open,
  onClose,
  documentType,
  data,
  templateConfig,
  documentId,
  downloadPdfFn,
  onSaveBeforeDownload,
  organizationName,
}: DocumentPrintModalProps) {
  const [mounted, setMounted] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Automatically fetch active template for this document type if not explicitly supplied
  const { config: resolvedConfig, isLoading: isLoadingTemplate } =
    useResolveDocumentTemplate(documentType);

  const activeConfig = templateConfig ?? resolvedConfig;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('quote-print-modal-open');
    return () => {
      document.body.classList.remove('quote-print-modal-open');
    };
  }, [open]);

  if (!open || !mounted) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    let targetId = documentId;
    if (!targetId && onSaveBeforeDownload) {
      targetId = await onSaveBeforeDownload();
    }

    if (!targetId || !downloadPdfFn) {
      toast.info('Opening print dialog to Save as PDF');
      window.print();
      return;
    }

    try {
      setIsDownloading(true);
      const blob = await downloadPdfFn(targetId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${data.number || `${documentType.toLowerCase()}-${targetId}`}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success('Document PDF downloaded');
    } catch (err) {
      toast.error('Could not download server PDF, opening browser print to Save as PDF');
      window.print();
    } finally {
      setIsDownloading(false);
    }
  };

  const modalContent = (
    <div
      id="quote-print-modal-root"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 print:static print:inset-auto print:z-auto print:p-0 print:m-0 print:bg-white print:backdrop-blur-none print:block print:overflow-visible print:w-full print:h-auto"
      role="dialog"
      aria-modal="true"
    >
      {/* Modal Container */}
      <div className="relative w-full max-w-4xl rounded-2xl bg-surface shadow-2xl border border-border flex flex-col max-h-[90vh] overflow-hidden print:static print:w-full print:max-w-none print:m-0 print:p-0 print:rounded-none print:border-none print:shadow-none print:bg-white print:max-h-none print:overflow-visible print:block">
        {/* Top Control Bar (Hidden during print) */}
        <div className="flex items-center justify-between border-b border-border bg-surface-muted/50 px-6 py-4 print:hidden">
          <div className="flex items-center gap-2">
            <Printer className="size-5 text-brand" />
            <h2 className="text-base font-bold text-ink">
              {documentType.replace('_', ' ')} Document Preview
            </h2>
            <span className="text-xs text-ink-subtle">({data.number || 'Draft'})</span>
            {isLoadingTemplate && (
              <span className="flex items-center gap-1 text-[11px] text-ink-subtle">
                <Loader2 className="size-3 animate-spin" /> Loading template...
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {downloadPdfFn && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={isDownloading}
                disabled={isDownloading}
                onClick={handleDownloadPdf}
                className="gap-2 text-xs"
              >
                <Download className="size-4" />
                <span>Download PDF</span>
              </Button>
            )}
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handlePrint}
              className="gap-2 text-xs"
            >
              <Printer className="size-4" />
              <span>Print / Save as PDF</span>
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Body */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-10 print:p-0 print:m-0 print:overflow-visible bg-white text-slate-900 scrollbar-thin">
          <DocumentTemplateSheet
            data={data}
            config={activeConfig}
            organizationName={organizationName}
          />
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
