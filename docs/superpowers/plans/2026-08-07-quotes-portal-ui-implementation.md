# Quotes & Invoices Portal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a responsive, permission-guarded UI in Relay CRM (`apps/web`) for creating, viewing, and approving AI & Human quotes, and viewing issued invoices.

**Architecture:** Add navigation links to `AppShell`, extend `api/endpoints.ts`, create custom React hooks (`use-quotes.ts`, `use-invoices.ts`), and build Quotes and Invoices pages (`/quotes`, `/invoices`) with modals for AI/Manual creation and Human-in-the-Loop workflow signal approvals.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Lucide Icons, Tailwind CSS / CSS Variables.

## Global Constraints

- Navigation items must use permission guards matching `PERMISSIONS.QUOTE_READ` and `PERMISSIONS.INVOICE_READ`.
- Follow existing patterns in `apps/web/src/components/layout/app-shell.tsx` and `apps/web/src/lib/api/endpoints.ts`.
- Ensure clean dark mode compatibility and fast page loads.

---

### Task 1: API Endpoints & Navigation Setup

**Files:**
- Modify: `apps/web/src/lib/api/endpoints.ts`
- Modify: `apps/web/src/components/layout/app-shell.tsx`

**Interfaces:**
- Consumes: `apiClient` helper in `apps/web/src/lib/api/client.ts`, `PERMISSIONS` from `@saas/shared`
- Produces: `api.quotes.*` and `api.invoices.*` methods, "Quotes" and "Invoices" sidebar items

- [ ] **Step 1: Update `apps/web/src/lib/api/endpoints.ts`**

Add `quotes` and `invoices` API methods:
```typescript
  quotes: {
    list: () => client.get<any[]>('/quotes'),
    get: (id: string) => client.get<any>(`/quotes/${id}`),
    create: (payload: { createdBy: 'AI' | 'HUMAN'; title: string; prompt?: string; items?: any[]; totalAmount?: number }) =>
      client.post<any>('/quotes', payload),
    signal: (id: string, payload: { action: 'APPROVE' | 'REJECT' | 'OVERRIDE'; payload?: any }) =>
      client.post<any>(`/quotes/${id}/signal`, payload),
  },
  invoices: {
    list: () => client.get<any[]>('/invoices'),
  },
```

- [ ] **Step 2: Add sidebar navigation items to `apps/web/src/components/layout/app-shell.tsx`**

Import `FileText` and `Receipt` icons from `lucide-react`. Add items under `NAV_SECTIONS`:
```typescript
  {
    href: '/quotes',
    label: 'Quotes',
    icon: FileText,
    rule: { permission: PERMISSIONS.QUOTE_READ },
  },
  {
    href: '/invoices',
    label: 'Invoices',
    icon: Receipt,
    rule: { permission: PERMISSIONS.INVOICE_READ },
  },
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter web build` or `pnpm --filter @saas/web build`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api/endpoints.ts apps/web/src/components/layout/app-shell.tsx
git commit -m "feat(web): add quotes and invoices API endpoints and navigation items"
```

---

### Task 2: Custom React Hooks (`useQuotes` & `useInvoices`)

**Files:**
- Create: `apps/web/src/hooks/use-quotes.ts`
- Create: `apps/web/src/hooks/use-invoices.ts`

**Interfaces:**
- Consumes: `api` from `@/lib/api/endpoints`
- Produces: `useQuotes()` and `useInvoices()` custom hooks with list, create, and signal methods

- [ ] **Step 1: Create `apps/web/src/hooks/use-quotes.ts`**

Implement hook fetching `/quotes` list, state management, `createQuote()` function, and `sendSignal()` function.

- [ ] **Step 2: Create `apps/web/src/hooks/use-invoices.ts`**

Implement hook fetching `/invoices` list and loading state.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/use-quotes.ts apps/web/src/hooks/use-invoices.ts
git commit -m "feat(web): add useQuotes and useInvoices custom hooks"
```

---

### Task 3: Quotes Components & Create Quote Modal

**Files:**
- Create: `apps/web/src/components/quotes/quote-status-badge.tsx`
- Create: `apps/web/src/components/quotes/create-quote-modal.tsx`
- Create: `apps/web/src/components/quotes/quotes-table.tsx`

**Interfaces:**
- Consumes: `useQuotes` hook, `Button`, `Dialog`, `Input` components
- Produces: `<QuoteStatusBadge>`, `<CreateQuoteModal>`, `<QuotesTable>` components

- [ ] **Step 1: Create `quote-status-badge.tsx`**

Render colored status pills for `DRAFT`, `AWAITING_APPROVAL`, `APPROVED`, `REJECTED`.

- [ ] **Step 2: Create `create-quote-modal.tsx`**

Tabbed modal with "AI Agent Draft" (prompt) and "Manual Entry" (dynamic line items).

- [ ] **Step 3: Create `quotes-table.tsx`**

Table showing Title, Created By (`AI` vs `HUMAN`), Amount, Status Badge, and Action buttons (Approve/Reject).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/quotes/
git commit -m "feat(web): add quotes table, status badge, and creation modal"
```

---

### Task 4: Invoices Table Component & App Pages (`/quotes` & `/invoices`)

**Files:**
- Create: `apps/web/src/components/invoices/invoices-table.tsx`
- Create: `apps/web/src/app/(app)/quotes/page.tsx`
- Create: `apps/web/src/app/(app)/invoices/page.tsx`

**Interfaces:**
- Consumes: `<AppShell>`, `<PageGuard>`, `useQuotes`, `useInvoices`
- Produces: `/quotes` and `/invoices` portal pages

- [ ] **Step 1: Create `invoices-table.tsx`**

Table displaying Invoice Number, Quote ID, Amount, Status (`ISSUED`, `PAID`), and Issued Date.

- [ ] **Step 2: Create `apps/web/src/app/(app)/quotes/page.tsx`**

Guarded page rendering header with "Create Quote" button, stats summary, and `<QuotesTable>`.

- [ ] **Step 3: Create `apps/web/src/app/(app)/invoices/page.tsx`**

Guarded page rendering header and `<InvoicesTable>`.

- [ ] **Step 4: Verify Next.js build**

Run: `pnpm --filter web build`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/invoices/ apps/web/src/app/\(app\)/quotes/ apps/web/src/app/\(app\)/invoices/
git commit -m "feat(web): add quotes and invoices pages and portal UI"
```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-quotes-portal-ui-implementation.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a subagent per task with review checkpoints.
2. **Inline Execution** - Execute tasks together in this session.

Which approach would you like to take?
