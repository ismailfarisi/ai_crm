# Warm Modern Sandstone & Golden-Amber Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the visual design of Relay CRM into a warm modern sandstone and golden-amber aesthetic with a 2-column sidebar tile grid, greeting banner, circular gauge widgets, golden wave charts, and 16px-20px rounded cards matching the reference design.

**Architecture:** Update Tailwind/CSS tokens in `globals.css`, rebuild `app-shell.tsx` with a 2x3 navigation tile grid and pill search bar, overhaul `/dashboard` with dynamic greeting, golden gauges, and wave charts, and polish UI primitives across the application.

**Tech Stack:** Next.js 16 (App Router), Tailwind CSS v4, Lucide Icons, React 19, TypeScript.

## Global Constraints
- Preserve all existing RBAC permissions, routes, and authentication guards.
- Support both Light mode (warm sandstone cream) and Dark mode (warm dark obsidian).
- All cards and containers use generous `rounded-2xl` / `rounded-3xl` radii with warm diffusion shadows.
- Zero build or type errors across the monorepo.

---

### Task 1: Global Theme Tokens & Core Styles in `globals.css`

**Files:**
- Modify: `apps/web/src/app/globals.css`

**Interfaces:**
- Consumes: Tailwind v4 `@theme`
- Produces: Warm sandstone canvas tokens (`--color-canvas`), golden amber brand tokens (`--color-brand`), charcoal active tokens (`--color-brand-dark`), and soft warm borders (`--color-border`).

- [ ] **Step 1: Update `globals.css` with warm sandstone and golden-amber palette**

```css
@import "tailwindcss";

@theme {
  /* Warm Sandstone & Cream Light Palette */
  --color-canvas: oklch(0.975 0.015 80);        /* Warm Cream Oatmeal #F9F6F0 */
  --color-surface: oklch(1 0 0);                /* Pure Warm White #FFFFFF */
  --color-surface-muted: oklch(0.945 0.02 80);  /* Soft Sandstone #F3EDE2 */
  --color-border: oklch(0.905 0.015 80);        /* Fine Sandstone Stroke #EBE4D8 */
  --color-border-strong: oklch(0.82 0.025 80);  /* Deep Sandstone Stroke #D8CEBE */

  --color-ink: oklch(0.18 0.015 60);            /* Warm Dark Espresso #1C1B19 */
  --color-ink-muted: oklch(0.48 0.02 60);       /* Warm Slate Taupe #6B665E */
  --color-ink-subtle: oklch(0.65 0.015 60);     /* Muted Sand #9E978E */
  --color-ink-inverted: oklch(0.99 0 0);

  --color-brand: oklch(0.78 0.16 75);           /* Golden Amber #F59E0B */
  --color-brand-hover: oklch(0.72 0.17 75);     /* Rich Amber Gold #D97706 */
  --color-brand-soft: oklch(0.96 0.05 85);      /* Warm Amber Cream Tint #FEF3C7 */
  --color-brand-ring: oklch(0.78 0.16 75);
  --color-brand-dark: oklch(0.18 0.01 260);     /* Deep Charcoal Onyx #1E1E1E for active tiles */

  --color-success: oklch(0.65 0.15 150);
  --color-success-soft: oklch(0.96 0.04 150);
  --color-warning: oklch(0.78 0.16 75);
  --color-warning-soft: oklch(0.96 0.05 85);
  --color-danger: oklch(0.60 0.19 25);
  --color-danger-hover: oklch(0.54 0.19 25);
  --color-danger-soft: oklch(0.96 0.03 25);
  --color-info: oklch(0.65 0.12 230);
  --color-info-soft: oklch(0.96 0.03 230);

  --radius-card: 1.25rem;                       /* 20px smooth rounded */
  --radius-pill: 9999px;
}

@layer theme {
  .dark {
    --color-canvas: oklch(0.15 0.01 60);        /* Deep Obsidian #181715 */
    --color-surface: oklch(0.20 0.012 60);      /* Dark Warm Charcoal #22201D */
    --color-surface-muted: oklch(0.25 0.015 60);/* #2C2A26 */
    --color-border: oklch(0.30 0.015 60);       /* #3B3833 */
    --color-border-strong: oklch(0.38 0.02 60);

    --color-ink: oklch(0.96 0.005 80);
    --color-ink-muted: oklch(0.75 0.01 80);
    --color-ink-subtle: oklch(0.60 0.01 80);
    --color-ink-inverted: oklch(0.18 0.01 60);

    --color-brand: oklch(0.80 0.16 75);         /* Luminous Golden Amber */
    --color-brand-hover: oklch(0.84 0.16 75);
    --color-brand-soft: oklch(0.32 0.06 75);
    --color-brand-ring: oklch(0.80 0.16 75);
    --color-brand-dark: oklch(0.12 0.01 60);
  }
}
```

- [ ] **Step 2: Verify styles with build**

