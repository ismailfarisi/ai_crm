# Seamless Editorial Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove chunky "AI-generated" cards, harsh borders, and heavy elevations across Relay CRM. Replace them with seamless horizontal stat strips, fluid borderless tables, razor-thin hairlines, and bespoke typography matching the reference aesthetic.

**Architecture:** Redesign `quotes-view.tsx`, `primitives.tsx`, `data-table.tsx`, `dashboard/page.tsx`, and the Quote Studio to replace chunky box cards with integrated stat strips and seamless fluid panels.

**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4, Lucide Icons, React 19, TypeScript.

---

### Task 1: Seamless Quotes Overview & Data Table

**Files:**
- Modify: `apps/web/src/components/quotes/quotes-view.tsx`
- Modify: `apps/web/src/components/quotes/quotes-table.tsx`
- Modify: `apps/web/src/components/ui/data-table.tsx`
- Modify: `apps/web/src/components/ui/data-table/data-table-toolbar.tsx`

**Requirements:**
1. In `quotes-view.tsx`:
   - Replace the 4 separate `<Stat>` `<Card>` boxes with a single integrated `<div className="flex flex-wrap items-center gap-10 py-1">` stat strip directly on the page.
   - Refine action buttons: Sleek pill buttons (`rounded-full px-5 py-2 text-xs font-semibold`).
   - Remove outer `<Card>` wrapping around `<QuotesTable />` to let the table breathe seamlessly.
2. In `data-table.tsx` and `quotes-table.tsx`:
   - Replace heavy border card wrapper with a seamless fluid surface (`bg-surface/80 rounded-2xl border border-border/30 shadow-[0_2px_12px_rgba(0,0,0,0.015)]`).
   - Make the search input a refined pill (`rounded-full pl-9 pr-4 py-2 text-xs bg-surface-muted/40 border border-border/40 focus:bg-surface`).
   - Use hairline row dividers (`border-b border-border/25`) and generous padding (`py-3.5`).
3. Verify with `npx pnpm --filter web build`.
4. Commit: `style(quotes): transform quotes list and table into seamless editorial layout`.

---

### Task 2: UI Primitives & Button Polish

**Files:**
- Modify: `apps/web/src/components/ui/primitives.tsx`
- Modify: `apps/web/src/components/ui/button.tsx`
- Modify: `apps/web/src/app/globals.css`

**Requirements:**
1. In `primitives.tsx`:
   - `Card`: Remove harsh borders and chunky shadows; use `rounded-2xl border border-border/35 bg-surface/80 backdrop-blur-xs shadow-[0_2px_10px_rgba(0,0,0,0.015)]`.
   - `CardHeader`: Hairline divider `border-b border-border/30 px-6 py-4`.
   - `CardBody`: `px-6 py-5`.
   - `Badge`: Soft pill without heavy outlines.
2. In `button.tsx`:
   - Refine `primary` (`bg-brand text-ink font-semibold rounded-full hover:bg-brand-hover shadow-xs`), `dark` (`bg-[#1E1E1E] text-white font-medium rounded-full hover:bg-[#2C2C2C] shadow-xs`), and `outline` (`rounded-full border border-border/50 bg-surface/50 hover:bg-surface text-ink`).
3. Verify with `npx pnpm --filter web build`.
4. Commit: `style(ui): polish UI primitives and buttons with seamless styling`.

---

### Task 3: Quotation Studio Polish

**Files:**
- Modify: `apps/web/src/components/quotes/quote-editor/quote-editor-page.tsx`
- Modify: `apps/web/src/components/quotes/quote-editor/quote-header-form.tsx`
- Modify: `apps/web/src/components/quotes/quote-editor/quote-lines-table.tsx`
- Modify: `apps/web/src/components/quotes/quote-editor/quote-totals-card.tsx`
- Modify: `apps/web/src/components/quotes/quote-status-pipeline.tsx`

**Requirements:**
1. In `quote-editor-page.tsx`:
   - Replace nested heavy boxes with seamless sheet panels.
   - Refine action buttons to pill format.
2. In `quote-status-pipeline.tsx`:
   - Refine status tracker into a sleek, minimalist breadcrumb track with hairline dividers and soft pill highlights.
3. In `quote-header-form.tsx`:
   - Clean seamless form layout with subtle input backgrounds (`bg-surface-muted/30 border-border/40 focus:bg-surface`).
4. In `quote-lines-table.tsx` & `quote-totals-card.tsx`:
   - Clean, borderless or hairline-divided table with airy rows.
   - Totals summary box embedded seamlessly without heavy nested cards.
5. Verify with `npx pnpm --filter web build`.
6. Commit: `style(quotes): refine quotation studio with seamless editorial sheet layout`.

---

### Task 4: Dashboard & Global Views Harmonization

**Files:**
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`
- Modify: `apps/web/src/components/invoices/invoices-view.tsx`

**Requirements:**
1. In `dashboard/page.tsx`:
   - Ensure the hero stat row uses the seamless inline stat strip without separate card boxes.
   - Seamless golden gauge and wave chart containers.
2. In `invoices-view.tsx`:
   - Replace 4 separate stat cards with seamless horizontal stat strip.
   - Fluid borderless table integration.
3. Verify with `npx pnpm --filter web build`.
4. Commit: `style(dashboard): harmonize dashboard and invoices with seamless stat strips`.

---

### Task 5: End-to-End Build & Test Verification

**Requirements:**
1. Run `npx pnpm --filter @saas/shared build`.
2. Run `npx pnpm --filter api test`.
3. Run `npx pnpm --filter web test`.
4. Run `npx pnpm --filter web build`.
5. Verify 100% tests pass and all 18 routes compile cleanly.
6. Commit and push to `origin/master`.
