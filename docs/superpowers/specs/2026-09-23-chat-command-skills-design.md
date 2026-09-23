# Chat Command Skills Design: `delivery.dispatch` & `sales_order.from_document`

**Date:** 2026-09-23  
**Status:** Approved  
**Scope:** Implementing the two missing conversational command skills identified in `docs/FLAGS.md`: `delivery.dispatch` and `sales_order.from_document`.

---

## 1. Overview & Business Goal

Relay CRM's conversational command layer lets internal staff execute operations over messaging channels (WhatsApp, Telegram, Email) using natural language. While `quote.approve`, `purchase_order.create`, and `work_order.log_time` are in production, two planned skills remained unbuilt:
1. **`delivery.dispatch`**: Dispatching warehouse stock against delivery notes or directly fulfilling open sales orders.
2. **`sales_order.from_document`**: Ingesting incoming customer purchase orders (referenced or unstructured) and converting them into confirmed sales orders.

Both skills adhere strictly to Relay's architecture:
- Model output is never trusted directly; extraction maps into typed Zod schemas.
- RBAC permissions gate skills before the router even sees them.
- All state-changing actions generate a human-readable preview requiring explicit affirmative confirmation (`YES`) before executing domain services.
- Every action is audited with prompt version and model name.

---

## 2. Shared Contracts & Types

In `packages/shared/src/channels/skills.ts`:

```typescript
export const CHANNEL_SKILLS = {
  QUOTE_APPROVE: 'quote.approve',
  PURCHASE_ORDER_CREATE: 'purchase_order.create',
  WORK_ORDER_LOG_TIME: 'work_order.log_time',
  DELIVERY_DISPATCH: 'delivery.dispatch',
  SALES_ORDER_FROM_DOCUMENT: 'sales_order.from_document',
} as const;

export type ChannelSkillName = (typeof CHANNEL_SKILLS)[keyof typeof CHANNEL_SKILLS];

export type ChannelResultType =
  | 'QUOTE'
  | 'INVOICE'
  | 'PURCHASE_ORDER'
  | 'WORK_ORDER'
  | 'DELIVERY_NOTE'
  | 'SALES_ORDER';
```

---

## 3. Skill Specification: `delivery.dispatch`

- **File:** `apps/api/src/modules/channels/skills/delivery-dispatch.skill.ts`
- **Skill Name:** `CHANNEL_SKILLS.DELIVERY_DISPATCH` (`"delivery.dispatch"`)
- **Required Permissions:**
  - `PERMISSIONS.DELIVERY_NOTE_DISPATCH` (`delivery_note:dispatch`)
  - `PERMISSIONS.DELIVERY_NOTE_CREATE` (`delivery_note:create`) if creating from order
- **Prompt Version:** `'delivery-dispatch/1'`

### Extraction Contract
```typescript
const slotSchema = z.object({
  deliveryNoteNumber: z.string().optional(),
  salesOrderNumber: z.string().optional(),
  customerName: z.string().optional(),
});
```

### Resolution Logic (`resolve`)
1. **Direct DN Match**:
   - Matches `DN-\d{4}-\d+` or `slots.deliveryNoteNumber`.
   - Fetches `DeliveryNote`. Validates status is `DRAFT`.
   - Refuses if already dispatched or cancelled.
   - Resolves lines and sets `mode: 'EXISTING_NOTE'`.
2. **Sales Order Match**:
   - Matches `SO-\d{4}-\d+` or `slots.salesOrderNumber` or `customerName`.
   - Fetches `SalesOrder` and line items.
   - Validates status is `OPEN` or `IN_PRODUCTION`.
   - Uses `remainingToDeliver()` to verify remaining unfulfilled quantities.
   - Refuses if order is fully fulfilled or closed.
   - Prepares lines for unfulfilled items and sets `mode: 'FROM_ORDER'`.
3. **Clarification**:
   - If neither is identified or multiple open orders exist, returns `kind: 'question'` asking for the DN number or SO number.

### Preview & Confirmation
- Previews the order/DN number, customer name, items and quantities to be dispatched, and notes that stock will be issued from inventory where tracked.
- Awaits affirmative response (`YES`/`confirm`).

### Execution (`execute`)
- If `mode === 'FROM_ORDER'`: Calls `DeliveryNotesService.create()`, followed by `DeliveryNotesService.dispatch()`.
- If `mode === 'EXISTING_NOTE'`: Calls `DeliveryNotesService.dispatch()`.
- Returns `SkillOutcome` with `resultType: 'DELIVERY_NOTE'` and resulting delivery note ID.

---

## 4. Skill Specification: `sales_order.from_document`

- **File:** `apps/api/src/modules/channels/skills/sales-order-from-document.skill.ts`
- **Skill Name:** `CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT` (`"sales_order.from_document"`)
- **Required Permissions:**
  - `PERMISSIONS.SALES_ORDER_UPDATE` (`sales_order:update`)
  - `PERMISSIONS.QUOTE_CREATE` (`quote:create`) and `PERMISSIONS.QUOTE_APPROVE` (`quote:approve`)
- **Prompt Version:** `'so-from-doc/1'`

### Extraction Contract
```typescript
const slotSchema = z.object({
  customerPoNumber: z.string().optional(),
  quoteNumber: z.string().optional(),
  customerName: z.string().optional(),
  description: z.string().optional(),
  totalAmount: z.number().positive().optional(),
});
```

### Resolution Logic (`resolve`)
1. **PO & Quote Reference Extraction**:
   - Scans text for customer PO reference (`PO-\w+`, `PO #\w+`) and quote number (`QT-\d{4}-\d+`).
2. **Path A — Matched Open Quote**:
   - If quote number is present or matches an open quote (`DRAFT` / `AWAITING_APPROVAL`) for the specified customer:
   - Verifies the quote has not already become a sales order.
   - Sets `mode: 'MATCHED_QUOTE'`.
3. **Path B — New Order / Direct PO**:
   - If customer provided order items without an existing quote:
   - Stages a draft quote via `QuotesService.createQuote()`, storing the customer PO reference in notes.
   - Sets `mode: 'NEW_QUOTE'`.
4. **Clarification**:
   - If no customer or quote reference can be determined, returns `kind: 'question'` prompting for details.

### Preview & Confirmation
- Displays customer name, customer PO number, referenced quote number, total amount, and line count.
- Awaits affirmative response (`YES`/`confirm`).

### Execution (`execute`)
- Approves the quote via `QuotesService.sendSignal(tenantId, quoteId, 'APPROVE')`.
- This triggers `provisionOrderForQuote()` to atomically create the `SalesOrder`.
- Returns `SkillOutcome` with `resultType: 'SALES_ORDER'` and resulting sales order ID.

---

## 5. Wiring, Evals & Test Strategy

1. **Registry & Dependency Injection**:
   - `ChannelsModule` imports `OrdersModule`.
   - `SkillRegistry` injects `DeliveryNotesService` and registers instances of `DeliveryDispatchSkill` and `SalesOrderFromDocumentSkill`.
2. **Unit Tests**:
   - `delivery-dispatch.skill.spec.ts`: Covers existing DN dispatch, SO direct shipping, out-of-stock/fulfilled checks, preview, and execution.
   - `sales-order-from-document.skill.spec.ts`: Covers matching existing quotes, staging new quotes from POs, preview, and execution.
3. **Evals**:
   - Positive and negative cases added to `apps/api/src/modules/channels/evals/fixtures/routing.cases.ts`.
   - `refusal.eval.spec.ts` verifies permission gating for callers lacking `delivery_note:dispatch` or `sales_order:update`.
