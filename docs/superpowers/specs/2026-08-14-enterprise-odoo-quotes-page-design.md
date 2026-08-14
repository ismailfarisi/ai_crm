# Enterprise Odoo-Grade Quotation System Design

**Date:** 2026-08-14  
**Status:** Approved  
**Author:** AI Agent (Pair Programming with Ismail Farisi)  

---

## 1. Overview & Objectives

This specification outlines the transformation of the Quotation system in Relay CRM from a basic modal into a full-page, enterprise-ready quotation suite inspired by Odoo ERP. 

### Key Goals:
1. **Full-Page Quotation Studio**: Replace the creation modal with dedicated pages:
   - `/quotes/new` (Creation & Draft Studio)
   - `/quotes/[id]` (Document Viewer, Lifecycle Management, Approvals & Printing)
2. **Odoo-Grade Commercial Features**:
   - **Customer Linkage**: Link quotes to CRM `Customer` records with auto-filled contact email, payment terms, and addresses.
   - **Sequence Numbering**: Tenant-scoped auto-incrementing quote numbers (e.g. `QT-2026-0001`) with manual override.
   - **Polymorphic Order Lines**: Support for **Product Lines**, **Section Headers** (deliverable groups), and **Note Lines** (terms/specs).
   - **Advanced Pricing Engine**: Unit of Measure (UoM), line-level discount percentage, line-level tax percentage, and live multi-tier total calculations (Untaxed Subtotal, Total Discount, Tax Breakdown, Gross Total).
   - **Commercial Metadata**: Validity / expiration date, payment terms (`Immediate`, `Net 15`, `Net 30`, `Net 60`, `End of Month`), and multi-currency support.
   - **Customer Terms & Internal Notes**: Tabbed editor for public customer terms and private sales review notes.
3. **Interactive AI Copilot Drawer**:
   - Slide-over assistant panel to paste unstructured client emails, RFPs, or prompts.
   - Parses and automatically constructs structured sections, line items, pricing, discounts, and terms with 1-click injection into the form.
4. **End-to-End Workflow Orchestration**:
   - Status pipeline ribbon: `Draft` ➔ `Awaiting Approval` ➔ `Approved` ➔ `Invoiced`.
   - Seamless integration with existing Temporal workflow signals (`APPROVE`, `REJECT`, `OVERRIDE`) and invoice generation.

---

## 2. System Architecture & Data Model

### 2.1 Database Schema (`quotes` table)

The `Quote` entity (`apps/api/src/modules/quotes/entities/quote.entity.ts`) will be extended with the following columns:

```typescript
export enum QuoteCreatedBy {
  AI = 'AI',
  HUMAN = 'HUMAN',
}

export enum QuoteStatus {
  DRAFT = 'DRAFT',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export type QuoteLineItemType = 'product' | 'section' | 'note';

export interface QuoteLineItem {
  id: string;
  type: QuoteLineItemType;
  description: string;
  quantity?: number;
  uom?: string; // Units, Hours, Days, Licenses, Months, etc.
  unitPrice?: number;
  discount?: number; // 0 - 100 percentage
  taxRate?: number; // 0, 5, 10, 20 etc. percentage
  subtotal?: number; // line untaxed total after discount
}

@Entity('quotes')
@Index('idx_quotes_tenant_id', ['tenantId'])
@Index('idx_quotes_tenant_number', ['tenantId', 'quoteNumber'])
export class Quote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'quote_number', type: 'varchar', length: 60, nullable: true })
  quoteNumber: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'customer_name', type: 'varchar', length: 255, default: 'General Customer' })
  customerName: string;

  @Column({ name: 'customer_email', type: 'varchar', length: 255, nullable: true })
  customerEmail: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({
    type: 'enum',
    enum: QuoteStatus,
    enumName: 'quotes_status_enum',
    default: QuoteStatus.DRAFT,
  })
  status: QuoteStatus;

  @Column({
    type: 'enum',
    enum: QuoteCreatedBy,
    enumName: 'quotes_created_by_enum',
    default: QuoteCreatedBy.HUMAN,
  })
  createdBy: QuoteCreatedBy;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil: Date | null;

  @Column({ name: 'payment_terms', type: 'varchar', length: 50, default: 'immediate' })
  paymentTerms: string;

  @Column({ type: 'char', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'jsonb', default: [] })
  items: QuoteLineItem[];

  @Column({ name: 'subtotal_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  subtotalAmount: number;

  @Column({ name: 'discount_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ name: 'tax_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'numeric', precision: 12, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ name: 'terms_and_conditions', type: 'text', nullable: true })
  termsAndConditions: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', nullable: true })
  prompt: string | null;

  @Column({ name: 'workflow_id', type: 'varchar', nullable: true })
  workflowId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
```

---

## 3. Calculation & Pricing Rules

