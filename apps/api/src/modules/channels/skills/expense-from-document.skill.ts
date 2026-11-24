import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import {
  BILL_CAPTURE_MAX_BYTES,
  CHANNEL_SKILLS,
  describeExpenseClaimTax,
  isBillCaptureContentType,
  isReceiptContentType,
  PERMISSIONS,
  type SkillOutcome,
  type SkillResolution,
} from '@saas/shared';
import type { ExpenseReceiptsService } from '../../finance/expense-receipts.service';
import type { ExpensesService } from '../../finance/expenses.service';
import type { ChannelsService } from '../channels.service';
import type { InboundMedia } from '../interfaces/channel-driver.interface';
import type { SkillActorService } from '../services/skill-actor.service';
import type { ChannelSkill, SkillContext } from './skill.types';

const slotSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  merchantName: z.string().optional(),
  category: z.string().optional(),
  note: z.string().optional(),
});

/** The categories receipt scanning sorts into; a typed one must be one of these. */
const CATEGORIES = [
  'Meals & Entertainment',
  'Travel',
  'Software & Subscriptions',
  'Office Supplies',
  'General Expense',
] as const;

const jsonSchema = {
  type: 'object',
  properties: {
    amount: {
      type: 'number',
      description:
        'The total paid, only if the message states it, e.g. "84" or "84.50 dirhams".',
    },
    currency: {
      type: 'string',
      description:
        'ISO currency code, only if the message names a currency, e.g. "AED".',
    },
    merchantName: {
      type: 'string',
      description: 'Where the money was spent, if the message says.',
    },
    category: {
      type: 'string',
      enum: [...CATEGORIES],
      description:
        'Only if the message says what the expense was for. Fuel, taxis, parking and flights are Travel.',
    },
    note: {
      type: 'string',
      description:
        'What the expense was for, in the person’s words, e.g. "fuel for the delivery van".',
    },
  },
  additionalProperties: false,
} as const;

/** Working state kept between turns. Underscored, so the extractor never sees it. */
const SCAN_KEY = '_scan';
const MEDIA_KEY = '_media';

/** Below this the reading is shown with a warning to check it. */
const LOW_CONFIDENCE = 0.6;

interface ReceiptScan {
  merchantName: string;
  amount: number;
  currency: string | null;
  expenseDate: string | null;
  category: string;
  confidence: number;
  /** The VAT printed on the receipt, when it shows one. */
  taxAmount?: number | null;
  /** The supplier's tax number (TRN) printed on the receipt. */
  supplierTaxId?: string | null;
  /** The purchase tax code the scan suggests for that VAT. */
  taxCodeId?: string | null;
}

export interface ResolvedExpenseFromDocument {
  merchantName: string | null;
  amount: number;
  /** Null lets the claim take the organization's base currency. */
  currency: string | null;
  /** YYYY-MM-DD, or null when it could not be read and today is used. */
  expenseDate: string | null;
  category: string;
  note: string | null;
  /** What the person should check, in their words. */
  notes: string[];
  /**
   * The VAT on the receipt, when it can be recorded on the claim. Absent, the
   * claim carries no VAT, as a claim typed in without any would.
   */
  vat?: {
    taxCodeId: string;
    taxAmount: number;
    supplierTaxId: string | null;
    /** What happens to it, in plain words, for the preview. */
    summary: string;
  };
  media: InboundMedia;
  /** Set once the claim exists, so a retried YES attaches rather than claims twice. */
  claimId?: string;
  claimNumber?: string;
  claimCurrency?: string;
}

const money = (n: number) =>
  n.toLocaleString('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const isDate = (value: string | null | undefined): value is string =>
  !!value &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value));

/**
 * A receipt, photographed or forwarded, submitted as the sender's own
 * expense claim.
 *
 * The receipt is read by the same scan the web app uses and the claim goes
 * through `ExpensesService.create`, so it lands in the ordinary approval
 * queue. Nothing is paid, and nothing reaches the ledger, until an approver
 * acts on it in Kerf.
 */
export class ExpenseFromDocumentSkill implements ChannelSkill<ResolvedExpenseFromDocument> {
  readonly name = CHANNEL_SKILLS.EXPENSE_FROM_DOCUMENT;
  readonly description =
    'Claim an out-of-pocket expense from its receipt, sent as a photo or PDF: fuel, parking, a meal, a taxi, supplies bought in a shop. Not for a supplier’s invoice against a purchase order.';
  readonly examples = [
    'send a photo of a receipt to claim it as an expense',
    'expense: fuel for the delivery van',
    'claim this parking receipt',
  ];
  readonly requiredPermissions = [PERMISSIONS.EXPENSE_SUBMIT];
  readonly jsonSchema = jsonSchema as unknown as Record<string, unknown>;
  readonly slotSchema = slotSchema;
  readonly promptVersion = 'expense-from-doc/2';
  readonly isMutating = true;
  readonly attachment = 'required' as const;
  // Files only arrive on a messaging channel; the assistant takes text.
  readonly surfaces = ['channel'] as const;

