import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  BILL_CAPTURE_MAX_BYTES,
  invoiceArithmeticWarnings,
  isBillCaptureContentType,
  matchInvoiceLines,
  matchOrderReference,
  matchSupplier,
  type BillCaptureResult,
  type CapturedInvoice,
  type CapturedLineMatch,
  type PurchaseOrderStatus,
} from '@saas/shared';
import { AiService } from '../ai/ai.service';
import type { AiContentBlock } from '../ai/interfaces/ai-provider.interface';
import { PurchaseOrder } from '../purchasing/entities/purchase-order.entity';
import { Supplier } from '../purchasing/entities/supplier.entity';
import { SupplierBill } from './entities/supplier-bill.entity';
import { PayablesService } from './payables.service';
import {
  BILL_CAPTURE_INSTRUCTION,
  BILL_CAPTURE_PROMPT_VERSION,
  capturedInvoiceJsonSchema,
  capturedInvoiceSchema,
} from './bill-capture.schema';

export interface CaptureFile {
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}

/** Orders a supplier can still be billing against. */
const BILLABLE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  'APPROVED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
];

/** How many of a supplier's open orders are tried when the invoice quotes none. */
const ORDERS_TRIED_WITHOUT_REFERENCE = 10;

/** Below this, the read is flagged as a whole and not just field by field. */
const LOW_CONFIDENCE = 0.6;

/**
 * Reads a supplier's invoice and proposes the bill it should become.
 *
 * Saves nothing. What it returns is a pre-filled form for a person (or a
 * draft for the chat skill to enter), and the ordinary bill route then runs
 * the three-way match, the duplicate check and approval as it always does.
 */
@Injectable()
export class BillCaptureService {
  private readonly logger = new Logger(BillCaptureService.name);

  constructor(
    private readonly ai: AiService,
    private readonly payables: PayablesService,
    @InjectRepository(Supplier)
    private readonly suppliers: Repository<Supplier>,
    @InjectRepository(PurchaseOrder)
    private readonly orders: Repository<PurchaseOrder>,
    @InjectRepository(SupplierBill)
    private readonly bills: Repository<SupplierBill>,
  ) {}

  async capture(
    tenantId: string,
    userId: string | undefined,
    file: CaptureFile,
    /** Whatever was typed with the file — a WhatsApp caption, say. */
    note?: string,
  ): Promise<BillCaptureResult> {
    if (!isBillCaptureContentType(file.mimeType)) {
      throw new BadRequestException(
        'Send the invoice as a PDF or a photo (JPEG, PNG or WebP).',
      );
    }
    if (
      file.buffer.length === 0 ||
      file.buffer.length > BILL_CAPTURE_MAX_BYTES
    ) {
      throw new BadRequestException(
        'The invoice file is empty or larger than 20 MB.',
      );
    }

    const { invoice, model } = await this.read(tenantId, userId, file, note);
    const result: BillCaptureResult = {
      invoice,
      supplier: null,
      supplierCandidates: [],
      purchaseOrder: null,
      orderCandidates: [],
      lines: invoice.lines.map((_, index) => ({
        index,
        purchaseOrderLineId: null,
        score: 0,
      })),
      duplicateOf: null,
      warnings: [],
      model,
      promptVersion: BILL_CAPTURE_PROMPT_VERSION,
    };

    if (!invoice.isInvoice) {
      result.warnings.push({
        code: 'NOT_AN_INVOICE',
        message:
          'This does not look like a supplier invoice — it may be a quotation, a statement or a delivery note.',
      });
      return result;
    }

    const suppliers = await this.suppliers.find({
      where: { tenantId, deletedAt: IsNull() },
      select: { id: true, companyName: true, taxId: true, currency: true },
    });
    const supplierMatch = matchSupplier(
      { name: invoice.supplierName, taxId: invoice.supplierTaxId },
      suppliers,
    );
    let supplier = supplierMatch.match;

    const openOrders = await this.orders.find({
      where: {
        tenantId,
        deletedAt: IsNull(),
        status: In(BILLABLE_ORDER_STATUSES),
      },
      select: {
        id: true,
        poNumber: true,
        supplierId: true,
        totalAmount: true,
        currency: true,
        orderDate: true,
      },
      order: { orderDate: 'DESC' },
    });

    let order = matchOrderReference(invoice.purchaseOrderReference, openOrders);
    if (order && !supplier) {
      // The order says who the supplier is better than a fuzzy name does.
      supplier = suppliers.find((s) => s.id === order!.supplierId) ?? null;
    } else if (order && supplier && order.supplierId !== supplier.id) {
      result.warnings.push({
        code: 'ORDER_OTHER_SUPPLIER',
        message: `The invoice quotes ${order.poNumber}, but that order was placed with another supplier.`,
      });
      order = null;
    } else if (invoice.purchaseOrderReference && !order) {
      result.warnings.push({
        code: 'ORDER_NOT_FOUND',
        message: `The invoice quotes order "${invoice.purchaseOrderReference}", which is not an open purchase order.`,
      });
    }

    let lines: CapturedLineMatch[] = result.lines;
    if (supplier && !order) {
      const theirs = openOrders.filter((o) => o.supplierId === supplier.id);
      const chosen = await this.guessOrder(tenantId, invoice, theirs);
      if (chosen) {
        order = chosen.order;
        lines = chosen.lines;
      } else {
        result.orderCandidates = theirs.map((o) => ({
          id: o.id,
          poNumber: o.poNumber,
          totalAmount: o.totalAmount,
          currency: o.currency,
        }));
      }
    } else if (order) {
      const billable = await this.payables.billableLines(tenantId, order.id);
      lines = matchInvoiceLines(invoice.lines, billable);
    }
    result.lines = lines;

    if (supplier) {
      result.supplier = {
        id: supplier.id,
        companyName: supplier.companyName,
        currency: supplier.currency,
      };
    } else {
      result.supplierCandidates = supplierMatch.candidates.map((s) => ({
        id: s.id,
        companyName: s.companyName,
      }));
      result.warnings.push({
        code: 'SUPPLIER_NOT_FOUND',
        message: invoice.supplierName
          ? `No supplier matches "${invoice.supplierName}". Pick one, or add them under Purchasing first.`
          : 'The supplier’s name could not be read. Pick the supplier.',
      });
    }

    if (order) {
      result.purchaseOrder = { id: order.id, poNumber: order.poNumber };
      for (const m of lines) {
        if (m.purchaseOrderLineId) continue;
        result.warnings.push({
          code: 'LINE_NOT_ON_ORDER',
          message: `"${invoice.lines[m.index].description}" is not on ${order.poNumber}; it will be entered as a charge outside the order.`,
        });
      }
    }

    if (
      supplier?.currency &&
      invoice.currency &&
      invoice.currency !== supplier.currency
    ) {
      result.warnings.push({
        code: 'CURRENCY_MISMATCH',
        message: `The invoice is in ${invoice.currency}, but ${supplier.companyName} is billed in ${supplier.currency}.`,
      });
    }

    if (supplier && invoice.supplierInvoiceNumber) {
      const duplicate = await this.bills.findOne({
        where: {
          tenantId,
          supplierId: supplier.id,
          supplierInvoiceNumber: invoice.supplierInvoiceNumber,
          deletedAt: IsNull(),
          status: Not('CANCELLED'),
        },
        select: { id: true, billNumber: true },
      });
      if (duplicate) {
        result.duplicateOf = {
          id: duplicate.id,
          billNumber: duplicate.billNumber,
        };
        result.warnings.push({
          code: 'DUPLICATE',
          message: `${supplier.companyName} invoice ${invoice.supplierInvoiceNumber} is already entered as ${duplicate.billNumber}.`,
        });
      }
    }

    result.warnings.push(...invoiceArithmeticWarnings(invoice));
    if (invoice.confidence < LOW_CONFIDENCE) {
      result.warnings.push({
        code: 'LOW_CONFIDENCE',
        message:
          'The document was hard to read. Check every figure against the original.',
      });
    }
    return result;
  }

