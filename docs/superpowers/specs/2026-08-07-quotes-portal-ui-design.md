# Design Specification: Quotes & Invoices Portal UI

## Overview
Implement a comprehensive frontend UI in Relay CRM (`apps/web`) for managing **Quotes & Invoices**. The UI connects directly to the NestJS API and Temporal workflow engine, enabling users to view quote workflow statuses in real-time, generate quotes using AI or manual inputs, and approve/reject/override quotes via human-in-the-loop actions.

---

## 1. Navigation & Route Protection

### Sidebar Configuration (`apps/web/src/components/layout/app-shell.tsx`)
Add two new navigation items under the main section:
- **Quotes**: `href: '/quotes'`, `icon: FileText`, `rule: { permission: PERMISSIONS.QUOTE_READ }`
- **Invoices**: `href: '/invoices'`, `icon: Receipt`, `rule: { permission: PERMISSIONS.INVOICE_READ }`

### App Routes
- `apps/web/src/app/(app)/quotes/page.tsx`: Quotes list & management page.
- `apps/web/src/app/(app)/invoices/page.tsx`: Invoices overview page.

---

## 2. API Endpoints & Hooks

### API Client Endpoints (`apps/web/src/lib/api/endpoints.ts`)
- `quotes.list()`: `GET /quotes`
- `quotes.get(id)`: `GET /quotes/:id`
- `quotes.create(payload)`: `POST /quotes`
- `quotes.signal(id, action, payload)`: `POST /quotes/:id/signal`
- `invoices.list()`: `GET /invoices`

### Hooks
- `apps/web/src/hooks/use-quotes.ts`: React custom hook for listing quotes, creating quotes, and signaling workflow actions.
- `apps/web/src/hooks/use-invoices.ts`: React custom hook for listing generated invoices.

---

## 3. UI Component Architecture

### Quotes Components (`apps/web/src/components/quotes/`)
1. **`quote-status-badge.tsx`**:
   - `AWAITING_APPROVAL`: Amber badge with pulsating dot ("Awaiting Approval")
   - `APPROVED`: Green badge ("Approved & Invoiced")
   - `REJECTED`: Red badge ("Rejected")
   - `DRAFT`: Gray badge ("Drafting")
2. **`create-quote-modal.tsx`**:
   - Tab 1: **AI Agent Draft**: Title input + natural language Prompt textarea (e.g., *"Quote for ACME Corp: 50 Pro licenses with 10% discount"*).
   - Tab 2: **Manual Entry**: Title input + dynamic line items array (description, quantity, unit price).
3. **`quote-actions-dialog.tsx`**:
   - Modal/Popover for Human Actions when a quote is in `AWAITING_APPROVAL`:
     - **Approve**: Sends `APPROVE` signal $\rightarrow$ Workflow issues invoice.
     - **Reject**: Sends `REJECT` signal with optional reason.
     - **Override**: Edits line items and sends `OVERRIDE` signal.
4. **`quotes-table.tsx`**:
   - Table displaying Title, Created By (`AI` vs `HUMAN`), Item Count, Total Amount, Workflow Status, Created At, and Action Buttons.

### Invoices Components (`apps/web/src/components/invoices/`)
1. **`invoices-table.tsx`**:
   - Table displaying Invoice #, Quote ID, Amount, Status (`ISSUED`, `PAID`), and Issued Date.

---

## 4. Design & Aesthetics

- Follow existing design system in `apps/web` (Inter typography, CSS variables for theme, glassmorphism headers, dark mode support).
- Smooth micro-animations for status state transitions.