For each product item:
```
Line Subtotal = Quantity × UnitPrice × (1 - (Discount / 100))
Line Tax = Line Subtotal × (TaxRate / 100)
Line Total = Line Subtotal + Line Tax
```

Aggregate totals across the quote:
```
Untaxed Subtotal = Sum(Line Subtotal for all 'product' items)
Total Discount Savings = Sum(Quantity × UnitPrice × (Discount / 100) for all 'product' items)
Total Tax Amount = Sum(Line Tax for all 'product' items)
Total Gross Amount = Untaxed Subtotal + Total Tax Amount
```

Section and Note items contribute `$0.00` to totals and are purely for document grouping and narrative structuring.

---

## 4. API Endpoints (`apps/api`)

| Method | Route | Description |
|---|---|---|
| `GET` | `/quotes` | List all quotes for the tenant with customer info and status. |
| `POST` | `/quotes` | Create a new quote with sequential quote numbering, items, and workflow initiation. |
| `GET` | `/quotes/next-number` | Pre-fetches the next sequential quote number (e.g., `QT-2026-0001`). |
| `GET` | `/quotes/:id` | Get detailed quote document by UUID. |
| `PATCH` | `/quotes/:id` | Update an existing quote (draft mode). |
| `POST` | `/quotes/:id/signal` | Trigger Temporal workflow actions (`APPROVE`, `REJECT`, `OVERRIDE`). |

---

## 5. Frontend Architecture (`apps/web`)

### 5.1 Route Structure
* `src/app/(app)/quotes/page.tsx` — Main list view with table, metric cards, and "Create Quote" CTA leading to `/quotes/new`.
* `src/app/(app)/quotes/new/page.tsx` — Full-page quotation builder (`CreateQuotePage`).
* `src/app/(app)/quotes/[id]/page.tsx` — Full-page quotation viewer/editor (`QuoteDetailPage`).

### 5.2 Component Hierarchy
```
src/components/quotes/
├── quotes-view.tsx                 // Overview table + metrics
├── quote-status-badge.tsx          // Colored status badge
├── quote-status-pipeline.tsx       // Odoo-style visual breadcrumb ribbon
├── quote-editor/
│   ├── quote-editor-page.tsx       // Main full-page layout (Header, Form, Sidebar)
│   ├── quote-header-form.tsx       // Title, Customer select, Expiry, Terms, Currency
│   ├── quote-lines-table.tsx       // Polymorphic line items (Product, Section, Note)
│   ├── quote-totals-card.tsx       // Live Subtotal, Discount, Tax, Gross Total
│   ├── quote-tabs-section.tsx      // Terms & Conditions and Internal Notes tabs
│   ├── quote-ai-drawer.tsx         // Slide-over AI copilot assistant
│   └── quote-print-modal.tsx       // Clean printable quote preview & PDF view
```

### 5.3 Customer Linking & Autocomplete
* Connects to `/customers` endpoint.
* Selecting a customer automatically populates:
  - `customerName`
  - `customerEmail`
  - `paymentTerms` (from customer preferences if set)
  - `currency` (from customer currency if set)

### 5.4 AI Copilot Assistant Flow
1. User clicks **"AI Copilot ✨"** to slide open the side-drawer.
2. User enters or pastes free text (e.g. *"Acme Corp needs 50 seats of Enterprise CRM at $80/seat, 20 hrs onboarding at $150/hr, 10% discount on seats, 30 days payment terms, delivery in Sept"*).
3. The AI assistant processes the prompt into structured line items with sections, discounts, and notes.
4. User previews the structured card preview and clicks **"Apply to Quote"**.
5. Form updates seamlessly with all lines, headers, terms, and auto-calculated totals.

---

## 6. Migration Plan

1. Create migration file `1786040000000-AddEnterpriseQuoteFields.ts` adding new columns and indices to `quotes` table.
2. Ensure backward compatibility with existing seeded quotes by backfilling default quote numbers (`QT-2026-0001`, etc.) and zeroed aggregate amounts.

---

## 7. Testing & Verification

* **Unit / Service Tests**:
  * Sequence generation (`QT-YYYY-0001`).
  * Calculation engine matches line item math for zero tax, custom tax, and discounts.
* **UI / End-to-End Verification**:
  * Navigate to `/quotes` ➔ Click "Create Quote" ➔ Redirects to `/quotes/new`.
  * Select customer, add product lines, sections, and notes.
  * Check live calculations (Subtotal, Discount, Taxes, Total).
  * Save draft ➔ Appears on `/quotes` list with formatted quote number.
  * Open quote ➔ View in `/quotes/[id]` with status pipeline.
  * Submit for approval ➔ Approve/Reject workflow validation.
  * AI Copilot drawer test ➔ Paste prompt and verify 1-click apply.
