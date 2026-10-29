import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import {
  BILL_CAPTURE_MAX_BYTES,
  billTotals,
  CHANNEL_SKILLS,
  isBillCaptureContentType,
  matchInvoiceLines,
  matchOrderReference,
  PERMISSIONS,
  type BillCaptureResult,
  type BillCaptureWarningCode,
  type CapturedLineMatch,
  type CreateBillPayload,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import type { BillCaptureService } from '../../payables/bill-capture.service';
import type { PayablesService } from '../../payables/payables.service';
import type { AttachmentsService } from '../../storage/attachments.service';
import type { ChannelsService } from '../channels.service';
import type { InboundMedia } from '../interfaces/channel-driver.interface';
import type { SkillActorService } from '../services/skill-actor.service';
import type { ChannelSkill, PendingChoice, SkillContext } from './skill.types';

const slotSchema = z.object({
  purchaseOrderReference: z.string().optional(),
  supplierInvoiceNumber: z.string().optional(),
});

const jsonSchema = {
  type: 'object',
  properties: {
    purchaseOrderReference: {
      type: 'string',
      description:
        'Our purchase order number, if the message names one, e.g. "PO-2026-0031" or "PO 31".',
    },
    supplierInvoiceNumber: {
      type: 'string',
      description: 'The supplier’s invoice number, if the message states it.',
    },
  },
  additionalProperties: false,
} as const;

/** Working state kept between turns. Underscored, so the extractor never sees it. */
const CAPTURE_KEY = '_capture';
const MEDIA_KEY = '_media';

/** Capture warnings worth repeating in the confirmation. The rest are handled before it. */
const PREVIEW_WARNINGS: BillCaptureWarningCode[] = [
  'LOW_CONFIDENCE',
  'LINES_DO_NOT_ADD_UP',
  'TOTAL_DOES_NOT_ADD_UP',
  'CURRENCY_MISMATCH',
];

export interface ResolvedBillFromDocument {
  supplierId: string;
  supplierName: string;
  purchaseOrderId: string;
  poNumber: string;
  supplierInvoiceNumber: string;
  /** YYYY-MM-DD, or null when it could not be read and today is used. */
  billDate: string | null;
  dueDate: string | null;
  taxAmount: number;
  currency: string;
  lines: {
    purchaseOrderLineId: string | null;
    description: string;
    qty: number;
    unitCost: number;
  }[];
  /** What the person should check, in their words. */
  notes: string[];
  printedTotal: number | null;
  media: InboundMedia;
  captureModel: string;
  capturePromptVersion: string;
  /** Set once the bill exists, so a retried YES attaches rather than enters it twice. */
  billId?: string;
  billNumber?: string;
  matchStatus?: string;
}

const money = (n: number) =>
  n.toLocaleString('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * A supplier invoice, photographed or forwarded, entered as a draft bill.
 *
 * The document is read by the same capture service the web app uses, and the
 * bill is entered through `PayablesService.create` — so the duplicate check
 * and the three-way match are the ones a bill typed in by hand gets. A draft
 * posts nothing; approval stays in Kerf.
 */
export class BillFromDocumentSkill implements ChannelSkill<ResolvedBillFromDocument> {
  readonly name = CHANNEL_SKILLS.BILL_FROM_DOCUMENT;
  readonly description =
    'Enter a supplier invoice, sent as a photo or PDF, as a draft bill against its purchase order.';
  readonly examples = [
    'send a photo or PDF of a supplier invoice',
    'this is the Gulf Board invoice for PO-2026-0031',
    'bill for the board delivery',
  ];
  readonly requiredPermissions = [PERMISSIONS.BILL_CREATE];
  readonly jsonSchema = jsonSchema as unknown as Record<string, unknown>;
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'bill-from-doc/1';
  readonly isMutating = true;
  readonly attachment = 'required' as const;
  // Files only arrive on a messaging channel; the assistant takes text.
  readonly surfaces = ['channel'] as const;

  constructor(
    private readonly capture: BillCaptureService,
    private readonly payables: PayablesService,
    private readonly attachments: AttachmentsService,
    private readonly actors: SkillActorService,
    private readonly channels: () => ChannelsService,
  ) {}

  async resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedBillFromDocument>> {
    const said = slotSchema.safeParse(slots);
    const typed = said.success ? said.data : {};
    const media =
      (slots[MEDIA_KEY] as InboundMedia | undefined) ?? ctx.attachment;
    let capture = slots[CAPTURE_KEY] as BillCaptureResult | undefined;

    if (!capture) {
      if (!media) {
        return {
          kind: 'refused',
          reason:
            'Send the supplier invoice as a photo or a PDF and I will enter it as a draft bill.',
        };
      }
      if (!isBillCaptureContentType(media.mimeType)) {
        return {
          kind: 'refused',
          reason:
            'I can read invoices sent as a PDF or a photo (JPEG, PNG or WebP).',
        };
      }
      try {
        const file = await this.channels().downloadMedia(
          ctx.organizationId,
          ctx.provider,
          media.id,
          BILL_CAPTURE_MAX_BYTES,
        );
        capture = await this.capture.capture(
          ctx.organizationId,
          ctx.userId,
          {
            buffer: file.buffer,
            mimeType: media.mimeType,
            filename: media.filename,
          },
          ctx.message,
        );
      } catch (err) {
        // Refused, never thrown: a thrown error fails the webhook, and the
        // provider's redelivery would read the same file again.
        const reason =
          err instanceof HttpException
            ? err.message
            : 'the file could not be fetched or read';
        return {
          kind: 'refused',
          reason: `I couldn't read that invoice: ${reason}`,
        };
      }
    }

    const keep: Record<string, unknown> = {
      ...slots,
      [CAPTURE_KEY]: capture,
      [MEDIA_KEY]: media,
    };
    delete keep.pendingChoice;
    const { invoice } = capture;
    const codes = new Set(capture.warnings.map((w) => w.code));

    if (codes.has('NOT_AN_INVOICE')) {
      return {
        kind: 'refused',
        reason:
          'That does not look like a supplier invoice — it may be a quotation, a statement or a delivery note.',
      };
    }
    if (capture.duplicateOf) {
      return {
        kind: 'refused',
        reason: `That invoice is already entered as ${capture.duplicateOf.billNumber}.`,
      };
    }
    if (!capture.supplier) {
      const near = capture.supplierCandidates
        .map((c) => c.companyName)
        .join(', ');
      return {
        kind: 'refused',
        reason:
          `I read an invoice from "${invoice.supplierName ?? 'a supplier I could not make out'}", but no supplier in Kerf matches` +
          `${near ? ` (closest: ${near})` : ''}. Add or correct the supplier in Kerf, then send the invoice again.`,
      };
    }
    if (invoice.lines.length === 0) {
      return {
        kind: 'refused',
        reason:
          'I couldn’t read any lines on that invoice. Enter it in Kerf instead.',
      };
    }
    const supplier = capture.supplier;

    let order = capture.purchaseOrder;
    let pairing: CapturedLineMatch[] = capture.lines;
    if (!order) {
      const options = capture.orderCandidates;
      if (options.length === 0) {
        return {
          kind: 'refused',
          reason: `${supplier.companyName} has no open purchase orders to bill this against. Enter it in Kerf instead.`,
        };
      }
      const picked = this.pickOrder(
        slots.pendingChoice as PendingChoice | undefined,
        ctx.message,
        typed.purchaseOrderReference,
        options,
      );
      if (!picked) {
        const question =
          `Which order is ${supplier.companyName}'s invoice ${invoice.supplierInvoiceNumber ?? ''} for?\n` +
          options
            .map(
              (o, i) =>
                `${i + 1}. ${o.poNumber} · ${money(o.totalAmount)} ${o.currency}`,
            )
            .join('\n') +
          '\nReply with the number or the PO.';
        const choice: PendingChoice = {
          field: 'purchaseOrderId',
          question,
          options: options.map((o) => ({
            id: o.id,
            label: o.poNumber,
            keywords: [o.poNumber],
          })),
        };
        return {
          kind: 'question',
          question,
          slots: { ...keep, pendingChoice: choice },
        };
      }
      order = { id: picked.id, poNumber: picked.poNumber };
      const billable = await this.payables.billableLines(
        ctx.organizationId,
        picked.id,
      );
      pairing = matchInvoiceLines(invoice.lines, billable);
    }

    const supplierInvoiceNumber =
      invoice.supplierInvoiceNumber ?? typed.supplierInvoiceNumber?.trim();
    if (!supplierInvoiceNumber) {
      return {
        kind: 'question',
        question: 'I couldn’t read the supplier’s invoice number. What is it?',
        slots: keep,
      };
    }

    const notes = capture.warnings
      .filter((w) => PREVIEW_WARNINGS.includes(w.code))
      .map((w) => w.message);
    const lines = invoice.lines.map((line, i) => {
      const orderLine =
        pairing.find((m) => m.index === i)?.purchaseOrderLineId ?? null;
      if (!orderLine)
        notes.push(
          `"${line.description}" is not on ${order.poNumber}; it goes on as a charge outside the order.`,
        );
      return {
        purchaseOrderLineId: orderLine,
        description: line.description,
        qty: line.qty,
        unitCost: line.unitCost,
      };
    });
    if (!invoice.billDate)
      notes.push(
        'The invoice date could not be read, so today’s date is used.',
      );

    return {
      kind: 'resolved',
      value: {
        supplierId: supplier.id,
        supplierName: supplier.companyName,
        purchaseOrderId: order.id,
        poNumber: order.poNumber,
        supplierInvoiceNumber,
        billDate: invoice.billDate,
        dueDate: invoice.dueDate,
        taxAmount: invoice.taxAmount ?? 0,
        currency: supplier.currency ?? invoice.currency ?? '',
        lines,
        notes,
        printedTotal: invoice.totalAmount,
        media: media!,
        captureModel: capture.model,
        capturePromptVersion: capture.promptVersion,
      },
    };
  }

  /** The order the person chose, answered in code: a list number, or a PO number however written. */
  private pickOrder<O extends { id: string; poNumber: string }>(
    pending: PendingChoice | undefined,
    message: string,
    reference: string | undefined,
    options: O[],
  ): O | null {
    const n = /^\s*(\d{1,2})\s*\.?\s*$/.exec(message)?.[1];
    if (pending && n && Number(n) >= 1 && Number(n) <= options.length) {
      return options[Number(n) - 1];
    }
    return (
      matchOrderReference(message, options) ??
      matchOrderReference(reference ?? null, options)
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async preview(resolved: ResolvedBillFromDocument): Promise<string> {
    const totals = billTotals(resolved.lines, resolved.taxAmount);
    const printed =
      resolved.printedTotal != null &&
      Math.abs(resolved.printedTotal - totals.total) > 0.05
        ? ` (the invoice prints ${money(resolved.printedTotal)})`
        : '';
    const check = resolved.notes.length
      ? `\n\nCheck:\n${resolved.notes.map((n) => `• ${n}`).join('\n')}`
      : '';
    return (
      `Enter a draft bill from ${resolved.supplierName} against ${resolved.poNumber}?\n\n` +
      `Their invoice ${resolved.supplierInvoiceNumber}${resolved.billDate ? `, dated ${resolved.billDate}` : ''}: ` +
      `${money(totals.total)} ${resolved.currency}${printed}, including ${money(totals.tax)} VAT, ` +
      `${resolved.lines.length} line${resolved.lines.length === 1 ? '' : 's'}.` +
      check +
      `\n\nNothing is posted until someone approves the bill in Kerf.\n\nReply YES to enter it or NO to cancel.`
    );
  }

  async execute(
    resolved: ResolvedBillFromDocument,
    ctx: SkillContext,
  ): Promise<SkillOutcome> {
    if (!resolved.billId) {
      const payload: CreateBillPayload = {
        supplierId: resolved.supplierId,
        purchaseOrderId: resolved.purchaseOrderId,
        supplierInvoiceNumber: resolved.supplierInvoiceNumber,
        billDate: resolved.billDate
          ? new Date(`${resolved.billDate}T00:00:00Z`)
          : new Date(),
        dueDate: resolved.dueDate
          ? new Date(`${resolved.dueDate}T00:00:00Z`)
          : null,
        taxAmount: resolved.taxAmount,
        taxCodeId: null,
        notes: `Read from ${resolved.media.filename ?? 'a photo'} sent on chat.`,
        lines: resolved.lines.map((l) => ({
          ...l,
          category: null,
          servicePeriodStart: null,
          servicePeriodEnd: null,
        })),
      };
      const bill = await this.payables.create(
        ctx.organizationId,
        ctx.userId,
        payload,
      );
      // `resolved` is the conversation's stored value: if anything below
      // throws, the retry finds the bill and does not enter it again.
      resolved.billId = bill.id;
      resolved.billNumber = bill.billNumber;
      resolved.matchStatus = bill.matchStatus;
    }

    let attached = true;
    try {
      const file = await this.channels().downloadMedia(
        ctx.organizationId,
        ctx.provider,
        resolved.media.id,
        BILL_CAPTURE_MAX_BYTES,
      );
      const user = await this.actors.forContext(ctx);
      await this.attachments.upload(user, 'BILL', resolved.billId, {
        originalname:
          resolved.media.filename ??
          `invoice-${resolved.supplierInvoiceNumber}.${extensionFor(resolved.media.mimeType)}`,
        mimetype: resolved.media.mimeType,
        size: file.buffer.length,
        buffer: file.buffer,
      });
    } catch {
      // The bill is what matters; the copy can be attached by hand.
      attached = false;
    }

    const totals = billTotals(resolved.lines, resolved.taxAmount);
    const match =
      resolved.matchStatus === 'VARIANCE'
        ? 'It does not match the order or what was received, so it will need a variance approval.'
        : 'It matches the order and what was received.';
    return {
      reply:
        `Entered ${resolved.billNumber} from ${resolved.supplierName} as a draft against ${resolved.poNumber}: ` +
        `${money(totals.total)} ${resolved.currency}. ${match}` +
        (attached
          ? ''
          : ' I could not attach the invoice file — attach it from the bill in Kerf.'),
      resultType: 'BILL',
      resultId: resolved.billId,
    };
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'jpg';
}
