"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, Calculator } from "lucide-react";
import {
  PERMISSIONS,
  type CostingPolicy,
  type OverheadSuggestionDto,
} from "@saas/shared";
import { useCostingPolicy } from "@/hooks/use-catalog";
import {
  useAcceptOverheadSuggestion,
  useOverheadSuggestion,
  useUpdateOverheadPolicy,
} from "@/hooks/use-catalog-admin";
import { useCan } from "@/lib/session-context";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/utils";

const WINDOWS = [
  { value: "3", label: "Last 3 months" },
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
];

const pct = (fraction: number) => `${Math.round(fraction * 1000) / 10}%`;

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function spanLabel(months: string[]): string {
  if (!months.length) return "";
  const first = monthLabel(months[0]);
  const last = monthLabel(months[months.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * One overhead rate for the whole shop: what it is, where it came from, and
 * what the books say it should be. Nothing changes until the owner accepts
 * the suggestion or types a rate; ignoring it just hides it.
 */
export function OverheadRatePanel({
  currency,
}: {
  currency: string | undefined;
}) {
  const canManage = useCan({ permission: PERMISSIONS.CATALOG_MANAGE });
  const canSeeCost = useCan({ permission: PERMISSIONS.QUOTE_VIEW_COST });
  const { policy, isLoading } = useCostingPolicy();
  const unhide = useUpdateOverheadPolicy();

  if (isLoading || !policy) return <Skeleton className="h-64" />;
  const hidden = policy.defaultOverhead?.suggestionHidden;

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-ink-muted">
        Overhead is what it costs to keep the shop open — rent, utilities,
        office salaries, insurance — spread over the jobs you make. Kerf adds it
        on top of materials, machine time, labour and tooling. One rate here
        covers every template that doesn&apos;t set its own.
      </p>

      {/* Keyed on the rate so the box shows the saved value after any change. */}
      <CurrentRate
        key={policy.defaultOverheadPct}
        policy={policy}
        currency={canSeeCost ? currency : undefined}
        canEdit={canManage}
      />

      {canManage && canSeeCost ? (
        hidden ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border/80 px-4 py-3">
            <p className="text-sm text-ink-muted">
              You chose to ignore the suggestion from your books.
            </p>
            <Button
              size="sm"
              variant="outline"
              loading={unhide.isPending}
              onClick={() => unhide.mutate({ overheadSuggestionHidden: false })}
            >
              Show it again
            </Button>
          </div>
        ) : (
          <Suggestion policy={policy} currency={currency} />
        )
      ) : (
        <p className="text-sm text-ink-subtle">
          Only people who can see costs and change the catalog can see the
          suggestion from the books.
        </p>
      )}
    </div>
  );
}

function CurrentRate({
  policy,
  currency,
  canEdit,
}: {
  policy: CostingPolicy;
  currency: string | undefined;
  canEdit: boolean;
}) {
  const info = policy.defaultOverhead;
  const [value, setValue] = useState(
    String(Math.round(policy.defaultOverheadPct * 1000) / 10),
  );
  const update = useUpdateOverheadPolicy();

  const parsed = Number(value);
  const valid =
    value.trim() !== "" &&
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    parsed <= 100;
  const changed =
    valid && Math.abs(parsed / 100 - policy.defaultOverheadPct) > 1e-9;
  const basis = info?.basis;

  return (
    <section
      aria-labelledby="shop-rate-heading"
      className="rounded-xl border border-border/60 bg-surface p-4"
      data-testid="shop-overhead-rate"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 id="shop-rate-heading" className="text-sm font-semibold text-ink">
            Shop overhead rate
          </h2>
          <p className="text-3xl font-semibold tabular-nums text-ink">
            {pct(policy.defaultOverheadPct)}
          </p>
          <p className="text-sm text-ink-muted">
            {policy.defaultOverheadPct > 0
              ? `Every ${currency ?? ""} 100 of direct cost carries ${currency ?? ""} ${Math.round(policy.defaultOverheadPct * 1000) / 10} of overhead.`.replace(
                  /\s+/g,
                  " ",
                )
              : "Not set yet, so templates that use the shop rate add no overhead."}
          </p>
          {info?.source === "BOOKS" && basis ? (
            <p className="text-xs text-ink-subtle">
              From your books, {spanLabel(basis.months)}
              {currency
                ? `: ${formatMoney(basis.overheadTotal, basis.currency)} running costs ÷ ${formatMoney(basis.directTotal, basis.currency)} direct cost`
                : ""}
              {info.setAt ? `. Set ${formatDate(info.setAt)}.` : "."}
            </p>
          ) : info?.source === "BOOKS" ? (
            <p className="text-xs text-ink-subtle">
              From your books
              {info.setAt ? `, set ${formatDate(info.setAt)}` : ""}.
            </p>
          ) : info?.source === "TYPED" ? (
            <p className="text-xs text-ink-subtle">
              Typed in by hand
              {info.setAt ? ` on ${formatDate(info.setAt)}` : ""}.
            </p>
          ) : null}
        </div>
        {canEdit && (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (changed)
                update.mutate({
                  defaultOverheadPct: Math.round(parsed * 100) / 10_000,
                });
            }}
          >
            <Input
              id="shop-overhead-input"
              label="Set it yourself (%)"
              inputMode="decimal"
              value={value}
              error={
                value.trim() !== "" && !valid ? "Between 0 and 100" : undefined
              }
              onChange={(event) => setValue(event.target.value)}
              containerClassName="w-40"
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!changed}
              loading={update.isPending}
            >
              Save
            </Button>
          </form>
        )}
      </div>
      <p className="mt-3 text-xs text-ink-subtle">
        Changing it affects quotes priced from now on. Quotes already sent and
        jobs already planned keep the rate they were made with.
      </p>
    </section>
  );
}

