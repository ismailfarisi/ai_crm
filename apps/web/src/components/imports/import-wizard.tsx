'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, FileUp, RotateCcw } from 'lucide-react';
import {
  IMPORT_DEFINITIONS,
  IMPORT_ENTITIES,
  IMPORT_LIMITS,
  type ImportDuplicateMode,
  type ImportEntity,
  type ImportMapping,
  type ImportPreviewDto,
  type ImportPreviewRow,
  type ImportRunDto,
} from '@saas/shared';
import { useCommitImport, useImportPreview, useImportRuns } from '@/hooks/use-imports';
import { api, type ImportFileFormat } from '@/lib/api/endpoints';
import { useSession } from '@/lib/session-context';
import { cn, formatRelative } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Alert, Badge, Card, CardBody, PageHeader } from '@/components/ui/primitives';

type Step = 'upload' | 'map' | 'review' | 'import' | 'result';

const STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'map', label: 'Match columns' },
  { id: 'review', label: 'Review' },
  { id: 'import', label: 'Import' },
  { id: 'result', label: 'Done' },
];

/** Where to see what was imported. */
const LIST_HREF: Record<ImportEntity, string> = {
  customers: '/customers',
  contacts: '/contacts',
  products: '/catalog',
  materials: '/catalog',
  'work-centres': '/catalog',
  'opening-stock': '/inventory',
};

/** Reviewing thousands of rows in the browser helps nobody; the counts cover the rest. */
const REVIEW_ROWS_SHOWN = 200;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

async function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function ImportWizard({ initialEntity }: { initialEntity?: ImportEntity }) {
  const { check } = useSession();
  const allowed = useMemo(
    () => IMPORT_ENTITIES.filter((e) => check({ permission: IMPORT_DEFINITIONS[e].createPermission })),
    [check],
  );

  const [entity, setEntity] = useState<ImportEntity>(
    initialEntity && allowed.includes(initialEntity) ? initialEntity : (allowed[0] ?? 'customers'),
  );
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [onDuplicate, setOnDuplicate] = useState<ImportDuplicateMode>('skip');
  const [run, setRun] = useState<ImportRunDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewMutation = useImportPreview();
  const commitMutation = useCommitImport();
  const definition = IMPORT_DEFINITIONS[entity];
  const canUpdate = definition.canUpdate && check({ permission: definition.updatePermission });

  const reset = () => {
    setStep('upload');
    setFile(null);
    setPreview(null);
    setMapping({});
    setOnDuplicate('skip');
    setRun(null);
    setError(null);
  };

  const readFile = async (chosen: File) => {
    setError(null);
    if (chosen.size > IMPORT_LIMITS.maxBytes) {
      setError(`This file is over ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB. Split it into smaller files.`);
      return;
    }
    try {
      const result = await previewMutation.mutateAsync({ entity, file: chosen });
      setFile(chosen);
      setPreview(result);
      setMapping(result.mapping);
      setStep('map');
    } catch (e) {
      setError(errorText(e));
    }
  };

  const checkRows = async () => {
    if (!file) return;
    setError(null);
    try {
      const result = await previewMutation.mutateAsync({ entity, file, mapping });
      setPreview(result);
      setStep('review');
    } catch (e) {
      setError(errorText(e));
    }
  };

  const runImport = async () => {
    if (!file) return;
    setError(null);
    setStep('import');
    try {
      const result = await commitMutation.mutateAsync({
        entity,
        file,
        mapping,
        onDuplicate: canUpdate ? onDuplicate : 'skip',
      });
      setRun(result);
      setStep('result');
    } catch (e) {
      setError(errorText(e));
      setStep('review');
    }
  };

  return (
    <>
      <PageHeader
        title="Import data"
        description="Bring in customers, contacts and your catalog from Excel or a CSV file."
      />

      <ol className="mt-6 mb-6 flex flex-wrap gap-x-4 gap-y-2" aria-label="Import steps">
        {STEPS.map((item, i) => {
          const index = STEPS.findIndex((s) => s.id === step);
          const state = i < index ? 'done' : i === index ? 'current' : 'todo';
          return (
            <li
              key={item.id}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 text-sm',
                state === 'current' ? 'font-semibold text-ink' : state === 'done' ? 'text-ink' : 'text-ink-subtle',
              )}
            >
              <span
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded-full border text-xs tabular-nums',
                  state === 'current' && 'border-brand bg-brand text-on-brand',
                  state === 'done' && 'border-success/30 bg-success-soft text-success',
                  state === 'todo' && 'border-border',
                )}
              >
                {state === 'done' ? <CheckCircle2 className="size-3.5" /> : i + 1}
              </span>
              {item.label}
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}

      {step === 'upload' && (
        <UploadStep
          allowed={allowed}
          entity={entity}
          onEntity={(e) => {
            setEntity(e);
            setError(null);
          }}
          onFile={readFile}
          reading={previewMutation.isPending}
        />
      )}

      {step === 'map' && preview && (
        <MapStep
          entity={entity}
          preview={preview}
          mapping={mapping}
          onChange={setMapping}
          onBack={reset}
          onNext={checkRows}
          checking={previewMutation.isPending}
        />
      )}

      {(step === 'review' || step === 'import') && preview && (
        <ReviewStep
          entity={entity}
          preview={preview}
          canUpdate={canUpdate}
          onDuplicate={onDuplicate}
          onDuplicateChange={setOnDuplicate}
          onBack={() => setStep('map')}
          onImport={runImport}
          importing={step === 'import'}
        />
      )}

      {step === 'result' && run && <ResultStep run={run} onAgain={reset} />}
    </>
  );
}