Run: `npx pnpm --filter @saas/web build`
Expected: Build passes with 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "style(web): implement warm sandstone and golden-amber design tokens"
```

---

### Task 2: App Shell & Sidebar 2-Column Tile Redesign

**Files:**
- Modify: `apps/web/src/components/layout/app-shell.tsx`

**Interfaces:**
- Consumes: Navigation items, user session, `usePathname`
- Produces: 2-column quick action tile grid with `#1E1E1E` active tile, pill search bar, and user profile pill card.

- [ ] **Step 1: Rebuild `app-shell.tsx`**

Implement:
1. Search pill input at the top of the sidebar.
2. 2-column grid (`grid grid-cols-2 gap-2`) for top 6 core modules:
   - Dashboard, Inbox, Contacts, Customers, Quotes, Invoices.
   - Active state: `bg-[#1E1E1E] text-white shadow-md`.
   - Inactive state: `bg-surface-muted/60 text-ink-muted hover:bg-surface-muted hover:text-ink border border-border/50`.
3. Collapsible lower section for Secondary Navigation (Settings, Teams, Roles, Channels) with rounded items.
4. Bottom User Profile Pill card with avatar, name, role badge, and notification button.

- [ ] **Step 2: Run typecheck on web**

Run: `npx pnpm --filter @saas/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/app-shell.tsx
git commit -m "feat(web): redesign app shell with 2-column action tile grid and pill search"
```

---

### Task 3: Dashboard Overhaul with Golden Widgets

**Files:**
- Create: `apps/web/src/components/dashboard/dashboard-kpi-chart.tsx`
- Create: `apps/web/src/components/dashboard/dashboard-gauge-widget.tsx`
- Create: `apps/web/src/components/dashboard/dashboard-schedule-cards.tsx`
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`
- Modify: `apps/web/src/components/dashboard/` (or update existing dashboard view)

**Interfaces:**
- Consumes: `useQuotes`, `useSession`, `api.customers`, `api.invoices`
- Produces: Full dashboard matching the reference image (Hero greeting, summary stats bar, golden circular gauge, wave activity chart, and schedule/pending deals cards).

- [ ] **Step 1: Create `dashboard-gauge-widget.tsx`**

Implement circular SVG gauge meter with golden amber progress stroke, center percentage (`84% Win Rate`), and subtitle.

- [ ] **Step 2: Create `dashboard-kpi-chart.tsx`**

Implement golden wave trend chart using SVG spline curve with golden amber stroke and gradient fill.

- [ ] **Step 3: Create `dashboard-schedule-cards.tsx`**

Implement warm yellow gradient cards (`from-amber-100/80 to-amber-50/20`) for pending quotes, meetings, and deals.

- [ ] **Step 4: Update `dashboard/page.tsx`**

Assemble Hero Greeting (`"Good Morning, {Name}"` + date), Top Stats Bar, Golden Circular Gauge, Wave Chart, Schedule Cards, and Recent Customer Deals Table.

- [ ] **Step 5: Test & verify with `npx pnpm --filter @saas/web build`**

Expected: Clean compilation.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/dashboard/ apps/web/src/app/\(app\)/dashboard/
git commit -m "feat(web): implement warm golden-amber dashboard with gauge, wave chart, and greeting"
```

---

### Task 4: UI Primitives, Badges & Quotes Studio Polish

**Files:**
- Modify: `apps/web/src/components/ui/primitives.tsx`
- Modify: `apps/web/src/components/ui/button.tsx`
- Modify: `apps/web/src/components/ui/field.tsx`
- Modify: `apps/web/src/components/quotes/quote-editor/quote-editor-page.tsx`

**Interfaces:**
- Consumes: Design system tokens
- Produces: 16px-20px rounded cards, golden amber buttons, warm pill badges, and harmonized quote editor studio.

- [ ] **Step 1: Update `primitives.tsx` and `button.tsx`**

Ensure `Card` uses `rounded-2xl` with warm ambient shadow, `Badge` uses warm sandstone and amber tints, `Button` primary has golden amber background with bold text.

- [ ] **Step 2: Harmonize Quotes Studio**

Ensure `/quotes/new` and `/quotes/[id]` header ribbons and total summary cards use the new warm golden-amber palette.

- [ ] **Step 3: Run full workspace build & test**

Run: `npx pnpm build && npx pnpm test`
Expected: 0 errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/ apps/web/src/components/quotes/
git commit -m "style(web): polish UI primitives, buttons, badges, and quote studio with warm theme"
```

---

### Task 5: End-to-End Build & Final Verification

- [ ] **Step 1: Verify all 18 Next.js routes**

Run: `npx pnpm --filter @saas/web build`
Expected: All routes compile cleanly.

- [ ] **Step 2: Run all test suites**

Run: `npx pnpm test`
Expected: 100% tests pass.

- [ ] **Step 3: Commit and merge**

```bash
git add .
git commit -m "feat(theme): complete warm sandstone and golden-amber theme implementation"
```
