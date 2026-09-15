import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  invoicePosition,
  LEDGER_ROLES,
  PERMISSIONS,
  scaleBreakdown,
  taxBreakdown,
  type CreateCreditNotePayload,
  type CreditNoteDto,
  type CreditNoteRefundDto,
  type JournalLineInput,
  type RefundCreditNotePayload,
  type TaxBreakdownLine,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '@/database/tenant-sequence.util';
import { LedgerService } from '../finance/ledger.service';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { taxPostingLines } from '../orders/order-provisioning';
import { cashAccountAmount, fxRateFor } from '../finance/fx';
import { NotificationsService } from '../notifications/notifications.service';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import { TaxCode } from '../tax/entities/tax.entity';
import { breakdownForInvoice } from '../tax/tax.service';
import {
  CreditNote,
  CreditNoteLine,
  CreditNoteRefund,
} from './entities/credit-note.entity';

type LineInput = Pick<
  CreditNoteLine,
  | 'sequence'
  | 'description'
  | 'qty'
  | 'unitPrice'
  | 'net'
  | 'taxRate'
  | 'taxCodeId'
  | 'taxCode'
  | 'reverseCharge'
>;

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
const round2 = (n: number) => cents(n) / 100;

/**
 * Credit notes against invoices, and refunds of money a customer is owed.
 *
 * Drafting and issuing are separate steps and separate permissions: a draft
 * changes nothing; issuing reduces what the customer owes and posts it. Every
 * issue and refund locks the invoice first, so two credit notes issued at
 * once cannot together credit more than was invoiced.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    @InjectRepository(CreditNote)
    private readonly notes: Repository<CreditNote>,
    @InjectRepository(CreditNoteLine)
    private readonly lines: Repository<CreditNoteLine>,
    @InjectRepository(CreditNoteRefund)
    private readonly refunds: Repository<CreditNoteRefund>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    private readonly ledger: LedgerService,
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  async list(tenantId: string, invoiceId?: string): Promise<CreditNoteDto[]> {
    const rows = await this.notes.find({
      where: { tenantId, ...(invoiceId ? { invoiceId } : {}) },
      order: { createdAt: 'DESC' },
      take: 500,
    });
    return this.toDtos(tenantId, rows);
  }

  async get(tenantId: string, id: string): Promise<CreditNoteDto> {
    const row = await this.notes.findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Credit note not found');
    return (await this.toDtos(tenantId, [row]))[0];
  }

  async listRefunds(
    tenantId: string,
    id: string,
  ): Promise<CreditNoteRefundDto[]> {
    const rows = await this.refunds.find({
      where: { tenantId, creditNoteId: id },
      order: { refundedAt: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      financeAccountId: r.financeAccountId,
      reference: r.reference,
      refundedAt: r.refundedAt.toISOString(),
    }));
  }

  /**
   * Drafts a credit note. Nothing is posted and the invoice does not change.
   *
   * Three ways to say what is credited:
   * - itemised lines, each at a tax rate (the invoice's, if it has one);
   * - an amount net of tax, spread across the invoice's tax codes in the
   *   proportions the invoice charged them — the usual "£50 off" case;
   * - `full`, which credits everything not already credited.
   */
  async create(
    tenantId: string,
    actorId: string,
    invoiceId: string,
    input: CreateCreditNotePayload,
  ): Promise<CreditNoteDto> {
    const invoice = await this.invoices.findOne({
      where: { id: invoiceId, tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestException(
        `${invoice.invoiceNumber} is voided; there is nothing to credit`,
      );
    }

    const invoiceBreakdown = breakdownForInvoice(invoice);
    const position = invoicePosition(invoice);
    if (position.creditable <= 0) {
      throw new BadRequestException(
        `${invoice.invoiceNumber} has already been credited in full`,
      );
    }

    let lineInputs: LineInput[];
    let breakdown: TaxBreakdownLine[];

    if (input.lines?.length) {
      const codes = await this.salesCodes(
        tenantId,
        input.lines.map((l) => l.taxCodeId),
      );
      const single = invoiceBreakdown.length === 1 ? invoiceBreakdown[0] : null;
      lineInputs = input.lines.map((line, index) => {
        const code = line.taxCodeId ? codes.get(line.taxCodeId) : undefined;
        if (line.taxCodeId && !code) {
          throw new BadRequestException(
            `Line ${index + 1} names a tax code that does not exist`,
          );
        }
        const rate = code
          ? code.isReverseCharge
            ? 0
            : Number(code.rate)
          : (line.taxRate ?? single?.rate);
        if (rate == null) {
          throw new BadRequestException(
            `Line ${index + 1} needs a tax rate: ${invoice.invoiceNumber} charged more than one`,
          );
        }
        return {
          sequence: index + 1,
          description: line.description,
          qty: line.qty,
          unitPrice: line.unitPrice,
          net: round2(line.qty * line.unitPrice),
          taxRate: rate,
          taxCodeId:
            code?.id ??
            (line.taxRate == null ? (single?.taxCodeId ?? null) : null),
          taxCode:
            code?.code ??
            (line.taxRate == null ? (single?.code ?? null) : `${rate}%`),
          reverseCharge:
            code?.isReverseCharge ??
            (line.taxRate == null ? (single?.reverseCharge ?? false) : false),
        };
      });
      breakdown = taxBreakdown(
        lineInputs.map((l) => ({
          net: l.net,
          rate: l.taxRate,
          taxCodeId: l.taxCodeId,
          code: l.taxCode,
          reverseCharge: l.reverseCharge,
        })),
      );
    } else {
      if (!invoiceBreakdown.length) {
        throw new BadRequestException(
          `${invoice.invoiceNumber} has no priced lines to credit against`,
        );
      }
      const invoiceNet = invoiceBreakdown.reduce((s, b) => s + b.net, 0);
      const invoiceTax = invoiceBreakdown.reduce((s, b) => s + b.tax, 0);
      // Credited so far, as a share of the invoice, taken off both net and tax.
      const remainingShare = position.creditable / Number(invoice.amount);
      const net = input.full
        ? round2(invoiceNet * remainingShare)
        : input.netAmount!;
      const tax = input.full
        ? round2(position.creditable - net)
        : round2(invoiceNet > 0 ? (invoiceTax * net) / invoiceNet : 0);
      breakdown = scaleBreakdown(invoiceBreakdown, { net, tax });
      lineInputs = breakdown.map((b, index) => ({
        sequence: index + 1,
        description: `${input.full ? 'Full credit' : 'Credit'} against ${invoice.invoiceNumber}${breakdown.length > 1 ? ` (${b.code})` : ''}`,
        qty: 1,
        unitPrice: b.net,
        net: b.net,
        taxRate: b.rate,
        taxCodeId: b.taxCodeId,
        taxCode: b.code,
        reverseCharge: b.reverseCharge,
      }));
    }

    const subtotal = round2(breakdown.reduce((s, b) => s + b.net, 0));
    const tax = round2(breakdown.reduce((s, b) => s + b.tax, 0));
    const total = round2(subtotal + tax);
    if (!(total > 0))
      throw new BadRequestException('A credit note has to credit something');
    if (cents(total) > cents(position.creditable)) {
      throw new BadRequestException(
        `That credits ${total.toFixed(2)}, but only ${position.creditable.toFixed(2)} of ${invoice.invoiceNumber} is left to credit`,
      );
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const note = await manager.getRepository(CreditNote).save(
        manager.getRepository(CreditNote).create({
          tenantId,
          status: 'DRAFT',
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          customerName: invoice.customerName,
          currency: invoice.currency,
          reason: input.reason,
          subtotalAmount: subtotal,
          taxAmount: tax,
          totalAmount: total,
          taxBreakdown: breakdown,
          createdById: actorId,
        }),
      );
      const lineRepo = manager.getRepository(CreditNoteLine);
      await lineRepo.save(
        lineInputs.map((l) =>
          lineRepo.create({ ...l, tenantId, creditNoteId: note.id }),
        ),
      );
      await this.notifications.notifyHolders(
        tenantId,
        PERMISSIONS.CREDIT_NOTE_APPROVE,
        {
          type: 'CREDIT_NOTE_AWAITING_APPROVAL',
          title: `A ${total.toFixed(2)} ${invoice.currency} credit against ${invoice.invoiceNumber} needs issuing`,
          body: input.reason.slice(0, 500),
          link: '/invoices',
          entityType: 'CREDIT_NOTE',
          entityId: note.id,
        },
        { manager, excludeUserId: actorId },
      );
      return note;
    });
    return this.get(tenantId, saved.id);
  }

  /**
   * Issues a draft: numbers it, reduces what the customer owes, and posts
   * Dr Sales and tax / Cr Receivables.
   *
   * The creditable amount is checked again here, against the locked invoice,
   * because another credit note may have been issued since this one was drafted.
   */
  async issue(
    tenantId: string,
    id: string,
    actorId: string,
  ): Promise<CreditNoteDto> {
    await this.dataSource.transaction(async (manager) => {
      const note = await this.lockNote(manager, tenantId, id);
      if (note.status !== 'DRAFT') {
        throw new ConflictException(
          `That credit note is already ${note.status.toLowerCase()}`,
        );
      }
      const invoice = await this.lockInvoice(manager, tenantId, note.invoiceId);
      if (invoice.status === InvoiceStatus.CANCELLED) {
        throw new BadRequestException(
          `${invoice.invoiceNumber} has been voided since this credit was drafted`,
        );
      }
      const position = invoicePosition(invoice);
      if (cents(note.totalAmount) > cents(position.creditable)) {
        throw new BadRequestException(
          `Only ${position.creditable.toFixed(2)} of ${invoice.invoiceNumber} is left to credit; this note credits ${Number(note.totalAmount).toFixed(2)}`,
        );
      }

      const number = await allocateNextSequenceValue(
        manager,
        tenantId,
        'credit_note_number',
      );
      note.creditNoteNumber = formatSequenceNumber('CN', number);
      await this.notifications.resolve(tenantId, note.id, manager);
      note.status = 'ISSUED';
      note.issuedAt = new Date();
      note.issuedById = actorId;
      await manager.getRepository(CreditNote).save(note);

      invoice.creditedAmount = round2(
        Number(invoice.creditedAmount) + Number(note.totalAmount),
      );
      const after = invoicePosition(invoice);
      if (after.balance <= 0) {
        // Nothing left to collect. The status enum has no "credited", and
        // PAID is what stops the overdue reminders.
        invoice.status = InvoiceStatus.PAID;
        invoice.paidAt = invoice.paidAt ?? new Date();
      }
      await manager.getRepository(Invoice).save(invoice);

      const description = `Credit note ${note.creditNoteNumber} against ${invoice.invoiceNumber}`;
      const taxLines = await taxPostingLines(
        manager,
        tenantId,
        note.taxBreakdown,
        Number(note.taxAmount),
        description,
        'debit',
      );
      const lines: JournalLineInput[] = [
        {
          role: LEDGER_ROLES.SALES,
          accountName: 'Sales',
          debit: Number(note.subtotalAmount),
          credit: 0,
          description,
        },
        ...taxLines,
        {
          role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
          accountName: 'Accounts Receivable',
          debit: 0,
          credit: Number(note.totalAmount),
          description,
        },
      ];
      // At the invoice's rate: a credit reverses part of what was booked, and
      // reversing it at another rate would invent an exchange difference on
      // money that never moved.
      note.fxRate = invoice.fxRate;
      await manager.getRepository(CreditNote).save(note);
      await this.post(
        manager,
        tenantId,
        `JE-${note.creditNoteNumber}`,
        note.id,
        Number(note.totalAmount),
        lines,
        { currency: invoice.currency, rate: invoice.fxRate },
      );
    });
    return this.get(tenantId, id);
  }

  async cancel(tenantId: string, id: string): Promise<CreditNoteDto> {
    await this.dataSource.transaction(async (manager) => {
      const note = await this.lockNote(manager, tenantId, id);
      if (note.status !== 'DRAFT') {
        throw new ConflictException(
          note.status === 'ISSUED'
            ? 'An issued credit note has been posted and cannot be cancelled. Raise an invoice for the amount instead.'
            : 'That credit note is already cancelled',
        );
      }
      await this.notifications.resolve(tenantId, note.id, manager);
      note.status = 'CANCELLED';
      note.cancelledAt = new Date();
      await manager.getRepository(CreditNote).save(note);
    });
    return this.get(tenantId, id);
  }

  /**
   * Pays money back. Only money actually received can be refunded: the
   * refundable amount is what the customer has paid beyond what they now owe,
   * and no more than this credit note has not already refunded.
   *
   * Dr Receivables / Cr the bank account, with the balance moved by a
   * relative UPDATE.
   */
  async refund(
    tenantId: string,
    id: string,
    actorId: string,
    input: RefundCreditNotePayload,
  ): Promise<CreditNoteDto> {
    await this.dataSource.transaction(async (manager) => {
      const note = await this.lockNote(manager, tenantId, id);
      if (note.status !== 'ISSUED') {
        throw new BadRequestException(
          'Only an issued credit note can be refunded',
        );
      }
      const invoice = await this.lockInvoice(manager, tenantId, note.invoiceId);
      const position = invoicePosition(invoice);
      const unrefunded = round2(
        Number(note.totalAmount) - Number(note.refundedAmount),
      );
      const refundable = Math.min(unrefunded, position.refundable);
      if (!(refundable > 0)) {
        throw new BadRequestException(
          position.refundable <= 0
            ? `The customer has not paid more than they owe on ${invoice.invoiceNumber}; the credit has reduced their balance instead`
            : 'This credit note has already been refunded in full',
        );
      }
      const amount = round2(input.amount ?? refundable);
      if (cents(amount) > cents(refundable)) {
        throw new BadRequestException(
          `At most ${refundable.toFixed(2)} can be refunded against this credit note`,
        );
      }

      const account = await manager
        .getRepository(FinanceAccount)
        .findOne({ where: { id: input.financeAccountId, tenantId } });
      if (!account) throw new NotFoundException('Finance account not found');

      const refundRate = await fxRateFor(
        manager,
        tenantId,
        invoice.currency,
        new Date(),
      );
      const leaving = await cashAccountAmount(manager, tenantId, account, {
        amount,
        currency: invoice.currency,
        rate: refundRate,
      });

      await manager.query(
        `UPDATE "finance_accounts" SET "balance" = "balance" - $1, "updatedAt" = now()
         WHERE "id" = $2 AND "tenantId" = $3`,
        [leaving, account.id, tenantId],
      );

      const refundRepo = manager.getRepository(CreditNoteRefund);
      const refund = await refundRepo.save(
        refundRepo.create({
          tenantId,
          creditNoteId: note.id,
          invoiceId: invoice.id,
          financeAccountId: account.id,
          amount,
          reference: input.reference,
          refundedAt: new Date(),
          recordedById: actorId,
          fxRate: refundRate,
        }),
      );

      note.refundedAmount = round2(Number(note.refundedAmount) + amount);
      await manager.getRepository(CreditNote).save(note);
      invoice.refundedAmount = round2(Number(invoice.refundedAmount) + amount);
      await manager.getRepository(Invoice).save(invoice);

      const description = `Refund against ${note.creditNoteNumber}${input.reference ? ` (${input.reference})` : ''}`;
      await this.post(
        manager,
        tenantId,
        `JE-${note.creditNoteNumber}-REF-${refund.id.slice(0, 8)}`,
        note.id,
        amount,
        [
          {
            role: LEDGER_ROLES.ACCOUNTS_RECEIVABLE,
            accountName: 'Accounts Receivable',
            debit: amount,
            credit: 0,
            fxRate: invoice.fxRate,
            description,
          },
          {
            financeAccountId: account.id,
            accountName: account.name,
            debit: 0,
            credit: amount,
            fxRate: refundRate,
            description,
          },
        ],
        { currency: invoice.currency, rate: refundRate },
      );
    });
    return this.get(tenantId, id);
  }

  /* ------------------------------------------------------------------ */

  private async salesCodes(tenantId: string, ids: (string | null)[]) {
    const wanted = ids.filter((v): v is string => Boolean(v));
    const rows = wanted.length
      ? await this.dataSource
          .getRepository(TaxCode)
          .find({ where: { tenantId, kind: 'SALES', id: In(wanted) } })
      : [];
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async lockNote(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<CreditNote> {
    const note = await manager
      .getRepository(CreditNote)
      .createQueryBuilder('cn')
      .setLock('pessimistic_write')
      .where('cn.id = :id', { id })
      .andWhere('cn.tenant_id = :tenantId', { tenantId })
      .getOne();
    if (!note) throw new NotFoundException('Credit note not found');
    return note;
  }

  private async lockInvoice(
    manager: EntityManager,
    tenantId: string,
    id: string,
  ): Promise<Invoice> {
    const invoice = await manager
      .getRepository(Invoice)
      .createQueryBuilder('i')
      .setLock('pessimistic_write')
      .where('i.id = :id', { id })
      .andWhere('i.tenant_id = :tenantId', { tenantId })
      .getOne();
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  private async post(
    manager: EntityManager,
    tenantId: string,
    entryNumber: string,
    creditNoteId: string,
    amount: number,
    lines: JournalLineInput[],
    fx: { currency: string; rate: number },
  ): Promise<void> {
    const repo = manager.getRepository(JournalEntry);
    await repo.save(
      repo.create({
        tenantId,
        entryNumber,
        referenceType: 'CREDIT_NOTE',
        referenceId: creditNoteId,
        entryDate: new Date(),
        totalAmount: amount,
        currency: fx.currency,
        fxRate: fx.rate,
        lines: await this.ledger.resolveLines(
          tenantId,
          lines,
          manager,
          fx.rate,
        ),
      }),
    );
  }

  private async toDtos(
    tenantId: string,
    rows: CreditNote[],
  ): Promise<CreditNoteDto[]> {
    if (!rows.length) return [];
    const [lines, invoices] = await Promise.all([
      this.lines.find({
        where: { tenantId, creditNoteId: In(rows.map((r) => r.id)) },
        order: { sequence: 'ASC' },
      }),
      this.invoices.find({
        where: { tenantId, id: In([...new Set(rows.map((r) => r.invoiceId))]) },
      }),
    ]);
    return rows.map((row) => ({
      id: row.id,
      creditNoteNumber: row.creditNoteNumber ?? 'Draft',
      status: row.status,
      invoiceId: row.invoiceId,
      invoiceNumber:
        invoices.find((i) => i.id === row.invoiceId)?.invoiceNumber ?? '',
      customerName: row.customerName,
      currency: row.currency,
      reason: row.reason,
      subtotalAmount: row.subtotalAmount,
      taxAmount: row.taxAmount,
      totalAmount: row.totalAmount,
      refundedAmount: row.refundedAmount,
      taxBreakdown: row.taxBreakdown,
      lines: lines
        .filter((l) => l.creditNoteId === row.id)
        .map((l) => ({
          id: l.id,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
          net: l.net,
          taxRate: l.taxRate,
          taxCodeId: l.taxCodeId,
          taxCode: l.taxCode,
          reverseCharge: l.reverseCharge,
        })),
      issuedAt: row.issuedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