function Suggestion({
  policy,
  currency,
}: {
  policy: CostingPolicy;
  currency: string | undefined;
}) {
  const [months, setMonths] = useState(6);
  const [excluded, setExcluded] = useState<string[]>(
    policy.defaultOverhead?.basis?.excludedAccountCodes ?? [],
  );
  const { data, isPending, isError, error } = useOverheadSuggestion(
    months,
    excluded,
  );
  const accept = useAcceptOverheadSuggestion();
  const hide = useUpdateOverheadPolicy();
  const money = (n: number) => formatMoney(n, data?.currency ?? currency);

  const toggle = (code: string) =>
    setExcluded((list) =>
      list.includes(code) ? list.filter((c) => c !== code) : [...list, code],
    );

  return (
    <section
      aria-labelledby="suggestion-heading"
      className="space-y-4 rounded-xl border border-border/60 bg-surface p-4"
      data-testid="overhead-suggestion"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="suggestion-heading"
            className="flex items-center gap-2 text-sm font-semibold text-ink"
          >
            <BookOpen className="size-4" />
            What your books suggest
          </h2>
          <p className="max-w-2xl text-sm text-ink-muted">
            Your running costs divided by your direct cost (cost of sales), over
            full months only. That is the rate that would have paid for the
            shop&apos;s overheads out of the jobs it made.
          </p>
        </div>
        <Select
          aria-label="Months to look at"
          value={String(months)}
          onChange={(event) => setMonths(Number(event.target.value))}
          options={WINDOWS}
        />
      </div>

      {isPending ? (
        <Skeleton className="h-48" />
      ) : isError || !data ? (
        <EmptyState
          title="Couldn't work out a suggestion"
          description={
            error instanceof Error ? error.message : "Please try again."
          }
        />
      ) : (
        <>
          <Headline data={data} money={money} />

          {data.monthsCounted.length > 0 &&
            (data.overheadAccounts.length > 0 ||
              data.directAccounts.length > 0) && (
              <div className="grid gap-4 lg:grid-cols-2">
                <AccountList
                  title="Running costs (overhead)"
                  hint="Untick anything that is really a job cost, or already priced in work-centre rates."
                  accounts={data.overheadAccounts}
                  total={data.overheadTotal}
                  money={money}
                  onToggle={toggle}
                />
                <AccountList
                  title="Direct cost (cost of sales)"
                  hint="Materials, labour and bought-in work charged to jobs."
                  accounts={data.directAccounts}
                  total={data.directTotal}
                  money={money}
                />
              </div>
            )}

          {data.byMonth.length > 0 && <MonthTable data={data} money={money} />}

          {data.notes.length > 0 && (
            <ul className="list-disc space-y-1 rounded-lg bg-surface-muted/50 py-3 pr-4 pl-8 text-sm text-ink-muted">
              {data.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          <TemplatesAffected data={data} />

          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
            {data.status === "READY" && data.suggestedPct !== null && (
              <Button
                loading={accept.isPending}
                disabled={Math.abs(data.suggestedPct - data.currentPct) < 1e-9}
                onClick={() =>
                  accept.mutate({ months, excludeAccountCodes: excluded })
                }
              >
                <Calculator className="size-4" />
                Use {pct(data.suggestedPct)}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() =>
                document.getElementById("shop-overhead-input")?.focus()
              }
            >
              Type my own rate
            </Button>
            <Button
              variant="secondary"
              loading={hide.isPending}
              onClick={() => hide.mutate({ overheadSuggestionHidden: true })}
            >
              Ignore suggestion
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Headline({
  data,
  money,
}: {
  data: OverheadSuggestionDto;
  money: (n: number) => string;
}) {
  const span = spanLabel(data.monthsCounted);
  switch (data.status) {
    case "READY":
      return (
        <div className="space-y-1">
          <p
            className="text-2xl font-semibold tabular-nums text-ink"
            data-testid="suggested-rate"
          >
            {pct(data.suggestedPct ?? 0)}
          </p>
          <p className="text-sm text-ink">
            {money(data.overheadTotal)} running costs ÷{" "}
            {money(data.directTotal)} direct cost, {span} (
            {data.monthsCounted.length} full month
            {data.monthsCounted.length === 1 ? "" : "s"}).
          </p>
          {Math.abs((data.suggestedPct ?? 0) - data.currentPct) < 1e-9 && (
            <Badge tone="success">This is already your shop rate</Badge>
          )}
        </div>
      );
    case "NOT_ENOUGH_HISTORY":
      return (
        <Alert tone="info">
          Not enough history yet. Kerf needs at least three full months of books
          to suggest a rate
          {data.monthsCounted.length
            ? `; you have ${data.monthsCounted.length} (${span})`
            : data.booksStart
              ? ""
              : " and nothing has been posted yet"}
          .
          {data.availableFrom
            ? ` A suggestion will be ready from ${formatDate(data.availableFrom)}.`
            : ""}{" "}
          Until then, type a rate you are comfortable with — 10% to 20% is
          common for small workshops.
        </Alert>
      );
    case "NO_DIRECT_COST":
      return (
        <Alert tone="warning">
          Nothing reached cost of sales in {span}, so there is nothing to divide
          the overheads by. Cost of sales fills up when jobs are completed and
          invoiced through Kerf. Type a rate for now.
        </Alert>
      );
    case "NO_OVERHEAD":
      return (
        <Alert tone="warning">
          No running costs were recorded in {span}. Record rent, utilities and
          salaries as bills, expenses or payroll and the suggestion will follow.
        </Alert>
      );
    case "ABOVE_100":
      return (
        <Alert tone="warning">
          Your books say {pct(data.ratePct ?? 0)}: {money(data.overheadTotal)}{" "}
          running costs against only {money(data.directTotal)} direct cost in{" "}
          {span}. That is too high to use as it is — see the note below.
        </Alert>
      );
  }
}

function AccountList({
  title,
  hint,
  accounts,
  total,
  money,
  onToggle,
}: {
  title: string;
  hint: string;
  accounts: OverheadSuggestionDto["overheadAccounts"];
  total: number;
  money: (n: number) => string;
  onToggle?: (code: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border/60">
      <div className="border-b border-border/60 px-3 py-2">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <p className="text-xs text-ink-subtle">{hint}</p>
      </div>
      {accounts.length === 0 ? (
        <p className="px-3 py-3 text-sm text-ink-muted">Nothing recorded.</p>
      ) : (
        <ul className="divide-y divide-border/40 text-sm">
          {accounts.map((account) => (
            <li
              key={account.code}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <label
                className={`flex items-center gap-2 ${onToggle ? "cursor-pointer" : ""}`}
              >
                {onToggle && (
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={account.included}
                    onChange={() => onToggle(account.code)}
                    aria-label={`Count ${account.name}`}
                  />
                )}
                <span
                  className={
                    account.included
                      ? "text-ink"
                      : "text-ink-subtle line-through"
                  }
                >
                  {account.name}
                  <span className="ml-1 text-xs text-ink-subtle">
                    {account.code}
                  </span>
                </span>
              </label>
              <span
                className={`tabular-nums ${account.included ? "text-ink" : "text-ink-subtle"}`}
              >
                {money(account.amount)}
              </span>
            </li>
          ))}
          <li className="flex justify-between px-3 py-2 font-medium">
            <span>Total counted</span>
            <span className="tabular-nums">{money(total)}</span>
          </li>
        </ul>
      )}
    </div>
  );
}

function MonthTable({
  data,
  money,
}: {
  data: OverheadSuggestionDto;
  money: (n: number) => string;
}) {
  return (
    <details className="rounded-lg border border-border/60">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">
        Month by month
      </summary>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-subtle">
            <th className="px-3 py-2 font-medium">Month</th>
            <th className="px-3 py-2 text-right font-medium">Running costs</th>
            <th className="px-3 py-2 text-right font-medium">Direct cost</th>
            <th className="px-3 py-2 text-right font-medium">
              Rate that month
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {data.byMonth.map((m) => (
            <tr key={m.month}>
              <td className="px-3 py-2">{monthLabel(m.month)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(m.overhead)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(m.direct)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                {m.direct > 0 ? pct(m.overhead / m.direct) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 pb-3 text-xs text-ink-subtle">
        Single months swing with rent dates and big jobs; the rate above uses
        the months together.
      </p>
    </details>
  );
}

function TemplatesAffected({ data }: { data: OverheadSuggestionDto }) {
  const { usingShopRate, ownRate } = data.templates;
  if (!usingShopRate.length && !ownRate.length) return null;
  return (
    <div className="grid gap-4 text-sm lg:grid-cols-2">
      <div>
        <h3 className="font-medium text-ink">
          Templates that use the shop rate ({usingShopRate.length})
        </h3>
        <p className="text-xs text-ink-subtle">
          These change when the shop rate changes.
        </p>
        <p className="mt-1 text-ink-muted">
          {usingShopRate.length
            ? usingShopRate.map((t) => t.name).join(", ")
            : "None yet."}
        </p>
      </div>
      <div>
        <h3 className="font-medium text-ink">
          Templates with their own rate ({ownRate.length})
        </h3>
        <p className="text-xs text-ink-subtle">
          These keep their own percentage. Edit one to switch it to the shop
          rate.
        </p>
        <ul className="mt-1 space-y-0.5">
          {ownRate.map((t) => (
            <li key={t.id} className="flex justify-between gap-3">
              <Link
                href={`/catalog/templates/${t.id}`}
                className="text-primary hover:underline"
              >
                {t.name}
              </Link>
              <span className="tabular-nums text-ink-muted">
                {pct(t.overheadPct)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