  constructor(
    private readonly expenses: ExpensesService,
    private readonly receipts: ExpenseReceiptsService,
    private readonly actors: SkillActorService,
    private readonly channels: () => ChannelsService,
  ) {}

  async resolve(
    slots: Record<string, unknown>,
    ctx: SkillContext,
  ): Promise<SkillResolution<ResolvedExpenseFromDocument>> {
    const said = slotSchema.safeParse(slots);
    const typed = said.success ? said.data : {};
    const media =
      (slots[MEDIA_KEY] as InboundMedia | undefined) ?? ctx.attachment;
    let scan = slots[SCAN_KEY] as ReceiptScan | undefined;

    if (!scan) {
      if (!media) {
        return {
          kind: 'refused',
          reason:
            'Send the receipt as a photo or a PDF and I will submit it as an expense claim.',
        };
      }
      // Readable by the model and storable as a receipt: both, or neither.
      if (
        !isBillCaptureContentType(media.mimeType) ||
        !isReceiptContentType(media.mimeType)
      ) {
        return {
          kind: 'refused',
          reason:
            'I can read receipts sent as a PDF or a photo (JPEG, PNG or WebP).',
        };
      }
      try {
        const file = await this.channels().downloadMedia(
          ctx.organizationId,
          ctx.provider,
          media.id,
          BILL_CAPTURE_MAX_BYTES,
        );
        const read = await this.expenses.scanReceipt(
          {
            base64: file.buffer.toString('base64'),
            mimeType: media.mimeType,
          },
          { organizationId: ctx.organizationId, userId: ctx.userId },
        );
        // A scan that could not run comes back as zeros with a made-up
        // currency and today's date; none of that is a reading.
        const unread = read.confidence === 0;
        scan = {
          merchantName: read.merchantName,
          amount: read.amount,
          currency: unread ? null : read.currency,
          expenseDate: unread ? null : read.expenseDate,
          category: read.category,
          confidence: read.confidence,
          taxAmount: unread ? null : (read.taxAmount ?? null),
          supplierTaxId: unread ? null : (read.supplierTaxId ?? null),
          taxCodeId: unread ? null : (read.taxCodeId ?? null),
        };
      } catch (err) {
        // Refused, never thrown: a thrown error fails the webhook, and the
        // provider's redelivery would read the same file again.
        const reason =
          err instanceof HttpException
            ? err.message
            : 'the file could not be fetched or read';
        return {
          kind: 'refused',
          reason: `I couldn't read that receipt: ${reason}`,
        };
      }
    }

    const keep: Record<string, unknown> = {
      ...slots,
      [SCAN_KEY]: scan,
      [MEDIA_KEY]: media,
    };

    // What the person typed wins over what was read off the paper.
    const amount = typed.amount ?? scan.amount;
    if (!(amount > 0)) {
      return {
        kind: 'question',
        question:
          'I couldn’t read the total on that receipt. How much was it?',
        slots: keep,
      };
    }

    const notes: string[] = [];
    if (typed.amount == null && scan.confidence < LOW_CONFIDENCE) {
      notes.push(
        'The receipt was hard to read, so check the amount and the date.',
      );
    }
    const expenseDate = isDate(scan.expenseDate) ? scan.expenseDate : null;
    if (!expenseDate) {
      notes.push('The date could not be read, so today’s date is used.');
    }
    const category =
      typed.category && (CATEGORIES as readonly string[]).includes(typed.category)
        ? typed.category
        : scan.category || 'General Expense';

    const currency = (typed.currency ?? scan.currency)?.toUpperCase() ?? null;
    const vat = await this.receiptVat(ctx, scan, amount, currency, notes);

    return {
      kind: 'resolved',
      value: {
        merchantName: typed.merchantName?.trim() || scan.merchantName || null,
        amount,
        currency,
        expenseDate,
        category,
        note: typed.note?.trim() || null,
        notes,
        ...(vat ? { vat } : {}),
        media: media!,
      },
    };
  }

