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
      description:
        'The delivery note number mentioned, e.g. "DN-2026-0001", if any.',
    },
    salesOrderNumber: {
      type: 'string',
      description:
        'The sales order number mentioned, e.g. "SO-2026-0005", if any.',
    },
    customerName: {
      type: 'string',
      description: 'The customer or company name mentioned, if any.',
    },
  },
  additionalProperties: false,
} as const;

export class DeliveryDispatchSkill
  implements ChannelSkill<ResolvedDeliveryDispatch>
{
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
      return {
        kind: 'refused',
        reason: 'I could not make sense of that delivery request.',
      };
    }
    const data = parsed.data;

    const dnMatch =
      DN_NUMBER_PATTERN.exec(ctx.message) ??
      (data.deliveryNoteNumber
        ? DN_NUMBER_PATTERN.exec(data.deliveryNoteNumber)
        : null);
    const dnTarget = dnMatch
      ? dnMatch[0].toUpperCase()
      : data.deliveryNoteNumber?.trim();

    if (dnTarget) {
      let foundNote: any = null;
      try {
        const direct = await this.deliveryNotes.get(
          ctx.organizationId,
          dnTarget,
        );
        if (direct) {
          foundNote = direct;
        }
      } catch {
        // Not found by direct id or mock
      }

      if (!foundNote) {
        const allOrders = (await this.orders.list(ctx.organizationId)) || [];
        for (const o of allOrders) {
          const notes =
            (await this.deliveryNotes.listForOrder(
              ctx.organizationId,
              o.id,
            )) || [];
          const match = notes.find((n) => {
            const num = n.deliveryNoteNumber?.toUpperCase();
            const target = dnTarget.toUpperCase();
            return num === target || num?.endsWith(target) || n.id === dnTarget;
          });
          if (match) {
            foundNote = await this.deliveryNotes.get(
              ctx.organizationId,
              match.id,
            );
            break;
          }
        }
      }

      if (!foundNote) {
        return {
          kind: 'refused',
          reason: `I couldn't find delivery note ${dnTarget}.`,
        };
      }

      if (foundNote.status !== 'DRAFT') {
        return {
          kind: 'refused',
          reason: `Delivery note ${foundNote.deliveryNoteNumber} is already ${foundNote.status.toLowerCase()} — nothing to dispatch.`,
        };
      }

      let order: any = null;
      if (foundNote.salesOrderId) {
        try {
          order = await this.orders.get(
            ctx.organizationId,
            foundNote.salesOrderId,
          );
        } catch {
          // Ignore if order cannot be loaded
        }
      }

      return {
        kind: 'resolved',
        value: {
          mode: 'EXISTING_NOTE',
          deliveryNoteId: foundNote.id,
          deliveryNoteNumber: foundNote.deliveryNoteNumber,
          salesOrderId: foundNote.salesOrderId,
          salesOrderNumber:
            order?.orderNumber || (foundNote as any).orderNumber || '',
          customerName: foundNote.customerName || order?.customerName || '',
          lines: (foundNote.lines || []).map((l: any) => ({
            salesOrderLineId: l.salesOrderLineId,
            description: l.description,
            qty: l.qty,
            uom: l.uom || 'units',
            hasStockMaterial: Boolean(l.stockMaterialId),
          })),
        },
      };
    }

    const soMatch =
      SO_NUMBER_PATTERN.exec(ctx.message) ??
      (data.salesOrderNumber
        ? SO_NUMBER_PATTERN.exec(data.salesOrderNumber)
        : null);
    const soTarget = soMatch
      ? soMatch[0].toUpperCase()
      : data.salesOrderNumber?.trim();

    const allOrders = (await this.orders.list(ctx.organizationId)) || [];
    let targetOrder: any = null;

    if (soTarget) {
      const targetUpper = soTarget.toUpperCase();
      targetOrder = allOrders.find(
        (o) =>
          o.orderNumber?.toUpperCase() === targetUpper || o.id === soTarget,
      );
      if (!targetOrder) {
        return {
          kind: 'refused',
          reason: `I couldn't find sales order ${soTarget}.`,
        };
      }
    } else if (data.customerName) {
      const custLower = data.customerName.toLowerCase();
      const candidates = allOrders.filter(
        (o) =>
          o.customerName?.toLowerCase().includes(custLower) &&
          o.status !== 'CANCELLED' &&
          o.status !== 'CLOSED' &&
          o.status !== 'FULFILLED',
      );
      if (candidates.length === 1) {
        targetOrder = candidates[0];
      } else if (candidates.length > 1) {
        return {
          kind: 'question',
          question: `Found several open orders for "${data.customerName}": ${candidates
            .map((c) => c.orderNumber)
            .join(', ')}. Which one do you want to dispatch?`,
          slots,
        };
      } else {
        return {
          kind: 'refused',
          reason: `I couldn't find an open sales order for "${data.customerName}".`,
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

    const fullOrder = await this.orders.get(
      ctx.organizationId,
      targetOrder.id,
    );
    if (
      fullOrder.status === 'CANCELLED' ||
      fullOrder.status === 'CLOSED' ||
      fullOrder.status === 'FULFILLED'
    ) {
      return {
        kind: 'refused',
        reason: `Sales order ${fullOrder.orderNumber} is already ${fullOrder.status.toLowerCase()} — cannot dispatch.`,
      };
    }

    const existingNotes =
      (await this.deliveryNotes.listForOrder(
        ctx.organizationId,
        fullOrder.id,
      )) || [];
    const drafts = existingNotes.filter((n) => n.status === 'DRAFT');
    const draftQuantities = new Map<string, number>();
    for (const d of drafts) {
      for (const line of d.lines || []) {
        draftQuantities.set(
          line.salesOrderLineId,
          (draftQuantities.get(line.salesOrderLineId) ?? 0) + line.qty,
        );
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
          hasStockMaterial: Boolean(
            (line as any).catalogItemId || (line as any).stockMaterialId,
          ),
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
  async preview(
    resolved: ResolvedDeliveryDispatch,
    _ctx: SkillContext,
  ): Promise<string> {
    const linesSummary = resolved.lines
      .map((l) => `- ${l.qty}x ${l.description}`)
      .join('\n');
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

  async execute(
    resolved: ResolvedDeliveryDispatch,
    ctx: SkillContext,
  ): Promise<SkillOutcome> {
    let noteId = resolved.deliveryNoteId;
    let noteNumber = resolved.deliveryNoteNumber;

    if (resolved.mode === 'FROM_ORDER') {
      const created = await this.deliveryNotes.create(
        ctx.organizationId,
        ctx.userId,
        resolved.salesOrderId,
        {
          lines: resolved.lines.map((l) => ({
            salesOrderLineId: l.salesOrderLineId,
            qty: l.qty,
          })),
          shipTo: null,
          carrier: null,
          trackingReference: null,
          notes: null,
        },
      );
      noteId = created.id;
      noteNumber = created.deliveryNoteNumber;
    }

    const dispatched = await this.deliveryNotes.dispatch(
      ctx.organizationId,
      noteId!,
      ctx.userId,
    );
    const totalUnits = resolved.lines.reduce((sum, l) => sum + l.qty, 0);

    return {
      reply: `Dispatched delivery note ${dispatched?.deliveryNoteNumber || noteNumber} for ${resolved.customerName} (${totalUnits} items).`,
      resultType: 'DELIVERY_NOTE',
      resultId: noteId,
    };
  }
}
