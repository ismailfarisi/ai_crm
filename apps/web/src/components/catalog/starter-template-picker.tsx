'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import type { StarterTemplatePreviewDto } from '@saas/shared';
import { useInstallStarterTemplate, useStarterTemplates } from '@/hooks/use-catalog-admin';
import { cn, formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Skeleton } from '@/components/ui/primitives';

/**
 * Pick an industry, pick a starter, see what it is made of and what it
 * charges for a typical job, install it. Lands in the template editor.
 */
export function StarterTemplatePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const starters = useStarterTemplates(open);
  const install = useInstallStarterTemplate();
  const [industry, setIndustry] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const list = useMemo(() => starters.data ?? [], [starters.data]);
  const industries = useMemo(() => {
    const seen = new Map<string, string>();
    for (const starter of list) seen.set(starter.industry, starter.industryLabel);
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [list]);

  const activeIndustry = industry ?? industries[0]?.id ?? null;
  const inIndustry = list.filter((starter) => starter.industry === activeIndustry);
  const selected =
    inIndustry.find((starter) => starter.key === selectedKey) ?? inIndustry[0] ?? null;

  const submit = async () => {
    if (!selected) return;
    let result;
    try {
      result = await install.mutateAsync(selected.key);
    } catch {
      return; // The hook has already said why.
    }
    onClose();
    router.push(`/catalog/templates/${result.id}?starter=1`);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Start from an industry template"
      description="A complete costing model with sample materials, machines and rates. You can change all of it after installing."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={install.isPending} disabled={!selected}>
            Install template
          </Button>
        </>
      }
    >
      {starters.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : starters.isError ? (
        <p className="text-sm text-danger">Couldn&apos;t load the template library. Please try again.</p>
      ) : (
        <div className="space-y-5">
          <div role="tablist" aria-label="Industry" className="flex flex-wrap gap-1.5">
            {industries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={entry.id === activeIndustry}
                onClick={() => {
                  setIndustry(entry.id);
                  setSelectedKey(null);
                }}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                  entry.id === activeIndustry
                    ? 'border-brand/40 bg-brand-soft/60 text-ink'
                    : 'border-border/60 text-ink-muted hover:text-ink',
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {inIndustry.length > 1 && (
            <div role="radiogroup" aria-label="Template" className="grid gap-2 sm:grid-cols-2">
              {inIndustry.map((starter) => (
                <button
                  key={starter.key}
                  type="button"
                  role="radio"
                  aria-checked={starter.key === selected?.key}
                  onClick={() => setSelectedKey(starter.key)}
                  className={cn(
                    'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-start text-sm transition-colors',
                    starter.key === selected?.key
                      ? 'border-brand/50 bg-brand-soft/30'
                      : 'border-border/60 hover:border-border',
                  )}
                >
                  <Check
                    className={cn(
                      'mt-0.5 size-4 shrink-0 text-brand',
                      starter.key === selected?.key ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="font-medium text-ink">{starter.name}</span>
                </button>
              ))}
            </div>
          )}

          {selected && <StarterPreview starter={selected} />}
        </div>
      )}
    </Dialog>
  );
}

function StarterPreview({ starter }: { starter: StarterTemplatePreviewDto }) {
  const { example } = starter;
  const money = (amount: number) =>
    formatMoney(amount, starter.currency, { decimals: amount < 1 ? 3 : 2 });

  return (
    <div className="space-y-4" data-testid="starter-preview">
      <div>
        <h3 className="text-base font-semibold text-ink">{starter.name}</h3>
        {starter.description && <p className="mt-1 text-sm text-ink-muted">{starter.description}</p>}
      </div>

      <div className="rounded-xl border border-border/60 bg-surface-muted/40 px-4 py-3">
        <p className="text-xs font-medium text-ink-subtle">
          Example: {example.quantity.toLocaleString('en-US')} at the default sizes
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-lg font-semibold text-ink tabular-nums">
            {money(example.unitPrice)} each
          </span>
          <span className="text-sm text-ink-muted tabular-nums">
            {money(example.grandTotal)} total · cost {money(example.unitCost)} each
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-subtle">Sample rates. Replace them with your own before quoting.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <PreviewList title="You set">
          {starter.parameters.map((parameter) => (
            <li key={parameter.key} className="flex justify-between gap-2">
              <span className="text-ink">{parameter.label}</span>
              <span className="text-ink-subtle tabular-nums">
                {formatValue(example.parameters[parameter.key])}
                {parameter.unit && typeof example.parameters[parameter.key] === 'number'
                  ? ` ${parameter.unit}`
                  : ''}
              </span>
            </li>
          ))}
        </PreviewList>
        <PreviewList title="Materials">
          {starter.materials.map((material) => (
            <li key={material.label} className="flex flex-wrap items-center gap-1.5">
              <span className="text-ink">{material.label}</span>
              {material.optional && <Badge>option</Badge>}
            </li>
          ))}
          {starter.tooling.map((tool) => (
            <li key={tool.label} className="flex flex-wrap items-center gap-1.5">
              <span className="text-ink">{tool.label}</span>
              <Badge tone="info">tooling</Badge>
            </li>
          ))}
        </PreviewList>
        <PreviewList title="Steps">
          {starter.operations.map((operation, index) => (
            <li key={`${operation.label}-${index}`}>
              <span className="text-ink">{operation.label}</span>
              <span className="block text-xs text-ink-subtle">
                {operation.workCenterName}
                {operation.optional ? ' · option' : ''}
              </span>
            </li>
          ))}
        </PreviewList>
      </div>
    </div>
  );
}

function PreviewList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-ink-subtle uppercase">{title}</h4>
      <ul className="space-y-1.5 text-sm">{children}</ul>
    </section>
  );
}

function formatValue(value: unknown): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return value === undefined || value === null ? '—' : String(value);
}