  /**
   * The VAT to record on the claim, when the receipt shows VAT the
   * organisation's tax codes can take. Otherwise nothing, with a note saying
   * why when the receipt did print VAT, so the person knows it was seen.
   */
  private async receiptVat(
    ctx: SkillContext,
    scan: ReceiptScan,
    amount: number,
    currency: string | null,
    notes: string[],
  ): Promise<ResolvedExpenseFromDocument['vat']> {
    const printed = Number(scan.taxAmount) || 0;
    if (!(printed > 0)) return undefined;
    const unclaimed = (why: string) => {
      notes.push(
        `The receipt shows ${money(printed)} of VAT, but ${why}, so no VAT is claimed back. You can add it on the claim in Kerf.`,
      );
      return undefined;
    };
    if (!scan.taxCodeId) {
      return unclaimed(
        scan.supplierTaxId
          ? 'I could not match it to one of your VAT types'
          : 'I could not read the supplier’s tax number (TRN) on it',
      );
    }
    // A total the person typed over the receipt's leaves the printed VAT
    // describing a different amount: work it out from the rate instead.
    const taxAmount = amount === scan.amount ? printed : null;
    try {
      const { split, problem } = await this.expenses.previewTax(
        ctx.organizationId,
        {
          amount,
          taxCodeId: scan.taxCodeId,
          taxAmount,
          supplierTaxId: scan.supplierTaxId,
        },
      );
      if (problem || !(split.tax > 0)) {
        return unclaimed('it does not fit the total on the receipt');
      }
      const show = (n: number) =>
        `${money(n)}${currency ? ` ${currency}` : ''}`;
      return {
        taxCodeId: scan.taxCodeId,
        taxAmount: split.tax,
        supplierTaxId: scan.supplierTaxId ?? null,
        summary: describeExpenseClaimTax(split, show),
      };
    } catch {
      return unclaimed('I could not check it against your VAT types');
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async preview(resolved: ResolvedExpenseFromDocument): Promise<string> {
    const check = resolved.notes.length
      ? `\n\nCheck:\n${resolved.notes.map((n) => `• ${n}`).join('\n')}`
      : '';
    return (
      `Submit this expense claim?\n\n` +
      `${resolved.merchantName ?? 'Receipt'}, ${resolved.category}: ` +
      `${money(resolved.amount)}${resolved.currency ? ` ${resolved.currency}` : ''}` +
      `${resolved.expenseDate ? `, dated ${resolved.expenseDate}` : ''}.` +
      (resolved.note ? `\nFor: ${resolved.note}` : '') +
      (resolved.vat
        ? `\n${resolved.vat.summary}` +
          (resolved.vat.supplierTaxId
            ? ` Supplier tax number (TRN): ${resolved.vat.supplierTaxId}.`
            : '')
        : '') +
      check +
      `\n\nIt goes to your approver in Kerf. Nothing is paid until it is approved.` +
      `\n\nReply YES to submit it or NO to cancel.`
    );
  }

  async execute(
    resolved: ResolvedExpenseFromDocument,
    ctx: SkillContext,
  ): Promise<SkillOutcome> {
    const user = await this.actors.forContext(ctx);
    if (!resolved.claimId) {
      const claim = await this.expenses.create(
        ctx.organizationId,
        {
          category: resolved.category,
          amount: resolved.amount,
          currency: resolved.currency ?? undefined,
          merchantName: resolved.merchantName,
          expenseDate: resolved.expenseDate
            ? new Date(`${resolved.expenseDate}T00:00:00Z`)
            : undefined,
          notes:
            resolved.note ??
            `Read from ${resolved.media.filename ?? 'a photo'} sent on chat.`,
          ...(resolved.vat
            ? {
                taxCodeId: resolved.vat.taxCodeId,
                taxAmount: resolved.vat.taxAmount,
                supplierTaxId: resolved.vat.supplierTaxId,
              }
            : {}),
        },
        {
          id: user.id,
          name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || undefined,
          email: user.email,
        },
      );
      // `resolved` is the conversation's stored value: if anything below
      // throws, the retry finds the claim and does not submit it again.
      resolved.claimId = claim.id;
      resolved.claimNumber = claim.claimNumber;
      resolved.claimCurrency = claim.currency;
    }

    let attached = true;
    try {
      const file = await this.channels().downloadMedia(
        ctx.organizationId,
        ctx.provider,
        resolved.media.id,
        BILL_CAPTURE_MAX_BYTES,
      );
      await this.receipts.attach(user, resolved.claimId, {
        originalname:
          resolved.media.filename ??
          `receipt-${resolved.claimNumber}.${extensionFor(resolved.media.mimeType)}`,
        mimetype: resolved.media.mimeType,
        size: file.buffer.length,
        buffer: file.buffer,
      });
    } catch {
      // The claim is what matters; the receipt can be attached by hand.
      attached = false;
    }

    return {
      reply:
        `Submitted ${resolved.claimNumber}: ${money(resolved.amount)} ${resolved.claimCurrency ?? ''}`.trimEnd() +
        `${resolved.merchantName ? `, ${resolved.merchantName}` : ''} (${resolved.category}). ` +
        `It is waiting for approval.` +
        (attached
          ? ''
          : ' I could not attach the receipt — attach it from the claim in Kerf.'),
      resultType: 'EXPENSE_CLAIM',
      resultId: resolved.claimId,
    };
  }
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}
