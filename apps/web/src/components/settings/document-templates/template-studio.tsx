'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Save,
  Sparkles,
  Sliders,
  Palette,
  FileSpreadsheet,
  Building,
  Calculator,
  FileCheck,
} from 'lucide-react';
import {
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  type DocumentTemplateConfig,
  type DocumentType,
} from '@saas/shared';
import { useDocumentTemplates } from '@/hooks/use-document-templates';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select } from '@/components/ui/field';
import { TemplatePreviewPanel } from './template-preview-panel';

interface TemplateStudioProps {
  templateId: string;
}

const STARTER_CHIPS = [
  'Modern Minimalist',
  'Royal Blue Tech',
  'Add Wire Transfer Info',
  'Compact Table',
];

const ALL_DOCUMENT_TYPES: { type: DocumentType; label: string }[] = [
  { type: 'INVOICE', label: 'Invoice' },
  { type: 'QUOTE', label: 'Quote' },
  { type: 'STATEMENT', label: 'Statement' },
  { type: 'DELIVERY_NOTE', label: 'Delivery Note' },
  { type: 'PURCHASE_ORDER', label: 'Purchase Order' },
];

export function TemplateStudio({ templateId }: TemplateStudioProps) {
  const router = useRouter();
  const isNew = templateId === 'new';

  const {
    template,
    isLoading,
    isSaving,
    isGenerating,
    saveTemplate,
    generateWithAi,
    previewPdf,
  } = useDocumentTemplates({ id: templateId });

  const [name, setName] = useState('New Document Template');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [appliesTo, setAppliesTo] = useState<DocumentType[]>(['INVOICE', 'QUOTE']);
  const [config, setConfig] = useState<DocumentTemplateConfig>(DEFAULT_DOCUMENT_TEMPLATE_CONFIG);
  const [aiPrompt, setAiPrompt] = useState('');

  // Accordion state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    branding: true,
    header: false,
    parties: false,
    itemsTable: false,
    totals: false,
    footer: false,
  });

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  useEffect(() => {
    if (template) {
      setName(template.name || '');
      setDescription(template.description || '');
      setIsDefault(template.isDefault || false);
      setAppliesTo(template.appliesTo || []);
      if (template.config) {
        setConfig(template.config);
      }
    }
  }, [template]);

  const handleAiGenerate = async (promptToUse?: string) => {
    const prompt = promptToUse || aiPrompt;
    if (!prompt.trim()) return;

    try {
      const generated = await generateWithAi(prompt, config);
      if (generated) {
        setConfig(generated);
      }
    } catch {
      // Error handled by hook toast
    }
  };

  const handleChipClick = (chip: string) => {
    setAiPrompt(chip);
    void handleAiGenerate(chip);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      const saved = await saveTemplate({
        id: isNew ? undefined : templateId,
        name,
        description: description || null,
        isDefault,
        appliesTo,
        config,
      });
      if (isNew && saved?.id) {
        router.push(`/settings/document-templates/${saved.id}`);
      }
    } catch {
      // Error handled by hook toast
    }
  };

  const toggleDocumentType = (type: DocumentType) => {
    setAppliesTo((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  if (isLoading && !isNew) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <Loader2 className="size-8 animate-spin text-ink-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 h-[calc(100vh-7rem)] min-h-[700px]">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/30 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/settings/document-templates"
            className="flex items-center justify-center size-9 rounded-xl border border-border/40 bg-surface hover:bg-surface-muted/60 text-ink transition-colors"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-ink">
                {isNew ? 'New Template Studio' : `Edit ${name}`}
              </h1>
              {isDefault && (
                <span className="rounded-full bg-brand-soft/80 border border-brand/20 px-2 py-0.5 text-[11px] font-semibold text-ink">
                  Default
                </span>
              )}
            </div>
            <p className="text-xs text-ink-muted">
              Design documents with AI assistance, real-time preview, and comprehensive manual overrides.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="primary"
            onClick={handleSave}
            loading={isSaving}
            className="shadow-sm font-semibold"
          >
            <Save className="size-4 mr-1.5" />
            Save Template
          </Button>
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left Control Panel */}
        <div className="lg:col-span-5 flex flex-col gap-4 overflow-y-auto pr-1">
          {/* Metadata Section */}
          <div className="rounded-2xl border border-border/30 bg-surface/85 backdrop-blur-xs p-4 space-y-3 shadow-xs">
            <Input
              label="Template Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Modern Minimalist"
              required
            />

            <Input
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of when this template is used"
            />

            <div>
              <label className="block text-xs font-medium text-ink mb-1.5">Applies To Documents</label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_DOCUMENT_TYPES.map(({ type, label }) => {
                  const isChecked = appliesTo.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleDocumentType(type)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        isChecked
                          ? 'bg-brand text-ink font-semibold border border-brand'
                          : 'bg-surface-muted/60 text-ink-muted border border-border/30 hover:border-border'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded border-border text-brand focus:ring-brand size-4 cursor-pointer"
              />
              <span className="text-xs font-medium text-ink">Set as default template for selected types</span>
            </label>
          </div>

          {/* AI Prompt Input Bar */}
          <div className="rounded-2xl border border-brand/30 bg-brand-soft/20 backdrop-blur-xs p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-brand" />
                <span className="text-xs font-bold text-ink">Natural Language AI Designer</span>
              </div>
              <span className="text-[10px] text-ink-muted">Powered by AI</span>
            </div>

            <div className="relative">
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Describe your desired layout (e.g., 'Modern minimalist invoice with navy blue header, compact item rows, and wire transfer bank details in footer')..."
                className="text-xs min-h-[70px] pr-20 resize-none"
              />
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => handleAiGenerate()}
                disabled={isGenerating || !aiPrompt.trim()}
                className="absolute right-2 bottom-2 text-xs h-7 px-2.5"
              >
                {isGenerating ? <Loader2 className="size-3 animate-spin mr-1" /> : <Sparkles className="size-3 mr-1" />}
                Generate
              </Button>
            </div>

            {/* Quick Starter Chips */}
            <div>
              <p className="text-[10px] font-medium text-ink-subtle mb-1.5">Quick Inspiration Chips:</p>
              <div className="flex flex-wrap gap-1.5">
                {STARTER_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleChipClick(chip)}
                    className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-surface/80 px-2.5 py-1 text-[11px] font-medium text-ink-muted hover:border-brand/40 hover:text-ink hover:bg-surface transition-colors cursor-pointer"
                  >
                    <span>✨</span>
                    <span>{chip}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Accordion Manual Sections */}
          <div className="space-y-2">
            {/* 1. Branding & Colors */}
            <div className="rounded-xl border border-border/30 bg-surface/85 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection('branding')}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-ink bg-surface hover:bg-surface-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Palette className="size-4 text-ink-muted" />
                  <span>Branding & Colors</span>
                </div>
                {openSections.branding ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>

              {openSections.branding && (
                <div className="p-4 border-t border-border/20 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-ink mb-1">Primary Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={config.branding.primaryColor}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              branding: { ...prev.branding, primaryColor: e.target.value },
                            }))
                          }
                          className="size-8 rounded border border-border/40 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={config.branding.primaryColor}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              branding: { ...prev.branding, primaryColor: e.target.value },
                            }))
                          }
                          className="flex-1 h-8 rounded-lg border border-border/80 bg-surface px-2 text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-ink mb-1">Secondary Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={config.branding.secondaryColor}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              branding: { ...prev.branding, secondaryColor: e.target.value },
                            }))
                          }
                          className="size-8 rounded border border-border/40 cursor-pointer"
                        />
                        <input
                          type="text"
                          value={config.branding.secondaryColor}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              branding: { ...prev.branding, secondaryColor: e.target.value },
                            }))
                          }
                          className="flex-1 h-8 rounded-lg border border-border/80 bg-surface px-2 text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Select
                      label="Font Family"
                      value={config.branding.fontFamily}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          branding: {
                            ...prev.branding,
                            fontFamily: e.target.value as 'Helvetica' | 'Times-Roman' | 'Courier',
                          },
                        }))
                      }
                      options={[
                        { value: 'Helvetica', label: 'Helvetica (Clean Sans)' },
                        { value: 'Times-Roman', label: 'Times-Roman (Formal Serif)' },
                        { value: 'Courier', label: 'Courier (Technical Mono)' },
                      ]}
                    />

                    <Select
                      label="Layout Density"
                      value={config.branding.layoutDensity}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          branding: {
                            ...prev.branding,
                            layoutDensity: e.target.value as 'compact' | 'normal' | 'relaxed',
                          },
                        }))
                      }
                      options={[
                        { value: 'compact', label: 'Compact' },
                        { value: 'normal', label: 'Normal' },
                        { value: 'relaxed', label: 'Relaxed' },
                      ]}
                    />
                  </div>

                  <Input
                    label="Logo URL"
                    value={config.branding.logoUrl || ''}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        branding: { ...prev.branding, logoUrl: e.target.value },
                      }))
                    }
                    placeholder="https://example.com/logo.png"
                  />
                </div>
              )}
            </div>

            {/* 2. Header Layout */}
            <div className="rounded-xl border border-border/30 bg-surface/85 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection('header')}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-ink bg-surface hover:bg-surface-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Sliders className="size-4 text-ink-muted" />
                  <span>Header Layout</span>
                </div>
                {openSections.header ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>

              {openSections.header && (
                <div className="p-4 border-t border-border/20 space-y-3">
                  <Select
                    label="Header Style"
                    value={config.header.layout}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        header: {
                          ...prev.header,
                          layout: e.target.value as 'split' | 'centered' | 'banner',
                        },
                      }))
                    }
                    options={[
                      { value: 'split', label: 'Split (Standard Left/Right)' },
                      { value: 'centered', label: 'Centered' },
                      { value: 'banner', label: 'Banner Top Bar' },
                    ]}
                  />

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {[
                      { key: 'showLogo', label: 'Show Logo' },
                      { key: 'showCompanyTaxId', label: 'Show Tax ID' },
                      { key: 'showCompanyPhone', label: 'Show Phone' },
                      { key: 'showCompanyEmail', label: 'Show Email' },
                      { key: 'showCompanyAddress', label: 'Show Address' },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.header[key as keyof typeof config.header] as boolean}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              header: { ...prev.header, [key]: e.target.checked },
                            }))
                          }
                          className="rounded border-border text-brand focus:ring-brand size-3.5"
                        />
                        <span className="text-xs text-ink">{label}</span>
                      </label>
                    ))}
                  </div>

                  <div className="pt-2 border-t border-border/20 space-y-2">
                    <p className="text-[11px] font-semibold text-ink">Custom Document Titles</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        label="Invoice Title"
                        value={config.header.customLabels?.invoice || ''}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            header: {
                              ...prev.header,
                              customLabels: { ...prev.header.customLabels, invoice: e.target.value },
                            },
                          }))
                        }
                        placeholder="TAX INVOICE"
                      />
                      <Input
                        label="Quote Title"
                        value={config.header.customLabels?.quote || ''}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            header: {
                              ...prev.header,
                              customLabels: { ...prev.header.customLabels, quote: e.target.value },
                            },
                          }))
                        }
                        placeholder="QUOTATION"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 3. Parties */}
            <div className="rounded-xl border border-border/30 bg-surface/85 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection('parties')}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-ink bg-surface hover:bg-surface-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Building className="size-4 text-ink-muted" />
                  <span>Parties (Customer & Vendor)</span>
                </div>
                {openSections.parties ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>

              {openSections.parties && (
                <div className="p-4 border-t border-border/20 space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      label="Bill To Label"
                      value={config.parties.billToLabel}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          parties: { ...prev.parties, billToLabel: e.target.value },
                        }))
                      }
                    />
                    <Input
                      label="Ship To Label"
                      value={config.parties.shipToLabel}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          parties: { ...prev.parties, shipToLabel: e.target.value },
                        }))
                      }
                    />
                    <Input
                      label="Vendor Label"
                      value={config.parties.supplierLabel}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          parties: { ...prev.parties, supplierLabel: e.target.value },
                        }))
                      }
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {[
                      { key: 'showAddress', label: 'Show Address' },
                      { key: 'showTaxId', label: 'Show Tax/VAT ID' },
                      { key: 'showEmail', label: 'Show Email' },
                      { key: 'showPhone', label: 'Show Phone' },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.parties[key as keyof typeof config.parties] as boolean}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              parties: { ...prev.parties, [key]: e.target.checked },
                            }))
                          }
                          className="rounded border-border text-brand focus:ring-brand size-3.5"
                        />
                        <span className="text-xs text-ink">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 4. Table Columns */}
            <div className="rounded-xl border border-border/30 bg-surface/85 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection('itemsTable')}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-ink bg-surface hover:bg-surface-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="size-4 text-ink-muted" />
                  <span>Table Columns & Styling</span>
                </div>
                {openSections.itemsTable ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>

              {openSections.itemsTable && (
                <div className="p-4 border-t border-border/20 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'showItemCode', label: 'Show Item Code' },
                      { key: 'showDescription', label: 'Show Description' },
                      { key: 'showQuantity', label: 'Show Quantity' },
                      { key: 'showUnitPrice', label: 'Show Unit Price' },
                      { key: 'showDiscount', label: 'Show Discount' },
                      { key: 'showTaxRate', label: 'Show Tax Rate' },
                      { key: 'showLineTotal', label: 'Show Line Total' },
                      { key: 'zebraStriping', label: 'Zebra Striping' },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.itemsTable[key as keyof typeof config.itemsTable] as boolean}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              itemsTable: { ...prev.itemsTable, [key]: e.target.checked },
                            }))
                          }
                          className="rounded border-border text-brand focus:ring-brand size-3.5"
                        />
                        <span className="text-xs text-ink">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 5. Totals */}
            <div className="rounded-xl border border-border/30 bg-surface/85 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection('totals')}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-ink bg-surface hover:bg-surface-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Calculator className="size-4 text-ink-muted" />
                  <span>Totals & Taxes</span>
                </div>
                {openSections.totals ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>

              {openSections.totals && (
                <div className="p-4 border-t border-border/20 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'showSubtotal', label: 'Show Subtotal' },
                      { key: 'showDiscountTotal', label: 'Show Discounts' },
                      { key: 'showTaxSummary', label: 'Show Tax Summary' },
                      { key: 'showAmountPaid', label: 'Show Amount Paid' },
                      { key: 'showBalanceDue', label: 'Show Balance Due' },
                      { key: 'highlightTotal', label: 'Highlight Final Total' },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.totals[key as keyof typeof config.totals] as boolean}
                          onChange={(e) =>
                            setConfig((prev) => ({
                              ...prev,
                              totals: { ...prev.totals, [key]: e.target.checked },
                            }))
                          }
                          className="rounded border-border text-brand focus:ring-brand size-3.5"
                        />
                        <span className="text-xs text-ink">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 6. Footer */}
            <div className="rounded-xl border border-border/30 bg-surface/85 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection('footer')}
                className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-ink bg-surface hover:bg-surface-muted/40 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileCheck className="size-4 text-ink-muted" />
                  <span>Footer, Terms & Bank Info</span>
                </div>
                {openSections.footer ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </button>

              {openSections.footer && (
                <div className="p-4 border-t border-border/20 space-y-3">
                  <Input
                    label="Payment Terms"
                    value={config.footer.paymentTerms || ''}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        footer: { ...prev.footer, paymentTerms: e.target.value },
                      }))
                    }
                    placeholder="Net 30 Days..."
                  />

                  <Textarea
                    label="Notes / Terms"
                    value={config.footer.notes || ''}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        footer: { ...prev.footer, notes: e.target.value },
                      }))
                    }
                    placeholder="Thank you for your business..."
                    className="min-h-[50px]"
                  />

                  <div className="pt-2 border-t border-border/20 space-y-2">
                    <p className="text-[11px] font-semibold text-ink">Bank & Wire Transfer</p>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        label="Bank Name"
                        value={config.footer.bankDetails?.bankName || ''}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            footer: {
                              ...prev.footer,
                              bankDetails: { ...prev.footer.bankDetails, bankName: e.target.value },
                            },
                          }))
                        }
                      />
                      <Input
                        label="Account Name"
                        value={config.footer.bankDetails?.accountName || ''}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            footer: {
                              ...prev.footer,
                              bankDetails: { ...prev.footer.bankDetails, accountName: e.target.value },
                            },
                          }))
                        }
                      />
                      <Input
                        label="Account #"
                        value={config.footer.bankDetails?.accountNumber || ''}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            footer: {
                              ...prev.footer,
                              bankDetails: { ...prev.footer.bankDetails, accountNumber: e.target.value },
                            },
                          }))
                        }
                      />
                      <Input
                        label="Routing / IBAN"
                        value={config.footer.bankDetails?.routingOrIban || ''}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            footer: {
                              ...prev.footer,
                              bankDetails: { ...prev.footer.bankDetails, routingOrIban: e.target.value },
                            },
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/20">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.footer.showSignatureBlock}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            footer: { ...prev.footer, showSignatureBlock: e.target.checked },
                          }))
                        }
                        className="rounded border-border text-brand focus:ring-brand size-3.5"
                      />
                      <span className="text-xs text-ink">Show Signature Block</span>
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.footer.showPageNumbers}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            footer: { ...prev.footer, showPageNumbers: e.target.checked },
                          }))
                        }
                        className="rounded border-border text-brand focus:ring-brand size-3.5"
                      />
                      <span className="text-xs text-ink">Show Page Numbers</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Live Interactive Preview Panel */}
        <div className="lg:col-span-7 flex flex-col min-h-0">
          <TemplatePreviewPanel
            config={config}
            onDownloadPdf={(docType) => previewPdf(config, docType)}
          />
        </div>
      </div>
    </div>
  );
}
