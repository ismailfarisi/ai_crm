'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import type {
  CreateProductTemplatePayload,
  DerivedVariable,
  ProductTemplateDto,
  TemplateMaterial,
  TemplateOperation,
  TemplateParameter,
  TemplatePricing,
  TemplateTooling,
} from '@saas/shared';
import { createProductTemplateSchema } from '@saas/shared';
import {
  useMaterials,
  useSaveTemplate,
  useTemplate,
  useTooling,
  useWorkCenters,
} from '@/hooks/use-catalog-admin';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Card, CardBody, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';

/**
 * The parametric cost model, as a screen.
 *
 * This is the feature the product is sold on — a price that falls out of
 * length, width, height, material yield and machine time — and the API has
 * always had it. Nothing in the front end ever wrote to it, so a template
 * could only be created by POSTing JSON by hand, and everything downstream
 * (price breaks, production planning, BOM-driven stock) stayed shut with it.
 *
 * Formulas are plain text, checked by the server's expression parser on save.
 * Deliberately not validated keystroke by keystroke here: the parser is the
 * only thing that knows what is in scope, and a second, weaker copy of that
 * knowledge in the browser would eventually disagree with it.
 */
export function TemplateEditor({ templateId }: { templateId: string | null }) {
  const router = useRouter();
  const { data: existing, isPending: loading } = useTemplate(templateId);
  const { data: materials = [] } = useMaterials();
  const { data: workCenters = [] } = useWorkCenters();
  const { data: tooling = [] } = useTooling();
  const save = useSaveTemplate();

  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (existing && !loaded) {
      setForm(fromDto(existing));
      setLoaded(true);
    }
  }, [existing, loaded]);

  const materialOptions = useMemo(
    () => materials.map((m) => ({ value: m.id, label: `${m.name} (${m.sku})` })),
    [materials],
  );
  const workCenterOptions = useMemo(
    () => workCenters.map((w) => ({ value: w.id, label: w.name })),
    [workCenters],
  );
  const toolingOptions = useMemo(
    () => tooling.map((t) => ({ value: t.id, label: t.name })),
    [tooling],
  );

  const patch = (changes: Partial<TemplateForm>) =>
    setForm((current) => ({ ...current, ...changes }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors([]);

    const parsed = createProductTemplateSchema.safeParse(toPayload(form));
    if (!parsed.success) {
      // The server would refuse the same things; saying so here saves a trip
      // and keeps the reason attached to the field it came from.
      setErrors(
        parsed.error.issues.map(
          (issue) => `${issue.path.join(' → ') || 'Template'}: ${issue.message}`,
        ),
      );
      return;
    }

    const saved = await save.mutateAsync({
      id: templateId ?? undefined,
      payload: parsed.data,
    });
    router.push(`/catalog/templates/${saved.id}`);
  };

  if (templateId && loading) {
    return (
      <Card className="p-6">
        <Skeleton className="h-8 w-64" />
      </Card>
    );
  }

  const blocked =
    materials.length === 0 || workCenters.length === 0
      ? 'A template is built out of materials and work centres. Add at least one of each on the Catalog screen first.'
      : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Link
        href="/catalog"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-subtle hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Back to Catalog
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">
            {templateId ? form.name || 'Product template' : 'New product template'}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {templateId
              ? `Version ${existing?.version ?? 1}. Saving publishes the next version and leaves quotes priced from this one untouched.`
              : 'A price that falls out of the parameters, the material it uses and the machines it runs on.'}
          </p>
        </div>
        <Button type="submit" loading={save.isPending} disabled={blocked !== null}>
          {templateId ? 'Publish new version' : 'Create template'}
        </Button>
      </div>

      {blocked && (
        <p className="rounded-xl border border-warning/40 bg-warning-soft/40 px-4 py-3 text-sm text-ink">
          {blocked}
        </p>
      )}

      {errors.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-danger/30 bg-danger-soft/40 px-4 py-3 text-xs text-danger">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      <Section title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Name"
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
          <Input
            label="Template key"
            hint="Lowercase letters, digits and hyphens. Fixed once created."
            disabled={templateId !== null}
            value={form.templateKey}
            onChange={(event) => patch({ templateKey: event.target.value })}
          />
        </div>
        <Textarea
          label="Description"
          rows={2}
          value={form.description}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </Section>

      <Section
        title="Parameters"
        hint="What the salesperson is asked for on the quote — length, width, a finish."
        onAdd={() => patch({ parameters: [...form.parameters, blankParameter(form.parameters.length)] })}
      >
        {form.parameters.map((parameter, index) => (
          <Row
            key={index}
            onRemove={() =>
              patch({ parameters: form.parameters.filter((_, i) => i !== index) })
            }
          >
            <Input
              label="Key"
              value={parameter.key}
              onChange={(event) =>
                patch({ parameters: replace(form.parameters, index, { key: event.target.value }) })
              }
            />
            <Input
              label="Label"
              value={parameter.label}
              onChange={(event) =>
                patch({ parameters: replace(form.parameters, index, { label: event.target.value }) })
              }
            />
            <Select
              label="Type"
              value={parameter.type}
              options={[
                { value: 'NUMBER', label: 'Number' },
                { value: 'ENUM', label: 'Choice' },
                { value: 'BOOLEAN', label: 'Yes / no' },
              ]}
              onChange={(event) =>
                patch({
                  parameters: replace(form.parameters, index, {
                    type: event.target.value as TemplateParameter['type'],
                  }),
                })
              }
            />
            <Input
              label="Unit"
              value={parameter.unit}
              onChange={(event) =>
                patch({ parameters: replace(form.parameters, index, { unit: event.target.value }) })
              }
            />
            <Input
              label="Default"
              value={parameter.defaultValue}
              onChange={(event) =>
                patch({
                  parameters: replace(form.parameters, index, {
                    defaultValue: event.target.value,
                  }),
                })
              }
            />
            {parameter.type === 'ENUM' && (
              <Input
                label="Choices"
                hint="Comma separated."
                containerClassName="sm:col-span-2"
                value={parameter.options}
                onChange={(event) =>
                  patch({
                    parameters: replace(form.parameters, index, { options: event.target.value }),
                  })
                }
              />
            )}
          </Row>
        ))}
      </Section>

      <Section
        title="Derived values"
        hint="Named intermediates, evaluated in order. Keeps the formulas below readable."
        onAdd={() => patch({ derived: [...form.derived, { key: '', label: '', formula: '', unit: '' }] })}
      >
        {form.derived.map((variable, index) => (
          <Row
            key={index}
            onRemove={() => patch({ derived: form.derived.filter((_, i) => i !== index) })}
          >
            <Input
              label="Key"
              value={variable.key}
              onChange={(event) =>
                patch({ derived: replace(form.derived, index, { key: event.target.value }) })
              }
            />
            <Input
              label="Formula"
              containerClassName="sm:col-span-3"
              className="font-mono text-xs"
              value={variable.formula}
              onChange={(event) =>
                patch({ derived: replace(form.derived, index, { formula: event.target.value }) })
              }
            />
            <Input
              label="Unit"
              value={variable.unit}
              onChange={(event) =>
                patch({ derived: replace(form.derived, index, { unit: event.target.value }) })
              }
            />
          </Row>
        ))}
      </Section>

      <Section
        title="Materials"
        hint="What the job consumes. SHEET_NEST lays a blank onto a purchased sheet; the other modes take a formula."
        onAdd={() => patch({ materials: [...form.materials, blankMaterial(materialOptions[0]?.value)] })}
      >
        {form.materials.map((material, index) => (
          <Row
            key={index}
            onRemove={() => patch({ materials: form.materials.filter((_, i) => i !== index) })}
          >
            <Input
              label="Key"
              value={material.key}
              onChange={(event) =>
                patch({ materials: replace(form.materials, index, { key: event.target.value }) })
              }
            />
            <Input
              label="Label"
              value={material.label}
              onChange={(event) =>
                patch({ materials: replace(form.materials, index, { label: event.target.value }) })
              }
            />
            <Select
              label="Material"
              value={material.materialId}
              options={materialOptions}
              placeholder="Pick a material"
              onChange={(event) =>
                patch({
                  materials: replace(form.materials, index, { materialId: event.target.value }),
                })
              }
            />
            <Select
              label="Consumption"
              value={material.mode}
              options={[
                { value: 'SHEET_NEST', label: 'Nest onto a sheet' },
                { value: 'PER_UNIT', label: 'Per finished piece' },
                { value: 'FIXED', label: 'Fixed for the order' },
              ]}
              onChange={(event) =>
                patch({
                  materials: replace(form.materials, index, {
                    mode: event.target.value as TemplateMaterial['mode'],
                  }),
                })
              }
            />
            {material.mode === 'SHEET_NEST' ? (
              <>
                <Input
                  label="Blank width"
                  className="font-mono text-xs"
                  value={material.blankWidthFormula}
                  onChange={(event) =>
                    patch({
                      materials: replace(form.materials, index, {
                        blankWidthFormula: event.target.value,
                      }),
                    })
                  }
                />
                <Input
                  label="Blank height"
                  className="font-mono text-xs"
                  value={material.blankHeightFormula}
                  onChange={(event) =>
                    patch({
                      materials: replace(form.materials, index, {
                        blankHeightFormula: event.target.value,
                      }),
                    })
                  }
                />
                <Input
                  label="Margin (mm)"
                  value={material.marginMm}
                  onChange={(event) =>
                    patch({
                      materials: replace(form.materials, index, { marginMm: event.target.value }),
                    })
                  }
                />
                <Input
                  label="Gutter (mm)"
                  value={material.gutterMm}
                  onChange={(event) =>
                    patch({
                      materials: replace(form.materials, index, { gutterMm: event.target.value }),
                    })
                  }
                />
              </>
            ) : (
              <Input
                label="Quantity formula"
                containerClassName="sm:col-span-2"
                className="font-mono text-xs"
                value={material.quantityFormula}
                onChange={(event) =>
                  patch({
                    materials: replace(form.materials, index, {
                      quantityFormula: event.target.value,
                    }),
                  })
                }
              />
            )}
            <Input
              label="Waste %"
              hint="Overrides the material's own allowance."
              className="font-mono text-xs"
              value={material.wastePctFormula}
              onChange={(event) =>
                patch({
                  materials: replace(form.materials, index, {
                    wastePctFormula: event.target.value,
                  }),
                })
              }
            />
            <Input
              label="Only when"
              className="font-mono text-xs"
              value={material.condition}
              onChange={(event) =>
                patch({
                  materials: replace(form.materials, index, { condition: event.target.value }),
                })
              }
            />
          </Row>
        ))}
      </Section>

      <Section
        title="Routing"
        hint="The operations the job runs through. Operations sharing a branch run side by side."
        onAdd={() =>
          patch({
            operations: [
              ...form.operations,
              blankOperation(workCenterOptions[0]?.value, form.operations.length),
            ],
          })
        }
      >
        {form.operations.map((operation, index) => (
          <Row
            key={index}
            onRemove={() => patch({ operations: form.operations.filter((_, i) => i !== index) })}
          >
            <Input
              label="Key"
              value={operation.key}
              onChange={(event) =>
                patch({ operations: replace(form.operations, index, { key: event.target.value }) })
              }
            />
            <Input
              label="Label"
              value={operation.label}
              onChange={(event) =>
                patch({ operations: replace(form.operations, index, { label: event.target.value }) })
              }
            />
            <Select
              label="Work centre"
              value={operation.workCenterId}
              options={workCenterOptions}
              placeholder="Pick a work centre"
              onChange={(event) =>
                patch({
                  operations: replace(form.operations, index, {
                    workCenterId: event.target.value,
                  }),
                })
              }
            />
            <Input
              label="Sequence"
              type="number"
              value={operation.sequence}
              onChange={(event) =>
                patch({
                  operations: replace(form.operations, index, { sequence: event.target.value }),
                })
              }
            />
            <Input
              label="Run minutes"
              containerClassName="sm:col-span-2"
              className="font-mono text-xs"
              value={operation.runMinutesFormula}
              onChange={(event) =>
                patch({
                  operations: replace(form.operations, index, {
                    runMinutesFormula: event.target.value,
                  }),
                })
              }
            />
            <Input
              label="Setup minutes"
              hint="Blank uses the work centre's own."
              className="font-mono text-xs"
              value={operation.setupMinutesFormula}
              onChange={(event) =>
                patch({
                  operations: replace(form.operations, index, {
                    setupMinutesFormula: event.target.value,
                  }),
                })
              }
            />
            <Input
              label="Branch"
              value={operation.branch}
              onChange={(event) =>
                patch({
                  operations: replace(form.operations, index, { branch: event.target.value }),
                })
              }
            />
            <Input
              label="Only when"
              className="font-mono text-xs"
              value={operation.condition}
              onChange={(event) =>
                patch({
                  operations: replace(form.operations, index, { condition: event.target.value }),
                })
              }
            />
          </Row>
        ))}
      </Section>

      <Section
        title="Tooling"
        hint="Dies and plates. A reusable one the customer already paid for is not charged again."
        onAdd={() => patch({ tooling: [...form.tooling, blankTooling(toolingOptions[0]?.value)] })}
      >
        {form.tooling.map((item, index) => (
          <Row
            key={index}
            onRemove={() => patch({ tooling: form.tooling.filter((_, i) => i !== index) })}
          >
            <Input
              label="Key"
              value={item.key}
              onChange={(event) =>
                patch({ tooling: replace(form.tooling, index, { key: event.target.value }) })
              }
            />
            <Input
              label="Label"
              value={item.label}
              onChange={(event) =>
                patch({ tooling: replace(form.tooling, index, { label: event.target.value }) })
              }
            />
            <Select
              label="Tooling"
              value={item.toolingId}
              options={toolingOptions}
              placeholder="Pick tooling"
              onChange={(event) =>
                patch({ tooling: replace(form.tooling, index, { toolingId: event.target.value }) })
              }
            />
            <Input
              label="Only when"
              className="font-mono text-xs"
              value={item.condition}
              onChange={(event) =>
                patch({ tooling: replace(form.tooling, index, { condition: event.target.value }) })
              }
            />
          </Row>
        ))}
      </Section>

      <Section title="Pricing">
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Method"
            hint="30% markup is 23% margin — they are not the same number."
            value={form.pricing.method}
            options={[
              { value: 'MARGIN', label: 'Target margin' },
              { value: 'MARKUP', label: 'Markup on cost' },
            ]}
            onChange={(event) =>
              patch({
                pricing: {
                  ...form.pricing,
                  method: event.target.value as TemplatePricing['method'],
                },
              })
            }
          />
          <Input
            label="Rate"
            hint="As a fraction: 0.35 is 35%."
            value={form.pricing.rate}
            onChange={(event) =>
              patch({ pricing: { ...form.pricing, rate: event.target.value } })
            }
          />
          <Input
            label="Overhead"
            hint="Burden on direct cost, as a fraction."
            value={form.pricing.overheadPct}
            onChange={(event) =>
              patch({ pricing: { ...form.pricing, overheadPct: event.target.value } })
            }
          />
          <Input
            label="Minimum charge"
            value={form.pricing.minCharge}
            onChange={(event) =>
              patch({ pricing: { ...form.pricing, minCharge: event.target.value } })
            }
          />
          <Input
            label="Round unit price to"
            hint="e.g. 0.05"
            value={form.pricing.roundUnitPriceTo}
            onChange={(event) =>
              patch({ pricing: { ...form.pricing, roundUnitPriceTo: event.target.value } })
            }
          />
        </div>
      </Section>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

function Section({
  title,
  hint,
  onAdd,
  children,
}: {
  title: string;
  hint?: string;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3.5">
        <div>
          <CardTitle className="text-sm font-semibold text-ink">{title}</CardTitle>
          {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
        </div>
        {onAdd && (
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <Plus className="size-3.5" />
            Add
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-4 px-5 py-4">{children}</CardBody>
    </Card>
  );
}

function Row({ onRemove, children }: { onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="relative rounded-xl border border-border/40 bg-surface-muted/20 p-4">
      <div className="grid gap-3 sm:grid-cols-4">{children}</div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="absolute right-2 top-2 rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-danger"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Form state
 *
 * Every field is a string while it is being typed, including the numbers: a
 * half-typed "0." is not a number, and coercing on every keystroke would eat
 * the decimal point. `toPayload` converts once, on save, and the shared schema
 * is what decides whether the result is acceptable.
 * ------------------------------------------------------------------ */

interface ParameterForm {
  key: string;
  label: string;
  type: TemplateParameter['type'];
  unit: string;
  defaultValue: string;
  options: string;
}

interface DerivedForm {
  key: string;
  label: string;
  formula: string;
  unit: string;
}

interface MaterialForm {
  key: string;
  label: string;
  materialId: string;
  mode: TemplateMaterial['mode'];
  blankWidthFormula: string;
  blankHeightFormula: string;
  marginMm: string;
  gutterMm: string;
  quantityFormula: string;
  wastePctFormula: string;
  condition: string;
}

interface OperationForm {
  key: string;
  label: string;
  workCenterId: string;
  sequence: string;
  setupMinutesFormula: string;
  runMinutesFormula: string;
  condition: string;
  branch: string;
}

interface ToolingForm {
  key: string;
  label: string;
  toolingId: string;
  condition: string;
}

interface PricingForm {
  method: TemplatePricing['method'];
  rate: string;
  overheadPct: string;
  minCharge: string;
  roundUnitPriceTo: string;
}

interface TemplateForm {
  templateKey: string;
  name: string;
  description: string;
  currency: string;
  parameters: ParameterForm[];
  derived: DerivedForm[];
  materials: MaterialForm[];
  operations: OperationForm[];
  tooling: ToolingForm[];
  pricing: PricingForm;
}

const EMPTY_FORM: TemplateForm = {
  templateKey: '',
  name: '',
  description: '',
  currency: 'USD',
  parameters: [],
  derived: [],
  materials: [],
  operations: [],
  tooling: [],
  pricing: { method: 'MARGIN', rate: '0.35', overheadPct: '0', minCharge: '', roundUnitPriceTo: '' },
};

const blankParameter = (index: number): ParameterForm => ({
  key: `param_${index + 1}`,
  label: '',
  type: 'NUMBER',
  unit: '',
  defaultValue: '',
  options: '',
});

const blankMaterial = (materialId = ''): MaterialForm => ({
  key: '',
  label: '',
  materialId,
  mode: 'PER_UNIT',
  blankWidthFormula: '',
  blankHeightFormula: '',
  marginMm: '',
  gutterMm: '',
  quantityFormula: '',
  wastePctFormula: '',
  condition: '',
});

const blankOperation = (workCenterId = '', index = 0): OperationForm => ({
  key: '',
  label: '',
  workCenterId,
  sequence: String((index + 1) * 10),
  setupMinutesFormula: '',
  runMinutesFormula: '',
  condition: '',
  branch: '',
});

const blankTooling = (toolingId = ''): ToolingForm => ({
  key: '',
  label: '',
  toolingId,
  condition: '',
});

/** Replaces one row of a list, leaving the rest identical. */
function replace<T>(rows: T[], index: number, changes: Partial<T>): T[] {
  return rows.map((row, i) => (i === index ? { ...row, ...changes } : row));
}

const text = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const num = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** The typed default a parameter of this type should carry. */
function defaultValueFor(parameter: ParameterForm): string | number | boolean | undefined {
  const raw = parameter.defaultValue.trim();
  if (raw === '') return undefined;
  if (parameter.type === 'NUMBER') return num(raw);
  if (parameter.type === 'BOOLEAN') return raw.toLowerCase() === 'true';
  return raw;
}

function toPayload(form: TemplateForm): unknown {
  return {
    templateKey: form.templateKey.trim(),
    name: form.name.trim(),
    description: text(form.description) ?? null,
    currency: form.currency.trim() || 'USD',
    parameters: form.parameters.map((parameter) => ({
      key: parameter.key.trim(),
      label: parameter.label.trim(),
      type: parameter.type,
      unit: text(parameter.unit) ?? null,
      defaultValue: defaultValueFor(parameter),
      options:
        parameter.type === 'ENUM'
          ? parameter.options
              .split(',')
              .map((option) => option.trim())
              .filter(Boolean)
          : undefined,
    })),
    derived: form.derived.map((variable) => ({
      key: variable.key.trim(),
      label: text(variable.label) ?? null,
      formula: variable.formula.trim(),
      unit: text(variable.unit) ?? null,
    })),
    materials: form.materials.map((material) => ({
      key: material.key.trim(),
      label: material.label.trim(),
      materialId: material.materialId,
      mode: material.mode,
      blankWidthFormula: text(material.blankWidthFormula) ?? null,
      blankHeightFormula: text(material.blankHeightFormula) ?? null,
      marginMm: num(material.marginMm),
      gutterMm: num(material.gutterMm),
      quantityFormula: text(material.quantityFormula) ?? null,
      wastePctFormula: text(material.wastePctFormula) ?? null,
      condition: text(material.condition) ?? null,
    })),
    operations: form.operations.map((operation) => ({
      key: operation.key.trim(),
      label: operation.label.trim(),
      workCenterId: operation.workCenterId,
      sequence: num(operation.sequence) ?? 0,
      setupMinutesFormula: text(operation.setupMinutesFormula) ?? null,
      runMinutesFormula: operation.runMinutesFormula.trim(),
      condition: text(operation.condition) ?? null,
      branch: text(operation.branch) ?? null,
    })),
    tooling: form.tooling.map((item) => ({
      key: item.key.trim(),
      label: item.label.trim(),
      toolingId: item.toolingId,
      condition: text(item.condition) ?? null,
    })),
    pricing: {
      method: form.pricing.method,
      rate: num(form.pricing.rate) ?? 0,
      overheadPct: num(form.pricing.overheadPct) ?? 0,
      minCharge: num(form.pricing.minCharge),
      roundUnitPriceTo: num(form.pricing.roundUnitPriceTo),
    },
  };
}

function fromDto(template: ProductTemplateDto): TemplateForm {
  const str = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value);

  return {
    templateKey: template.templateKey,
    name: template.name,
    description: template.description ?? '',
    currency: template.currency,
    parameters: template.parameters.map((parameter: TemplateParameter) => ({
      key: parameter.key,
      label: parameter.label,
      type: parameter.type,
      unit: str(parameter.unit),
      defaultValue: str(parameter.defaultValue),
      options: (parameter.options ?? []).join(', '),
    })),
    derived: (template.derived ?? []).map((variable: DerivedVariable) => ({
      key: variable.key,
      label: str(variable.label),
      formula: variable.formula,
      unit: str(variable.unit),
    })),
    materials: template.materials.map((material: TemplateMaterial) => ({
      key: material.key,
      label: material.label,
      materialId: material.materialId,
      mode: material.mode,
      blankWidthFormula: str(material.blankWidthFormula),
      blankHeightFormula: str(material.blankHeightFormula),
      marginMm: str(material.marginMm),
      gutterMm: str(material.gutterMm),
      quantityFormula: str(material.quantityFormula),
      wastePctFormula: str(material.wastePctFormula),
      condition: str(material.condition),
    })),
    operations: template.operations.map((operation: TemplateOperation) => ({
      key: operation.key,
      label: operation.label,
      workCenterId: operation.workCenterId,
      sequence: str(operation.sequence),
      setupMinutesFormula: str(operation.setupMinutesFormula),
      runMinutesFormula: operation.runMinutesFormula,
      condition: str(operation.condition),
      branch: str(operation.branch),
    })),
    tooling: (template.tooling ?? []).map((item: TemplateTooling) => ({
      key: item.key,
      label: item.label,
      toolingId: item.toolingId,
      condition: str(item.condition),
    })),
    pricing: {
      method: template.pricing.method,
      rate: str(template.pricing.rate),
      overheadPct: str(template.pricing.overheadPct),
      minCharge: str(template.pricing.minCharge),
      roundUnitPriceTo: str(template.pricing.roundUnitPriceTo),
    },
  };
}
