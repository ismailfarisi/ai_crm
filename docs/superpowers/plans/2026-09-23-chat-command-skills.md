# Chat Command Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the two missing chat command skills (`delivery.dispatch` and `sales_order.from_document`) with full RBAC gating, conversational slot extraction, human preview confirmation, domain execution, and eval coverage.

**Architecture:** Extend `@saas/shared` with new skill names and result types. Implement `DeliveryDispatchSkill` (supporting both draft DN dispatch and direct SO fulfillment) and `SalesOrderFromDocumentSkill` (supporting quote matching and new order staging). Wire both into `SkillRegistry` and update the test/eval fixtures.

**Tech Stack:** TypeScript, NestJS, TypeORM, Zod, Jest, Vitest, pnpm workspace.

## Global Constraints

- Permissions live in `packages/shared/src/rbac/permissions/` and nowhere else. Never hand-write permission strings at call sites.
- `@saas/shared` is compiled, not source-linked: run `pnpm --filter @saas/shared build` after editing it before other packages can consume changes.
- Never trust model output directly: parse through Zod schemas before handing data to services.
- Never compute prices in skills: pricing derives strictly from catalog and quote services.
- Every state mutation requires an affirmative user confirmation (`YES`/`confirm`) following a human-readable preview.

---

### Task 1: Update Shared Vocabulary in `@saas/shared`

**Files:**
- Modify: `packages/shared/src/channels/skills.ts`
- Test: `packages/shared/src/channels/skills.test.ts` (or `test` script in packages/shared)

**Interfaces:**
- Produces:
  - `CHANNEL_SKILLS.DELIVERY_DISPATCH = 'delivery.dispatch'`
  - `CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT = 'sales_order.from_document'`
  - `ChannelResultType` including `'DELIVERY_NOTE' | 'SALES_ORDER'`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/channels/skills.spec.ts`:
```typescript
import { CHANNEL_SKILLS, type ChannelResultType } from './skills';

