import { z } from 'zod';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type MaterialUom,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import { PurchasingService } from '../../purchasing/purchasing.service';
import type { ChannelSkill, PendingChoice, SkillContext } from './skill.types';

/** What the extractor is allowed to produce. Ids are never in here — the model does not choose ids. */
const slotSchema = z.object({
  supplierQuery: z.string().optional(),
  lines: z
    .array(
      z.object({
        materialQuery: z.string().optional(),
        qty: z.number().positive().optional(),
        uom: z.string().optional(),
      }),
    )
    .optional(),
});

/** Slots after resolution — ids present, price attached, ready to execute. */
export interface ResolvedPurchaseOrder {
  supplierId: string;
  supplierName: string;
  currency: string;
  leadTimeDays: number | null;
  lines: {
    materialId: string;
    description: string;
    qty: number;
    uom: MaterialUom;
    unitCost: number;
  }[];
}

const jsonSchema = {
  type: 'object',
  properties: {
    supplierQuery: {
      type: 'string',
      description:
        'The supplier or company being bought FROM, exactly as written, e.g. "Papertree". Omit if the message does not name one.',
    },
    lines: {
      type: 'array',
      description: 'One entry per distinct thing being ordered.',
      items: {
        type: 'object',
        properties: {
          materialQuery: {
            type: 'string',
            description:
              'The material as described, e.g. "350gsm board" or "magnets". Copy the words used; do not expand abbreviations or invent a product code.',
          },
          qty: {
            type: 'number',
            description:
              'How many, as a number. Omit entirely if the message is vague ("some", "a few", "more") — do not guess a quantity.',
          },
          uom: {
            type: 'string',
            description:
              'Unit mentioned, one of SHEET, EACH, BOX, KG, M, M2, ROLL. Omit if not stated.',
          },
        },
      },
    },
  },
  additionalProperties: false,
} as const;