function TemplateButtons({ entity }: { entity: ImportEntity }) {
  const [busy, setBusy] = useState<ImportFileFormat | null>(null);
  const download = async (format: ImportFileFormat) => {
    setBusy(format);
    try {
      await saveBlob(await api.imports.template(entity, format), `kerf-${entity}-template.${format}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" loading={busy === 'xlsx'} onClick={() => download('xlsx')}>
        <Download className="size-3.5" />
        Excel template
      </Button>
      <Button variant="outline" size="sm" loading={busy === 'csv'} onClick={() => download('csv')}>
        <Download className="size-3.5" />
        CSV template
      </Button>
    </div>
  );
}

function UploadStep({
  allowed,
  entity,
  onEntity,
  onFile,
  reading,
}: {
  allowed: readonly ImportEntity[];
  entity: ImportEntity;
  onEntity: (entity: ImportEntity) => void;
  onFile: (file: File) => void;
  reading: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const definition = IMPORT_DEFINITIONS[entity];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Card>
        <CardBody className="space-y-6">
          <fieldset>
            <legend className="text-sm font-semibold text-ink">What are you importing?</legend>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {allowed.map((e) => {
                const d = IMPORT_DEFINITIONS[e];
                return (
                  <label
                    key={e}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors',
                      e === entity ? 'border-brand bg-brand/5' : 'border-border hover:border-ink-subtle',
                    )}
                  >
                    <input
                      type="radio"
                      name="entity"
                      value={e}
                      checked={e === entity}
                      onChange={() => onEntity(e)}
                      className="mt-0.5 accent-brand"
                    />
                    <span>
                      <span className="block font-medium text-ink">{d.label}</span>
                      <span className="block text-xs text-ink-muted">Matched by {d.matchedBy}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) onFile(dropped);
            }}
            className={cn(
              'flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragging ? 'border-brand bg-brand/5' : 'border-border',
            )}
          >
            <FileSpreadsheet className="size-8 text-ink-subtle" />
            <p className="mt-3 text-sm font-semibold text-ink">Drop your {definition.nounPlural} file here</p>
            <p className="mt-1 text-xs text-ink-muted">
              .xlsx or .csv, up to {IMPORT_LIMITS.maxBytes / 1024 / 1024} MB and{' '}
              {IMPORT_LIMITS.maxRows.toLocaleString()} rows. The first sheet is read.
            </p>
            <input
              ref={input}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label="Spreadsheet file"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                e.target.value = '';
                if (chosen) onFile(chosen);
              }}
            />
            <Button className="mt-4" loading={reading} onClick={() => input.current?.click()}>
              <FileUp className="size-4" />
              Choose file
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardBody className="space-y-3">
            <p className="text-sm font-semibold text-ink">Start from a template</p>
            <p className="text-sm text-ink-muted">
              It has a column for each {definition.noun} field and one example row. Your own headers work too.
            </p>
            <TemplateButtons entity={entity} />
            {entity === 'opening-stock' && (
              <p className="text-xs text-ink-muted">
                Each row is booked as a stock adjustment at its unit cost, and posted to the books. A material
                that already has stock is skipped.
              </p>
            )}
          </CardBody>
        </Card>
        <RecentImports />
      </div>
    </div>
  );
}

function RecentImports() {
  const { data } = useImportRuns();
  if (!data?.length) return null;
  return (
    <Card>
      <CardBody>
        <p className="text-sm font-semibold text-ink">Recent imports</p>
        <ul className="mt-3 divide-y divide-border">
          {data.slice(0, 5).map((run) => (
            <li key={run.id} className="py-2 text-sm">
              <p className="truncate font-medium text-ink">{run.fileName}</p>
              <p className="text-xs text-ink-muted">
                {IMPORT_DEFINITIONS[run.entity].label} · {run.created} added · {run.updated} updated ·{' '}
                {run.failed} failed · {formatRelative(run.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function MapStep({
  entity,
  preview,
  mapping,
  onChange,
  onBack,
  onNext,
  checking,
}: {
  entity: ImportEntity;
  preview: ImportPreviewDto;
  mapping: ImportMapping;
  onChange: (mapping: ImportMapping) => void;
  onBack: () => void;
  onNext: () => void;
  checking: boolean;
}) {
  const definition = IMPORT_DEFINITIONS[entity];
  const options = preview.headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }));
  const missing = definition.fields.filter((f) => f.required && mapping[f.key] == null);
  const used = new Map<number, number>();
  Object.values(mapping).forEach((i) => i != null && used.set(i, (used.get(i) ?? 0) + 1));

  return (
    <Card>
      <CardBody className="space-y-5">
        <div>
          <p className="text-sm font-semibold text-ink">Match your columns</p>
          <p className="mt-1 text-sm text-ink-muted">
            {preview.fileName} has {plural(preview.totalRows, 'row', 'rows')}. We matched the columns we recognised.
            Check them, and pick any we missed.
          </p>
        </div>

        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          {definition.fields.map((field) => {
            const value = mapping[field.key];
            const twice = value != null && (used.get(value) ?? 0) > 1;
            return (
              <Select
                key={field.key}
                label={field.label}
                required={field.required}
                placeholder="Don't import"
                options={options}
                value={value == null ? '' : String(value)}
                hint={twice ? 'This column is also used for another field.' : field.hint}
                onChange={(e) =>
                  onChange({ ...mapping, [field.key]: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            );
          })}
        </div>

        {missing.length > 0 && (
          <Alert tone="warning">Pick a column for {missing.map((f) => f.label).join(', ')}.</Alert>
        )}

        <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onBack}>
            Choose another file
          </Button>
          <Button onClick={onNext} loading={checking} disabled={missing.length > 0}>
            Check rows
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

const MATCH_BADGE: Record<ImportPreviewRow['match'], { tone: 'success' | 'info' | 'warning'; label: string }> = {
  new: { tone: 'success', label: 'New' },
  existing: { tone: 'info', label: 'Already exists' },
  repeat: { tone: 'warning', label: 'Repeated in file' },
};

function ReviewStep({
  entity,
  preview,
  canUpdate,
  onDuplicate,
  onDuplicateChange,
  onBack,
  onImport,
  importing,
}: {
  entity: ImportEntity;
  preview: ImportPreviewDto;
  canUpdate: boolean;
  onDuplicate: ImportDuplicateMode;
  onDuplicateChange: (mode: ImportDuplicateMode) => void;
  onBack: () => void;
  onImport: () => void;
  importing: boolean;
}) {
  const definition = IMPORT_DEFINITIONS[entity];
  const [onlyProblems, setOnlyProblems] = useState(preview.counts.invalid > 0);
  const { counts } = preview;
  const existingValid = preview.rows.filter((r) => r.match === 'existing' && r.issues.length === 0).length;
  const toCreate = counts.valid - existingValid;
  const toUpdate = canUpdate && onDuplicate === 'update' ? existingValid : 0;
  const shownFields = definition.fields.filter((f) => preview.mapping[f.key] != null).slice(0, 4);
  const rows = (onlyProblems ? preview.rows.filter((r) => r.issues.length > 0) : preview.rows).slice(
    0,
    REVIEW_ROWS_SHOWN,
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Ready" value={counts.valid} tone="success" />
        <Stat label="With problems" value={counts.invalid} tone={counts.invalid ? 'danger' : undefined} />
        <Stat label="Already exist" value={counts.existing} />
        <Stat label="Repeated in file" value={counts.repeats} />
      </div>

      {counts.existing > 0 && (
        <Card>
          <CardBody>
            <fieldset>
              <legend className="text-sm font-semibold text-ink">
                {plural(counts.existing, `${definition.noun} already exists`, `${definition.nounPlural} already exist`)}
              </legend>
              <p className="mt-1 text-sm text-ink-muted">Matched by {definition.matchedBy}.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-6">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="duplicates"
                    checked={!canUpdate || onDuplicate === 'skip'}
                    onChange={() => onDuplicateChange('skip')}
                    className="accent-brand"
                  />
                  Skip them
                </label>
                <label className={cn('flex items-center gap-2 text-sm', canUpdate ? 'text-ink' : 'text-ink-subtle')}>
                  <input
                    type="radio"
                    name="duplicates"
                    disabled={!canUpdate}
                    checked={canUpdate && onDuplicate === 'update'}
                    onChange={() => onDuplicateChange('update')}
                    className="accent-brand"
                  />
                  Update them with this file
                </label>
              </div>
              {!canUpdate && (
                <p className="mt-2 text-xs text-ink-muted">
                  {definition.canUpdate
                    ? `You can add ${definition.nounPlural} but not change them, so these are skipped.`
                    : 'These are skipped.'}
                </p>
              )}
            </fieldset>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Rows</p>
            {counts.invalid > 0 && (
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={onlyProblems}
                  onChange={(e) => setOnlyProblems(e.target.checked)}
                  className="accent-brand"
                />
                Only rows with problems
              </label>
            )}
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {rows.map((row) => (
              <li key={row.rowNumber} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex shrink-0 items-center gap-2 sm:w-44">
                  <span className="w-14 text-xs text-ink-subtle tabular-nums">Row {row.rowNumber}</span>
                  {row.issues.length ? (
                    <Badge tone="danger">Problem</Badge>
                  ) : (
                    <Badge tone={MATCH_BADGE[row.match].tone}>{MATCH_BADGE[row.match].label}</Badge>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">
                    {shownFields.map((f) => row.values[f.key]).filter(Boolean).join(' · ') || '—'}
                  </p>
                  {row.issues.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {row.issues.map((issue, i) => (
                        <li key={i} className="text-xs text-danger">
                          {issue.field ? `${fieldLabel(entity, issue.field)}: ` : ''}
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!row.issues.length && row.match === 'existing' && row.matchLabel && (
                    <p className="mt-1 text-xs text-ink-muted">Matches {row.matchLabel}</p>
                  )}
                </div>
              </li>
            ))}
            {rows.length === 0 && <li className="p-3 text-sm text-ink-muted">No rows to show.</li>}
          </ul>
          {preview.rows.length > REVIEW_ROWS_SHOWN && (
            <p className="text-xs text-ink-muted">
              Showing the first {REVIEW_ROWS_SHOWN} rows. Every row is checked again when you import.
            </p>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={onBack} disabled={importing}>
          Back to columns
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <p className="text-sm text-ink-muted">
            {plural(toCreate, `new ${definition.noun}`, `new ${definition.nounPlural}`)}
            {toUpdate ? `, ${toUpdate.toLocaleString()} updated` : ''}
            {counts.invalid ? `. ${plural(counts.invalid, 'row', 'rows')} with problems will be left out.` : '.'}
          </p>
          <Button onClick={onImport} loading={importing} disabled={toCreate + toUpdate === 0}>
            {importing ? 'Importing…' : 'Import'}
          </Button>
        </div>
      </div>
    </div>
  );
}

const fieldLabel = (entity: ImportEntity, key: string) =>
  IMPORT_DEFINITIONS[entity].fields.find((f) => f.key === key)?.label ?? key;

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'danger' }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function ResultStep({ run, onAgain }: { run: ImportRunDto; onAgain: () => void }) {
  const definition = IMPORT_DEFINITIONS[run.entity];
  const [busy, setBusy] = useState<ImportFileFormat | null>(null);
  const download = async (format: ImportFileFormat) => {
    setBusy(format);
    try {
      await saveBlob(await api.imports.errors(run.id, format), `${run.entity}-failed-rows.${format}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <Alert tone={run.failed ? 'warning' : 'success'}>
        {run.failed
          ? `Import finished. ${plural(run.failed, 'row was', 'rows were')} not imported.`
          : 'Import finished.'}
      </Alert>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Added" value={run.created} tone="success" />
        <Stat label="Updated" value={run.updated} />
        <Stat label="Skipped" value={run.skipped} />
        <Stat label="Failed" value={run.failed} tone={run.failed ? 'danger' : undefined} />
      </div>

      {run.failed > 0 && (
        <Card>
          <CardBody className="space-y-3">
            <p className="text-sm font-semibold text-ink">Rows not imported</p>
            <p className="text-sm text-ink-muted">
              Download them with the reason in the last column, fix them, and import that file.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" loading={busy === 'xlsx'} onClick={() => download('xlsx')}>
                <Download className="size-3.5" />
                Failed rows (Excel)
              </Button>
              <Button variant="outline" size="sm" loading={busy === 'csv'} onClick={() => download('csv')}>
                <Download className="size-3.5" />
                Failed rows (CSV)
              </Button>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {run.failures.slice(0, 20).map((f) => (
                <li key={f.rowNumber} className="p-3 text-sm">
                  <span className="text-xs text-ink-subtle tabular-nums">Row {f.rowNumber}</span>
                  <p className="text-xs text-danger">
                    {f.issues.map((i) => (i.field ? `${fieldLabel(run.entity, i.field)}: ${i.message}` : i.message)).join(' ')}
                  </p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Link href={LIST_HREF[run.entity]}>
          <Button>See {run.entity === 'opening-stock' ? 'stock' : definition.nounPlural}</Button>
        </Link>
        <Button variant="outline" onClick={onAgain}>
          <RotateCcw className="size-4" />
          Import another file
        </Button>
      </div>
    </div>
  );
}