  /**
   * The supplier's open order this invoice is most plausibly for, when it
   * quotes none. Chosen only when one order clearly fits better than the rest;
   * otherwise the person picks.
   */
  private async guessOrder<O extends { id: string }>(
    tenantId: string,
    invoice: CapturedInvoice,
    orders: O[],
  ): Promise<{ order: O; lines: CapturedLineMatch[] } | null> {
    if (orders.length === 0 || invoice.lines.length === 0) return null;

    const scored: { order: O; lines: CapturedLineMatch[]; score: number }[] =
      [];
    for (const order of orders.slice(0, ORDERS_TRIED_WITHOUT_REFERENCE)) {
      const billable = await this.payables.billableLines(tenantId, order.id);
      // Only what is still waiting to be billed can explain a new invoice.
      if (!billable.some((b) => b.qtyBillable > 0)) continue;
      const lines = matchInvoiceLines(invoice.lines, billable);
      const score = lines.reduce((acc, l) => acc + l.score, 0);
      if (score > 0) scored.push({ order, lines, score });
    }
    scored.sort((a, b) => b.score - a.score);

    const [best, next] = scored;
    if (!best) return null;
    if (next && best.score < next.score * 1.5) return null;
    return { order: best.order, lines: best.lines };
  }

  private async read(
    tenantId: string,
    userId: string | undefined,
    file: CaptureFile,
    note?: string,
  ): Promise<{ invoice: CapturedInvoice; model: string }> {
    const data = file.buffer.toString('base64');
    const documentBlock: AiContentBlock =
      file.mimeType === 'application/pdf'
        ? {
            type: 'document',
            mimeType: 'application/pdf',
            data,
            ...(file.filename ? { filename: file.filename } : {}),
          }
        : {
            type: 'image',
            mimeType: file.mimeType as
              'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data,
          };
    const instruction = note?.trim()
      ? `${BILL_CAPTURE_INSTRUCTION}\n\nThe person who sent it wrote: "${note.trim().slice(0, 500)}"`
      : BILL_CAPTURE_INSTRUCTION;

    let raw: unknown;
    let model: string;
    try {
      const result = await this.ai.generateStructured<unknown>(
        'bill.capture',
        {
          messages: [
            {
              role: 'user',
              content: [documentBlock, { type: 'text', text: instruction }],
            },
          ],
          jsonSchema: capturedInvoiceJsonSchema,
          schemaName: 'read_supplier_invoice',
          maxTokens: 4096,
        },
        { organizationId: tenantId, userId },
      );
      raw = result.data;
      model = result.model;
    } catch (err) {
      // Not configured, over budget: already worded for the person.
      if (err instanceof HttpException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Invoice read failed: ${message}`);
      throw new ServiceUnavailableException(
        'Kerf could not read the invoice just now. Try again, or enter the bill by hand.',
      );
    }

    const parsed = capturedInvoiceSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        `Invoice read returned malformed data: ${parsed.error.message}`,
      );
      throw new BadRequestException(
        'Kerf could not make sense of this invoice. Enter the bill by hand.',
      );
    }
    return { invoice: parsed.data, model };
  }
}
