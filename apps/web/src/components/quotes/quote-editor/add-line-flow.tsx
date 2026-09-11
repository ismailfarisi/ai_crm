'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import type { ProductTemplateDto, QuoteLineItem } from '@saas/shared';
import { api } from '@/lib/api/endpoints';
import { useLineResolver } from '@/hooks/use-catalog';
import { CatalogPicker, type PickerChoice } from './catalog-picker';
import { TemplateConfigurator } from './template-configurator';

interface AddLineFlowProps {
  open: boolean;
  onClose: () => void;
  onAddLines: (lines: QuoteLineItem[]) => void;
  currency?: string;
}

/**
 * Picker → configurator → resolved line.
 *
 * A flat catalog item is added straight away; a template goes through the
 * configurator first. Either way the finished line comes back from
 * `/catalog/resolve-lines`, so the browser never invents a price or a cost.
 */
export function AddLineFlow({ open, onClose, onAddLines, currency }: AddLineFlowProps) {
  const [template, setTemplate] = useState<ProductTemplateDto | null>(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const { resolve, isResolving } = useLineResolver();

  const close = useCallback(() => {
    setTemplate(null);
    onClose();
  }, [onClose]);

  const handleChoose = useCallback(
    async (choice: PickerChoice) => {
      if (choice.kind === 'TEMPLATE') {
        // The list response omits the cost model for actors without
        // `quote:view_cost`; refetching the single template keeps the
        // configurator working off whatever that actor is allowed to see.
        setIsLoadingTemplate(true);
        try {
          setTemplate(await api.catalog.getTemplate(choice.template.id));
        } catch {
          setTemplate(choice.template);
        } finally {
          setIsLoadingTemplate(false);
        }
        return;
      }

      const resolved = await resolve({
        lines: [
          {
            kind: 'CATALOG_ITEM',
            catalogItemId: choice.item.id,
            quantity: 1,
            discount: 0,
          },
        ],
      });

      if (resolved) {
        onAddLines(resolved.lines);
        toast.success(`Added ${choice.item.name}`);
        close();
      }
    },
    [resolve, onAddLines, close],
  );

  const handleAddConfigured = useCallback(
    async (input: { quantity: number; parameters: Record<string, string | number | boolean> }) => {
      if (!template) return;

      const resolved = await resolve({
        lines: [
          {
            kind: 'TEMPLATE',
            templateId: template.id,
            quantity: input.quantity,
            parameters: input.parameters,
            toolingAlreadyOwned: [],
            discount: 0,
          },
        ],
      });

      if (resolved) {
        onAddLines(resolved.lines);
        for (const warning of resolved.warnings) toast.warning(warning);
        toast.success(`Added ${input.quantity.toLocaleString()} × ${template.name}`);
        close();
      }
    },
    [template, resolve, onAddLines, close],
  );

  if (!open) return null;

  if (template) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[8vh] backdrop-blur-sm"
        role="presentation"
        onClick={close}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Configure ${template.name}`}
          className="w-full max-w-3xl overflow-hidden rounded-2xl border border-border/40 bg-surface shadow-2xl"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          <TemplateConfigurator
            template={template}
            currency={currency}
            onBack={() => setTemplate(null)}
            onAdd={handleAddConfigured}
            isAdding={isResolving}
          />
        </div>
      </div>
    );
  }

  return (
    <CatalogPicker
      open={open && !isLoadingTemplate}
      onClose={close}
      onChoose={handleChoose}
      currency={currency}
    />
  );
}