/** Matches a user's reply against options we offered. Deterministic — never a model call. */
function matchChoice(reply: string, choice: PendingChoice): string | null {
  const normalized = reply.trim().toLowerCase();
  if (!normalized) return null;

  const byIndex = Number(normalized.replace(/[^0-9]/g, ''));
  if (
    /^\s*\d+\s*$/.test(normalized) &&
    byIndex >= 1 &&
    byIndex <= choice.options.length
  ) {
    return choice.options[byIndex - 1].id;
  }

  // Matched in both directions: people answer with a fragment ("SRA2" for
  // "BRD-350-SRA2") as often as they paste the whole thing back. A fragment
  // that fits more than one option is not an answer — re-ask instead.
  const hits = choice.options.filter((option) =>
    option.keywords.some((keyword) => {
      const k = keyword.toLowerCase();
      return k.length > 0 && (k.includes(normalized) || normalized.includes(k));
    }),
  );
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Raise a draft purchase order from a chat message.
 *
 * The interesting part is what this class does *not* do: it never computes a
 * price, never picks between two materials, and never creates anything in a
 * state other than `DRAFT`. Each of those is a place where being helpful
 * would mean being wrong at someone's expense.
 */
export class PurchaseOrderCreateSkill implements ChannelSkill<ResolvedPurchaseOrder> {
  readonly name = CHANNEL_SKILLS.PURCHASE_ORDER_CREATE;
  readonly description =
    'Raise a new purchase order to buy materials or stock FROM a supplier. Use for messages about ordering, buying, restocking or purchasing something the shop consumes.';
  readonly examples = [
    'order 500 sheets of 350gsm board from Papertree',
    'we need more magnets, 2 boxes from Fixings Direct',
    'buy 10kg of white glue',
    'raise a PO for 200 SRA2 sheets',
  ];
  readonly requiredPermissions = [PERMISSIONS.PURCHASE_ORDER_CREATE];
  readonly jsonSchema = jsonSchema as unknown as Record<string, unknown>;
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'po-create/1';

  constructor(private readonly purchasing: PurchasingService) {}

  async resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedPurchaseOrder>> {
    const working = { ...slots } as Record<string, unknown>;

    // An outstanding choice is answered from this message before anything else.
    const choice = working.pendingChoice as PendingChoice | undefined;
    if (choice) {
      const picked = matchChoice(ctx.message, choice);
      if (!picked) {
        return {
          kind: 'question',
          question: choice.question,
          slots: working,
        };
      }
      delete working.pendingChoice;
      this.applyChoice(working, choice.field, picked);
    }

    const parsed = slotSchema.safeParse(working);
    if (!parsed.success) {
      return {
        kind: 'refused',
        reason: 'I could not make sense of that order.',
      };
    }

    /* ---- supplier ---- */
    let supplierId = working.supplierId as string | undefined;
    if (!supplierId) {
      const query = parsed.data.supplierQuery;
      if (!query) {
        return {
          kind: 'question',
          question: 'Which supplier should this order go to?',
          slots: working,
        };
      }
      const matches = await this.purchasing.findSuppliersByName(
        ctx.organizationId,
        query,
      );
      if (matches.length === 0) {
        return {
          kind: 'refused',
          reason: `I could not find a supplier matching "${query}". Add them first, or try their exact name.`,
        };
      }
      if (matches.length > 1) {
        const pending: PendingChoice = {
          field: 'supplierId',
          question: `Which supplier did you mean?\n${matches
            .map((s, i) => `${i + 1}. ${s.companyName}`)
            .join('\n')}`,
          options: matches.map((s) => ({
            id: s.id,
            label: s.companyName,
            keywords: [s.companyName],
          })),
        };
        working.pendingChoice = pending;
        return { kind: 'question', question: pending.question, slots: working };
      }
      supplierId = matches[0].id;
      working.supplierId = supplierId;
    }

    const supplier = await this.purchasing.findSupplierById(
      ctx.organizationId,
      supplierId,
    );

    /* ---- lines ---- */
    const rawLines = (parsed.data.lines ?? []).filter((l) => l.materialQuery);
    if (rawLines.length === 0) {
      return {
        kind: 'question',
        question: `What should I order from ${supplier.companyName}?`,
        slots: working,
      };
    }

    const chosen = (working.chosenMaterials ?? {}) as Record<string, string>;
    const resolvedLines: ResolvedPurchaseOrder['lines'] = [];

    for (let index = 0; index < rawLines.length; index++) {
      const line = rawLines[index];
      let materialId = chosen[String(index)];

      if (!materialId) {
        const candidates = await this.purchasing.findMaterialsByQuery(
          ctx.organizationId,
          line.materialQuery as string,
          supplier.id,
        );
        if (candidates.length === 0) {
          return {
            kind: 'refused',
            reason: `${supplier.companyName} has no material matching "${line.materialQuery}" on their price list.`,
          };
        }
        if (candidates.length > 1) {
          const pending: PendingChoice = {
            field: `chosenMaterials.${index}`,
            question: `${candidates.length} materials match "${line.materialQuery}":\n${candidates
              .map(
                (m, i) =>
                  `${i + 1}. ${m.sku ?? m.name}${
                    m.sheetWidthMm && m.sheetHeightMm
                      ? ` — ${m.sheetWidthMm}×${m.sheetHeightMm}mm`
                      : ` — ${m.name}`
                  }`,
              )
              .join('\n')}\n\nWhich one?`,
            options: candidates.map((m) => ({
              id: m.id,
              label: m.sku ?? m.name,
              keywords: [m.sku ?? '', m.name].filter(Boolean),
            })),
          };
          working.pendingChoice = pending;
          return {
            kind: 'question',
            question: pending.question,
            slots: working,
          };
        }
        materialId = candidates[0].id;
        chosen[String(index)] = materialId;
        working.chosenMaterials = chosen;
      }

      const resolvedMaterial = await this.purchasing.findMaterialById(
        ctx.organizationId,
        materialId,
      );
      if (!resolvedMaterial) {
        return {
          kind: 'refused',
          reason: 'That material is no longer available.',
        };
      }

      if (line.qty == null) {
        return {
          kind: 'question',
          question: `How many ${resolvedMaterial.name} (${resolvedMaterial.uom.toLowerCase()}) do you need?`,
          slots: working,
        };
      }

      // Price comes from the supplier's price list. Never from the message,
      // and never from the model.
      const price = await this.purchasing.findSupplierPrice(
        ctx.organizationId,
        supplier.id,
        resolvedMaterial.id,
      );
      if (!price) {
        return {
          kind: 'refused',
          reason: `${supplier.companyName} has no price on record for ${resolvedMaterial.name}. Add it to their price list first.`,
        };
      }
      if (price.minOrderQty != null && line.qty < price.minOrderQty) {
        return {
          kind: 'refused',
          reason: `${supplier.companyName} sells ${resolvedMaterial.name} in minimum quantities of ${price.minOrderQty} ${resolvedMaterial.uom.toLowerCase()}. Reply with a quantity of at least that.`,
        };
      }

      resolvedLines.push({
        materialId: resolvedMaterial.id,
        description: resolvedMaterial.name,
        qty: line.qty,
        uom: resolvedMaterial.uom,
        unitCost: price.unitCost,
      });
    }

    return {
      kind: 'resolved',
      value: {
        supplierId: supplier.id,
        supplierName: supplier.companyName,
        currency: supplier.currency ?? 'USD',
        leadTimeDays: supplier.leadTimeDays,
        lines: resolvedLines,
      },
    };
  }

  private applyChoice(
    slots: Record<string, unknown>,
    field: string,
    id: string,
  ): void {
    if (field === 'supplierId') {
      slots.supplierId = id;
      return;
    }
    const [prefix, index] = field.split('.');
    if (prefix === 'chosenMaterials') {
      const chosen = (slots.chosenMaterials ?? {}) as Record<string, string>;
      chosen[index] = id;
      slots.chosenMaterials = chosen;
    }
  }

  // The interface is async because other skills need to look things up to
  // build a preview; this one already has everything resolved.
  // eslint-disable-next-line @typescript-eslint/require-await
  async preview(resolved: ResolvedPurchaseOrder): Promise<string> {
    const lines = resolved.lines
      .map(
        (l) =>
          `${l.qty} × ${l.description} @ ${l.unitCost.toFixed(4)} → ${(l.qty * l.unitCost).toFixed(2)}`,
      )
      .join('\n');
    const total = resolved.lines.reduce(
      (sum, l) => sum + l.qty * l.unitCost,
      0,
    );
    const eta =
      resolved.leadTimeDays != null
        ? `\nLead time ${resolved.leadTimeDays} days.`
        : '';

    return (
      `Purchase order for ${resolved.supplierName}\n\n${lines}\n\n` +
      `Total ${total.toFixed(2)} ${resolved.currency}.${eta}\n` +
      `This creates it as a DRAFT — it will still need approval before it can be sent.\n\n` +
      `Reply YES to create it, NO to cancel.`
    );
  }

  async execute(
    resolved: ResolvedPurchaseOrder,
    ctx: SkillContext,
  ): Promise<SkillOutcome> {
    const po = await this.purchasing.createPurchaseOrder(
      ctx.organizationId,
      ctx.userId,
      {
        supplierId: resolved.supplierId,
        lines: resolved.lines.map((l) => ({
          materialId: l.materialId,
          description: l.description,
          qtyOrdered: l.qty,
          uom: l.uom,
          unitCost: l.unitCost,
        })),
        originMetadata: {
          origin: 'AI_DRAFTED',
          originChannel: ctx.provider,
          promptVersion: this.promptVersion,
        },
      },
    );

    return {
      reply:
        `Created ${po.poNumber} (draft, ${po.totalAmount.toFixed(2)} ${po.currency}).\n\n` +
        `It needs approval before it can be sent.`,
      resultType: 'PURCHASE_ORDER',
      resultId: po.id,
    };
  }
}