describe('CHANNEL_SKILLS', () => {
  it('defines delivery.dispatch and sales_order.from_document', () => {
    expect(CHANNEL_SKILLS.DELIVERY_DISPATCH).toBe('delivery.dispatch');
    expect(CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT).toBe('sales_order.from_document');
  });

  it('supports DELIVERY_NOTE and SALES_ORDER result types', () => {
    const dnType: ChannelResultType = 'DELIVERY_NOTE';
    const soType: ChannelResultType = 'SALES_ORDER';
    expect(dnType).toBe('DELIVERY_NOTE');
    expect(soType).toBe('SALES_ORDER');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test skills.spec.ts`
Expected: FAIL with TypeScript/compilation or assertion errors indicating missing properties on `CHANNEL_SKILLS`.

- [ ] **Step 3: Update `packages/shared/src/channels/skills.ts`**

Update `packages/shared/src/channels/skills.ts`:
```typescript
export type ChannelResultType =
  | 'QUOTE'
  | 'INVOICE'
  | 'PURCHASE_ORDER'
  | 'WORK_ORDER'
  | 'DELIVERY_NOTE'
  | 'SALES_ORDER';

export const CHANNEL_SKILLS = {
  QUOTE_APPROVE: 'quote.approve',
  PURCHASE_ORDER_CREATE: 'purchase_order.create',
  WORK_ORDER_LOG_TIME: 'work_order.log_time',
  DELIVERY_DISPATCH: 'delivery.dispatch',
  SALES_ORDER_FROM_DOCUMENT: 'sales_order.from_document',
} as const;
```

- [ ] **Step 4: Build shared package and run tests**

Run: `pnpm --filter @saas/shared build && pnpm --filter @saas/shared test`
Expected: PASS (all shared tests pass and `dist/` is updated).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/channels/skills.ts packages/shared/src/channels/skills.spec.ts
git commit -m "feat(shared): add delivery.dispatch and sales_order.from_document to channel skills"
```

---

### Task 2: Implement `delivery.dispatch` Skill

**Files:**
- Create: `apps/api/src/modules/channels/skills/delivery-dispatch.skill.ts`
- Test: `apps/api/src/modules/channels/skills/delivery-dispatch.skill.spec.ts`

**Interfaces:**
- Consumes:
  - `DeliveryNotesService.listForOrder(tenantId, orderId)`
  - `DeliveryNotesService.get(tenantId, id)`
  - `DeliveryNotesService.create(tenantId, actorId, salesOrderId, input)`
  - `DeliveryNotesService.dispatch(tenantId, id, actorId)`
  - `OrdersService.list(tenantId, filter)`
  - `OrdersService.get(tenantId, id)`
- Produces:
  - `DeliveryDispatchSkill` implementing `ChannelSkill<ResolvedDeliveryDispatch>`

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/modules/channels/skills/delivery-dispatch.skill.spec.ts`:
```typescript
import { PERMISSIONS } from '@saas/shared';
import { DeliveryDispatchSkill } from './delivery-dispatch.skill';
import type { DeliveryNotesService } from '../../orders/delivery-notes.service';
import type { OrdersService } from '../../orders/orders.service';
import type { SkillContext } from './skill.types';

describe('DeliveryDispatchSkill', () => {
  let deliveryNotesService: jest.Mocked<Partial<DeliveryNotesService>>;
  let ordersService: jest.Mocked<Partial<OrdersService>>;
  let skill: DeliveryDispatchSkill;

  const ctx: SkillContext = {
    organizationId: 'org-1',
    userId: 'user-1',
    provider: 'META_WHATSAPP',
    senderIdentifier: '+1234567890',
    permissions: [PERMISSIONS.DELIVERY_NOTE_DISPATCH, PERMISSIONS.DELIVERY_NOTE_CREATE],
    message: 'dispatch DN-2026-0001',
  };

  beforeEach(() => {
    deliveryNotesService = {
      get: jest.fn(),
      listForOrder: jest.fn(),
      create: jest.fn(),
      dispatch: jest.fn(),
    };
    ordersService = {
      list: jest.fn(),
      get: jest.fn(),
    };
    skill = new DeliveryDispatchSkill(
      deliveryNotesService as unknown as DeliveryNotesService,
      ordersService as unknown as OrdersService,
    );
  });

  it('resolves an existing draft delivery note by number', async () => {
    deliveryNotesService.get = jest.fn().mockResolvedValue({
      id: 'dn-1',
      deliveryNoteNumber: 'DN-2026-0001',
      status: 'DRAFT',
      salesOrderId: 'so-1',
      customerName: 'Acme Corp',
      lines: [{ salesOrderLineId: 'sol-1', description: '350gsm board', qty: 100, uom: 'pcs' }],
    });

    const res = await skill.resolve({ deliveryNoteNumber: 'DN-2026-0001' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.mode).toBe('EXISTING_NOTE');
      expect(res.value.deliveryNoteNumber).toBe('DN-2026-0001');
      expect(res.value.customerName).toBe('Acme Corp');
    }
  });

  it('refuses if the delivery note is already dispatched', async () => {
    deliveryNotesService.get = jest.fn().mockResolvedValue({
      id: 'dn-1',
      deliveryNoteNumber: 'DN-2026-0001',
      status: 'DISPATCHED',
      salesOrderId: 'so-1',
      customerName: 'Acme Corp',
      lines: [],
    });

    const res = await skill.resolve({ deliveryNoteNumber: 'DN-2026-0001' }, ctx);
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain('already dispatched');
    }
  });

  it('resolves directly from a sales order with open quantities', async () => {
    ordersService.list = jest.fn().mockResolvedValue([
      {
        id: 'so-1',
        orderNumber: 'SO-2026-0005',
        status: 'OPEN',
        customerName: 'Starlight Corp',
        lines: [{ id: 'sol-1', description: 'Brochures', qtyOrdered: 50, qtyFulfilled: 0, uom: 'pcs' }],
      },
    ]);
    ordersService.get = jest.fn().mockResolvedValue({
      id: 'so-1',
      orderNumber: 'SO-2026-0005',
      status: 'OPEN',
      customerName: 'Starlight Corp',
      lines: [{ id: 'sol-1', description: 'Brochures', qtyOrdered: 50, qtyFulfilled: 0, uom: 'pcs' }],
    });
    deliveryNotesService.listForOrder = jest.fn().mockResolvedValue([]);

    const res = await skill.resolve({ salesOrderNumber: 'SO-2026-0005' }, { ...ctx, message: 'ship order SO-2026-0005' });
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.mode).toBe('FROM_ORDER');
      expect(res.value.salesOrderNumber).toBe('SO-2026-0005');
      expect(res.value.lines).toHaveLength(1);
    }
  });

  it('generates a clear confirmation preview and executes dispatch', async () => {
    const resolved = {
      mode: 'EXISTING_NOTE' as const,
      deliveryNoteId: 'dn-1',
      deliveryNoteNumber: 'DN-2026-0001',
      salesOrderId: 'so-1',
      salesOrderNumber: 'SO-2026-0005',
      customerName: 'Acme Corp',
      lines: [{ salesOrderLineId: 'sol-1', description: '350gsm board', qty: 100, uom: 'pcs', hasStockMaterial: true }],
    };

    const preview = await skill.preview(resolved, ctx);
    expect(preview).toContain('DN-2026-0001');
    expect(preview).toContain('YES');

    deliveryNotesService.dispatch = jest.fn().mockResolvedValue({
      id: 'dn-1',
      deliveryNoteNumber: 'DN-2026-0001',
      status: 'DISPATCHED',
    } as any);

    const outcome = await skill.execute(resolved, ctx);
    expect(outcome.resultType).toBe('DELIVERY_NOTE');
    expect(outcome.resultId).toBe('dn-1');
    expect(deliveryNotesService.dispatch).toHaveBeenCalledWith('org-1', 'dn-1', 'user-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test delivery-dispatch.skill.spec.ts`
Expected: FAIL with "Cannot find module './delivery-dispatch.skill'".

- [ ] **Step 3: Implement `DeliveryDispatchSkill`**

Create `apps/api/src/modules/channels/skills/delivery-dispatch.skill.ts`:
```typescript
import { z } from 'zod';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  remainingToDeliver,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import { DeliveryNotesService } from '../../orders/delivery-notes.service';
import { OrdersService } from '../../orders/orders.service';
import type { ChannelSkill, SkillContext } from './skill.types';

const DN_NUMBER_PATTERN = /DN-\d{4}-\d+/i;
const SO_NUMBER_PATTERN = /SO-\d{4}-\d+/i;

const slotSchema = z.object({
  deliveryNoteNumber: z.string().optional(),
  salesOrderNumber: z.string().optional(),
  customerName: z.string().optional(),
});

export interface ResolvedDeliveryDispatch {
  mode: 'EXISTING_NOTE' | 'FROM_ORDER';
  deliveryNoteId?: string;
  deliveryNoteNumber?: string;
  salesOrderId: string;
  salesOrderNumber: string;
  customerName: string;
  lines: {
    salesOrderLineId: string;
    description: string;
    qty: number;
    uom: string;
    hasStockMaterial: boolean;
  }[];
}

const jsonSchema = {
  type: 'object',
  properties: {
    deliveryNoteNumber: {
      type: 'string',
      description: 'The delivery note number mentioned, e.g. "DN-2026-0001", if any.',
    },
    salesOrderNumber: {
      type: 'string',
      description: 'The sales order number mentioned, e.g. "SO-2026-0005", if any.',
    },
    customerName: {
      type: 'string',
      description: 'The customer or company name mentioned, if any.',
    },
  },
  additionalProperties: false,
} as const;

export class DeliveryDispatchSkill implements ChannelSkill<ResolvedDeliveryDispatch> {
  readonly name = CHANNEL_SKILLS.DELIVERY_DISPATCH;
  readonly description =
    'Dispatch a delivery note or ship remaining items on a sales order, taking stocked goods off the shelf and recording what shipped.';
  readonly examples = [
    'dispatch DN-2026-0001',
    'ship delivery note 0002',
    'ship the remaining items on SO-2026-0005',
    'dispatch order SO-2026-0003 for Acme',
  ];
  readonly requiredPermissions = [PERMISSIONS.DELIVERY_NOTE_DISPATCH];
  readonly jsonSchema = jsonSchema as unknown as Record<string, unknown>;
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'delivery-dispatch/1';

  constructor(
    private readonly deliveryNotes: DeliveryNotesService,
    private readonly orders: OrdersService,
  ) {}

  async resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedDeliveryDispatch>> {
    const parsed = slotSchema.safeParse(slots);
    if (!parsed.success) {
      return { kind: 'refused', reason: 'I could not make sense of that delivery request.' };
    }
    const data = parsed.data;

    const dnMatch =
      DN_NUMBER_PATTERN.exec(ctx.message) ??
      (data.deliveryNoteNumber ? DN_NUMBER_PATTERN.exec(data.deliveryNoteNumber) : null);

    if (dnMatch) {
      const dnNumber = dnMatch[0].toUpperCase();
      try {
        const allOrders = await this.orders.list(ctx.organizationId);
        let foundNote: any = null;
        for (const o of allOrders) {
          const notes = await this.deliveryNotes.listForOrder(ctx.organizationId, o.id);
          const match = notes.find((n) => n.deliveryNoteNumber.toUpperCase() === dnNumber);
          if (match) {
            foundNote = await this.deliveryNotes.get(ctx.organizationId, match.id);
            break;
          }
        }

        if (!foundNote) {
          return { kind: 'refused', reason: `I couldn't find delivery note ${dnNumber}.` };
        }
        if (foundNote.status !== 'DRAFT') {
          return {
            kind: 'refused',
            reason: `Delivery note ${foundNote.deliveryNoteNumber} is already ${foundNote.status.toLowerCase()} — nothing to dispatch.`,
          };
        }

        const order = await this.orders.get(ctx.organizationId, foundNote.salesOrderId);
        return {
          kind: 'resolved',
          value: {
            mode: 'EXISTING_NOTE',
            deliveryNoteId: foundNote.id,
            deliveryNoteNumber: foundNote.deliveryNoteNumber,
            salesOrderId: order.id,
            salesOrderNumber: order.orderNumber,
            customerName: foundNote.customerName || order.customerName,
            lines: (foundNote.lines || []).map((l: any) => ({
              salesOrderLineId: l.salesOrderLineId,
              description: l.description,
              qty: l.qty,
              uom: l.uom || 'units',
              hasStockMaterial: Boolean(l.stockMaterialId),
            })),
          },
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { kind: 'refused', reason: `Could not load delivery note: ${msg}` };
      }
    }

    const soMatch =
      SO_NUMBER_PATTERN.exec(ctx.message) ??
      (data.salesOrderNumber ? SO_NUMBER_PATTERN.exec(data.salesOrderNumber) : null);

    const allOrders = await this.orders.list(ctx.organizationId);
    let targetOrder = soMatch
      ? allOrders.find((o) => o.orderNumber.toUpperCase() === soMatch[0].toUpperCase())
      : null;

    if (!targetOrder && data.customerName) {
      const candidates = allOrders.filter((o) =>
        o.customerName.toLowerCase().includes(data.customerName!.toLowerCase()),
      );
      if (candidates.length === 1) targetOrder = candidates[0];
      else if (candidates.length > 1) {
        return {
          kind: 'question',
          question: `Found several open orders for "${data.customerName}": ${candidates
            .map((c) => c.orderNumber)
            .join(', ')}. Which one do you want to dispatch?`,
          slots,
        };
      }
    }

    if (!targetOrder) {
      return {
        kind: 'question',
        question:
          'Which delivery or order? Provide a delivery note number (e.g. "DN-2026-0001") or a sales order (e.g. "SO-2026-0005").',
        slots,
      };
    }

    const fullOrder = await this.orders.get(ctx.organizationId, targetOrder.id);
    if (fullOrder.status === 'CANCELLED' || fullOrder.status === 'CLOSED' || fullOrder.status === 'FULFILLED') {
      return {
        kind: 'refused',
        reason: `Sales order ${fullOrder.orderNumber} is already ${fullOrder.status.toLowerCase()} — cannot dispatch.`,
      };
    }

    const existingNotes = await this.deliveryNotes.listForOrder(ctx.organizationId, fullOrder.id);
    const drafts = existingNotes.filter((n) => n.status === 'DRAFT');
    const draftQuantities = new Map<string, number>();
    for (const d of drafts) {
      for (const line of d.lines || []) {
        draftQuantities.set(line.salesOrderLineId, (draftQuantities.get(line.salesOrderLineId) ?? 0) + line.qty);
      }
    }

    const openLines: ResolvedDeliveryDispatch['lines'] = [];
    for (const line of fullOrder.lines || []) {
      const remaining = remainingToDeliver({
        qtyOrdered: line.qtyOrdered,
        qtyFulfilled: line.qtyFulfilled,
        qtyInDraft: draftQuantities.get(line.id) ?? 0,
      });
      if (remaining > 0) {
        openLines.push({
          salesOrderLineId: line.id,
          description: line.description,
          qty: remaining,
          uom: line.uom || 'units',
          hasStockMaterial: Boolean(line.catalogItemId),
        });
      }
    }

    if (openLines.length === 0) {
      return {
        kind: 'refused',
        reason: `All lines on order ${fullOrder.orderNumber} have already been fulfilled or drafted on open deliveries.`,
      };
    }

    return {
      kind: 'resolved',
      value: {
        mode: 'FROM_ORDER',
        salesOrderId: fullOrder.id,
        salesOrderNumber: fullOrder.orderNumber,
        customerName: fullOrder.customerName,
        lines: openLines,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async preview(resolved: ResolvedDeliveryDispatch, _ctx: SkillContext): Promise<string> {
    const linesSummary = resolved.lines.map((l) => `- ${l.qty}x ${l.description}`).join('\n');
    const modeDesc =
      resolved.mode === 'EXISTING_NOTE'
        ? `Dispatch delivery note ${resolved.deliveryNoteNumber} for order ${resolved.salesOrderNumber} (${resolved.customerName})?`
        : `Create and dispatch delivery note for order ${resolved.salesOrderNumber} (${resolved.customerName})?`;

    return (
      `${modeDesc}\n\n` +
      `Items to ship:\n${linesSummary}\n\n` +
      `Tracked stock items will be issued from inventory.\n\n` +
      `Reply YES to confirm or NO to cancel.`
    );
  }

  async execute(resolved: ResolvedDeliveryDispatch, ctx: SkillContext): Promise<SkillOutcome> {
    let noteId = resolved.deliveryNoteId;
    let noteNumber = resolved.deliveryNoteNumber;

    if (resolved.mode === 'FROM_ORDER') {
      const created = await this.deliveryNotes.create(ctx.organizationId, ctx.userId, resolved.salesOrderId, {
        lines: resolved.lines.map((l) => ({
          salesOrderLineId: l.salesOrderLineId,
          qty: l.qty,
        })),
      });
      noteId = created.id;
      noteNumber = created.deliveryNoteNumber;
    }

    const dispatched = await this.deliveryNotes.dispatch(ctx.organizationId, noteId!, ctx.userId);
    const totalUnits = resolved.lines.reduce((sum, l) => sum + l.qty, 0);

    return {
      reply: `Dispatched delivery note ${dispatched.deliveryNoteNumber || noteNumber} for ${resolved.customerName} (${totalUnits} items).`,
      resultType: 'DELIVERY_NOTE',
      resultId: noteId,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test delivery-dispatch.skill.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/channels/skills/delivery-dispatch.skill.ts apps/api/src/modules/channels/skills/delivery-dispatch.skill.spec.ts
git commit -m "feat(channels): implement delivery.dispatch skill"
```

---

### Task 3: Implement `sales_order.from_document` Skill

**Files:**
- Create: `apps/api/src/modules/channels/skills/sales-order-from-document.skill.ts`
- Test: `apps/api/src/modules/channels/skills/sales-order-from-document.skill.spec.ts`

**Interfaces:**
- Consumes:
  - `QuotesService.findAllQuotes(tenantId)`
  - `QuotesService.findQuoteById(tenantId, id)`
  - `QuotesService.createQuote(tenantId, payload)`
  - `QuotesService.sendSignal(tenantId, quoteId, 'APPROVE')`
  - `OrdersService.findByQuote(tenantId, quoteId)`
- Produces:
  - `SalesOrderFromDocumentSkill` implementing `ChannelSkill<ResolvedSalesOrderFromDocument>`

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/modules/channels/skills/sales-order-from-document.skill.spec.ts`:
```typescript
import { PERMISSIONS } from '@saas/shared';
import { SalesOrderFromDocumentSkill } from './sales-order-from-document.skill';
import type { QuotesService } from '../../quotes/quotes.service';
import type { OrdersService } from '../../orders/orders.service';
import type { SkillContext } from './skill.types';

describe('SalesOrderFromDocumentSkill', () => {
  let quotesService: jest.Mocked<Partial<QuotesService>>;
  let ordersService: jest.Mocked<Partial<OrdersService>>;
  let skill: SalesOrderFromDocumentSkill;

  const ctx: SkillContext = {
    organizationId: 'org-1',
    userId: 'user-1',
    provider: 'EMAIL_RESEND',
    senderIdentifier: 'buyer@acme.com',
    permissions: [PERMISSIONS.SALES_ORDER_UPDATE, PERMISSIONS.QUOTE_CREATE, PERMISSIONS.QUOTE_APPROVE],
    message: 'Customer sent PO-9912 accepting quote QT-2026-0004',
  };

  beforeEach(() => {
    quotesService = {
      findAllQuotes: jest.fn(),
      findQuoteById: jest.fn(),
      createQuote: jest.fn(),
      sendSignal: jest.fn(),
    };
    ordersService = {
      findByQuote: jest.fn(),
    };
    skill = new SalesOrderFromDocumentSkill(
      quotesService as unknown as QuotesService,
      ordersService as unknown as OrdersService,
    );
  });

  it('matches an existing open quote referenced in PO text', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([
      {
        id: 'q-1',
        quoteNumber: 'QT-2026-0004',
        status: 'DRAFT',
        customerName: 'Acme Corp',
        totalAmount: 3500,
        currency: 'USD',
        items: [{ id: 'item-1', description: 'Packaging', quantity: 500, unitPrice: 7 }],
      },
    ]);
    ordersService.findByQuote = jest.fn().mockResolvedValue(null);

    const res = await skill.resolve({ quoteNumber: 'QT-2026-0004', customerPoNumber: 'PO-9912' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.mode).toBe('MATCHED_QUOTE');
      expect(res.value.quoteNumber).toBe('QT-2026-0004');
      expect(res.value.customerPoNumber).toBe('PO-9912');
      expect(res.value.totalAmount).toBe(3500);
    }
  });

  it('refuses if the quote already has an active sales order', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([
      {
        id: 'q-1',
        quoteNumber: 'QT-2026-0004',
        status: 'APPROVED',
        customerName: 'Acme Corp',
      },
    ]);
    ordersService.findByQuote = jest.fn().mockResolvedValue({ id: 'so-1', orderNumber: 'SO-2026-0001' } as any);

    const res = await skill.resolve({ quoteNumber: 'QT-2026-0004', customerPoNumber: 'PO-9912' }, ctx);
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain('already has Sales Order');
    }
  });

  it('stages a new draft quote when customer sends PO without existing quote', async () => {
    quotesService.findAllQuotes = jest.fn().mockResolvedValue([]);
    quotesService.createQuote = jest.fn().mockResolvedValue({
      id: 'q-2',
      quoteNumber: 'QT-2026-0010',
      status: 'DRAFT',
      customerName: 'Brightline Ltd',
      totalAmount: 1200,
      currency: 'USD',
      items: [{ id: 'item-2', description: '100x Custom Folders', quantity: 100, unitPrice: 12 }],
    } as any);
    ordersService.findByQuote = jest.fn().mockResolvedValue(null);

    const res = await skill.resolve(
      { customerName: 'Brightline Ltd', customerPoNumber: 'PO-5501', description: '100 custom folders' },
      { ...ctx, message: 'PO-5501 from Brightline Ltd for 100 custom folders' },
    );

    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.mode).toBe('NEW_QUOTE');
      expect(res.value.customerName).toBe('Brightline Ltd');
      expect(res.value.customerPoNumber).toBe('PO-5501');
    }
  });

  it('generates confirmation preview and provisions sales order upon approval', async () => {
    const resolved = {
      mode: 'MATCHED_QUOTE' as const,
      quoteId: 'q-1',
      quoteNumber: 'QT-2026-0004',
      customerPoNumber: 'PO-9912',
      customerName: 'Acme Corp',
      totalAmount: 3500,
      currency: 'USD',
      itemsCount: 1,
    };

    const preview = await skill.preview(resolved, ctx);
    expect(preview).toContain('PO-9912');
    expect(preview).toContain('QT-2026-0004');
    expect(preview).toContain('YES');

    quotesService.sendSignal = jest.fn().mockResolvedValue({ id: 'q-1', quoteNumber: 'QT-2026-0004' } as any);
    ordersService.findByQuote = jest.fn().mockResolvedValue({ id: 'so-1', orderNumber: 'SO-2026-0009' } as any);

    const outcome = await skill.execute(resolved, ctx);
    expect(outcome.resultType).toBe('SALES_ORDER');
    expect(outcome.resultId).toBe('so-1');
    expect(quotesService.sendSignal).toHaveBeenCalledWith('org-1', 'q-1', 'APPROVE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test sales-order-from-document.skill.spec.ts`
Expected: FAIL with "Cannot find module './sales-order-from-document.skill'".

- [ ] **Step 3: Implement `SalesOrderFromDocumentSkill`**

Create `apps/api/src/modules/channels/skills/sales-order-from-document.skill.ts`:
```typescript
import { z } from 'zod';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import { QuotesService } from '../../quotes/quotes.service';
import { OrdersService } from '../../orders/orders.service';
import { QuoteStatus } from '../../quotes/entities/quote.entity';
import type { ChannelSkill, SkillContext } from './skill.types';

const QUOTE_NUMBER_PATTERN = /QT-\d{4}-\d+/i;
const PO_NUMBER_PATTERN = /\b(?:PO|P\.O\.|PURCHASE\s*ORDER)[-\s#:]*([A-Z0-9_-]+)/i;

const slotSchema = z.object({
  customerPoNumber: z.string().optional(),
  quoteNumber: z.string().optional(),
  customerName: z.string().optional(),
  description: z.string().optional(),
  totalAmount: z.number().positive().optional(),
});

export interface ResolvedSalesOrderFromDocument {
  mode: 'MATCHED_QUOTE' | 'NEW_QUOTE';
  quoteId: string;
  quoteNumber: string;
  customerPoNumber: string;
  customerName: string;
  totalAmount: number;
  currency: string;
  itemsCount: number;
}

const jsonSchema = {
  type: 'object',
  properties: {
    customerPoNumber: {
      type: 'string',
      description: 'The customer purchase order reference, e.g. "PO-9912" or "PO#1234", if any.',
    },
    quoteNumber: {
      type: 'string',
      description: 'The internal quote number referenced, e.g. "QT-2026-0004", if any.',
    },
    customerName: {
      type: 'string',
      description: 'The customer or company name placing the purchase order.',
    },
    description: {
      type: 'string',
      description: 'Brief description of what was ordered if this is a new purchase order without a prior quote.',
    },
    totalAmount: {
      type: 'number',
      description: 'The total value stated in the purchase order, if any.',
    },
  },
  additionalProperties: false,
} as const;

export class SalesOrderFromDocumentSkill implements ChannelSkill<ResolvedSalesOrderFromDocument> {
  readonly name = CHANNEL_SKILLS.SALES_ORDER_FROM_DOCUMENT;
  readonly description =
    'Convert a customer purchase order document or message into a confirmed sales order, matching an existing open quote or provisioning a new order.';
  readonly examples = [
    'customer sent PO-9912 for quote QT-2026-0004',
    'create sales order from customer PO-4551 for Acme Corp: 500 units of custom boxes',
    'customer PO-1029 approving our quote QT-2026-0010',
    'turn customer PO-8831 into an order',
  ];
  readonly requiredPermissions = [PERMISSIONS.SALES_ORDER_UPDATE];
  readonly jsonSchema = jsonSchema as unknown as Record<string, unknown>;
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'so-from-doc/1';

  constructor(
    private readonly quotes: QuotesService,
    private readonly orders: OrdersService,
  ) {}

  async resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedSalesOrderFromDocument>> {
    const parsed = slotSchema.safeParse(slots);
    if (!parsed.success) {
      return { kind: 'refused', reason: 'I could not make sense of the purchase order.' };
    }
    const data = parsed.data;

    const poMatch =
      PO_NUMBER_PATTERN.exec(ctx.message) ??
      (data.customerPoNumber ? PO_NUMBER_PATTERN.exec(data.customerPoNumber) : null);
    const customerPo = poMatch ? poMatch[0].trim() : (data.customerPoNumber || 'Customer-PO');

    const quoteMatch =
      QUOTE_NUMBER_PATTERN.exec(ctx.message) ??
      (data.quoteNumber ? QUOTE_NUMBER_PATTERN.exec(data.quoteNumber) : null);

    const allQuotes = await this.quotes.findAllQuotes(ctx.organizationId);

    if (quoteMatch) {
      const qNum = quoteMatch[0].toUpperCase();
      const quote = allQuotes.find((q) => q.quoteNumber?.toUpperCase() === qNum);
      if (!quote) {
        return { kind: 'refused', reason: `I couldn't find quote ${qNum}.` };
      }
      return this.resolveExistingQuote(quote, customerPo, ctx);
    }

    if (data.customerName) {
      const openQuotes = allQuotes.filter(
        (q) =>
          (q.status === QuoteStatus.DRAFT || q.status === QuoteStatus.AWAITING_APPROVAL) &&
          q.customerName?.toLowerCase().includes(data.customerName!.toLowerCase()),
      );

      if (openQuotes.length === 1) {
        return this.resolveExistingQuote(openQuotes[0], customerPo, ctx);
      }
      if (openQuotes.length > 1) {
        return {
          kind: 'question',
          question: `Found multiple open quotes for "${data.customerName}": ${openQuotes
            .map((q) => `${q.quoteNumber} (${q.totalAmount} ${q.currency})`)
            .join(', ')}. Which quote does ${customerPo} approve?`,
          slots,
        };
      }
    }

    if (data.customerName || data.description) {
      if (!ctx.permissions.includes(PERMISSIONS.QUOTE_CREATE) || !ctx.permissions.includes(PERMISSIONS.QUOTE_APPROVE)) {
        return {
          kind: 'refused',
          reason: "Creating a new order requires permission to create and approve quotes.",
        };
      }

      const created = await this.quotes.createQuote(ctx.organizationId, {
        title: `PO ${customerPo}: ${data.description || 'Customer Order'}`,
        customerEmail: ctx.senderIdentifier.includes('@') ? ctx.senderIdentifier : undefined,
        prompt: `Customer PO: ${customerPo}\nOrder: ${data.description || 'Customer order from chat'}\nAmount: ${data.totalAmount || 0}`,
        createdBy: 'AI',
      });

      return {
        kind: 'resolved',
        value: {
          mode: 'NEW_QUOTE',
          quoteId: created.id,
          quoteNumber: created.quoteNumber || '(new)',
          customerPoNumber: customerPo,
          customerName: created.customerName || data.customerName || 'Customer',
          totalAmount: created.totalAmount || data.totalAmount || 0,
          currency: created.currency || 'USD',
          itemsCount: (created.items || []).length || 1,
        },
      };
    }

    return {
      kind: 'question',
      question:
        'Which quote or customer is this purchase order for? Send the quote number (e.g. "QT-2026-0004") or the customer name.',
      slots,
    };
  }

  private async resolveExistingQuote(
    quote: any,
    customerPo: string,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedSalesOrderFromDocument>> {
    const existingOrder = await this.orders.findByQuote(ctx.organizationId, quote.id);
    if (existingOrder) {
      return {
        kind: 'refused',
        reason: `Quote ${quote.quoteNumber} already has Sales Order ${existingOrder.orderNumber}.`,
      };
    }

    return {
      kind: 'resolved',
      value: {
        mode: 'MATCHED_QUOTE',
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber ?? '(unnumbered)',
        customerPoNumber: customerPo,
        customerName: quote.customerName,
        totalAmount: quote.totalAmount,
        currency: quote.currency,
        itemsCount: (quote.items || []).length,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async preview(resolved: ResolvedSalesOrderFromDocument, _ctx: SkillContext): Promise<string> {
    const modeDesc =
      resolved.mode === 'MATCHED_QUOTE'
        ? `Create Sales Order for ${resolved.customerName} against ${resolved.customerPoNumber} by approving quote ${resolved.quoteNumber}?`
        : `Create and provision Sales Order for ${resolved.customerName} from customer ${resolved.customerPoNumber} (Quote ${resolved.quoteNumber})?`;

    return (
      `${modeDesc}\n\n` +
      `Total: ${resolved.totalAmount} ${resolved.currency} (${resolved.itemsCount} line items)\n` +
      `This will provision a sales order and issue any initial billing stage invoice.\n\n` +
      `Reply YES to confirm or NO to cancel.`
    );
  }

  async execute(resolved: ResolvedSalesOrderFromDocument, ctx: SkillContext): Promise<SkillOutcome> {
    await this.quotes.sendSignal(ctx.organizationId, resolved.quoteId, 'APPROVE');
    const order = await this.orders.findByQuote(ctx.organizationId, resolved.quoteId);

    const orderNum = order ? order.orderNumber : '(provisioned)';
    return {
      reply: `Created Sales Order ${orderNum} for ${resolved.customerName} from ${resolved.customerPoNumber} (Quote ${resolved.quoteNumber}).`,
      resultType: 'SALES_ORDER',
      resultId: order ? order.id : resolved.quoteId,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test sales-order-from-document.skill.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/channels/skills/sales-order-from-document.skill.ts apps/api/src/modules/channels/skills/sales-order-from-document.skill.spec.ts
git commit -m "feat(channels): implement sales_order.from_document skill"
```

---

### Task 4: Wire Skills into `SkillRegistry` and `ChannelsModule`

**Files:**
- Modify: `apps/api/src/modules/channels/skills/skill.registry.ts`
- Modify: `apps/api/src/modules/channels/channels.module.ts`
- Test: `apps/api/src/modules/channels/skills/skill.registry.spec.ts` (or channels tests)

**Interfaces:**
- Consumes:
  - `DeliveryDispatchSkill`
  - `SalesOrderFromDocumentSkill`
  - `DeliveryNotesService`
  - `OrdersService`
- Produces:
  - Registry with 5 registered skills (`quote.approve`, `purchase_order.create`, `work_order.log_time`, `delivery.dispatch`, `sales_order.from_document`)

- [ ] **Step 1: Check existing `skill.registry.ts` and write/update tests**

Inspect `apps/api/src/modules/channels/skills/skill.registry.ts` and add tests asserting that `delivery.dispatch` and `sales_order.from_document` are in `registry.all()`.

- [ ] **Step 2: Update `SkillRegistry`**

Update `apps/api/src/modules/channels/skills/skill.registry.ts` to inject `DeliveryNotesService` and `OrdersService`, and register the two new skills.

- [ ] **Step 3: Update `ChannelsModule`**

In `apps/api/src/modules/channels/channels.module.ts`:
Ensure `OrdersModule` is imported in `imports: [...]` so `DeliveryNotesService` and `OrdersService` can be injected into `SkillRegistry`.

- [ ] **Step 4: Run tests to verify DI resolution and registration**

Run: `pnpm --filter api test channels`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/channels/skills/skill.registry.ts apps/api/src/modules/channels/channels.module.ts
git commit -m "feat(channels): register delivery.dispatch and sales_order.from_document in SkillRegistry"
```

---

### Task 5: Update Eval Fixtures & Regression Tests

**Files:**
- Modify: `apps/api/src/modules/channels/evals/fixtures/routing.cases.ts`
- Modify: `apps/api/src/modules/channels/evals/routing.eval.spec.ts`
- Modify: `apps/api/src/modules/channels/evals/refusal.eval.spec.ts`
- Test: `apps/api/src/modules/channels/evals/*.spec.ts`

**Interfaces:**
- Produces:
  - Updated routing cases covering `delivery.dispatch` and `sales_order.from_document`.
  - Refusal assertions verifying RBAC filtering hides skills from unauthorized callers.

- [ ] **Step 1: Update `routing.cases.ts`**

Add positive and negative cases for `delivery.dispatch` and `sales_order.from_document`.

- [ ] **Step 2: Update `routing.eval.spec.ts` and `refusal.eval.spec.ts`**

Include candidate skills and assert that permission filtering correctly hides `delivery.dispatch` without `DELIVERY_NOTE_DISPATCH` and `sales_order.from_document` without `SALES_ORDER_UPDATE`.

- [ ] **Step 3: Run evals to verify they pass**

Run: `pnpm --filter api test evals`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/channels/evals/
git commit -m "test(channels): add eval cases for delivery.dispatch and sales_order.from_document"
```

---

### Task 6: Full Verification & Documentation

**Files:**
- Modify: `docs/FLAGS.md` (mark chat command skills item as closed/resolved)
- Test: Full workspace test suite & production build

- [ ] **Step 1: Run full test suite across workspace**

Run: `pnpm test`
Expected: All tests pass across `@saas/shared`, `api`, and `web`.

- [ ] **Step 2: Run build across workspace**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Update `docs/FLAGS.md`**

Update the entry under `## Chat command layer` to reflect that `delivery.dispatch` and `sales_order.from_document` are implemented and tested.

- [ ] **Step 4: Commit**

```bash
git add docs/FLAGS.md
git commit -m "docs: mark delivery.dispatch and sales_order.from_document skills complete"
```
