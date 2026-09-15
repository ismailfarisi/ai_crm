import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Not, QueryFailedError, Repository } from 'typeorm';
import {
  resolveTaxCode,
  scaleBreakdown,
  taxBreakdown,
  type QuoteLineItem,
  type TaxBreakdownLine,
  type TaxCodeDto,
  type TaxCodePayload,
  type TaxKind,
  type TaxParty,
  type TaxReportDto,
  type TaxReportRow,
  type TaxRuleDto,
  type TaxRulePayload,
} from '@saas/shared';
import { CatalogItem } from '../catalog/entities/catalog-item.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CreditNote } from '../credits/entities/credit-note.entity';
import { SupplierBill } from '../payables/entities/supplier-bill.entity';
import { Supplier } from '../purchasing/entities/supplier.entity';
import { Invoice, InvoiceStatus } from '../quotes/entities/invoice.entity';
import { TaxCode, TaxRule } from './entities/tax.entity';

const POSTGRES_UNIQUE_VIOLATION = '23505';
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);

export const toTaxCodeDto = (row: TaxCode): TaxCodeDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  rate: row.rate,
  kind: row.kind,
  isReverseCharge: row.isReverseCharge,
  ledgerAccountId: row.ledgerAccountId,
  isActive: row.isActive,
});

const toTaxRuleDto = (row: TaxRule): TaxRuleDto => ({
  id: row.id,
  kind: row.kind,
  country: row.country,
  requiresTaxId: row.requiresTaxId,
  taxCodeId: row.taxCodeId,
  priority: row.priority,
});

/**
 * A document's tax breakdown, from what it stores or — for documents from
 * before tax codes — from its lines, scaled to the tax it actually charged.
 */
export function breakdownForInvoice(invoice: Invoice): TaxBreakdownLine[] {
  if (invoice.taxBreakdown?.length) return invoice.taxBreakdown;
  const derived = taxBreakdown(
    (invoice.items ?? [])
      .filter((item) => (item.type ?? 'product') === 'product')
      .map((item) => ({
        net: Number(item.subtotal) || 0,
        rate: Number(item.taxRate) || 0,
        taxCodeId: item.taxCodeId ?? null,
        code: item.taxCode ?? null,
        reverseCharge: item.taxReverseCharge,
      })),
  );
  if (!derived.length) return [];
  return scaleBreakdown(derived, {
    net: Number(invoice.subtotalAmount),
    tax: Number(invoice.taxAmount),
  });
}

@Injectable()
export class TaxService {
  constructor(
    @InjectRepository(TaxCode) private readonly codes: Repository<TaxCode>,
    @InjectRepository(TaxRule) private readonly rules: Repository<TaxRule>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(Supplier)
    private readonly suppliers: Repository<Supplier>,
    @InjectRepository(CatalogItem)
    private readonly catalogItems: Repository<CatalogItem>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(CreditNote)
    private readonly creditNotes: Repository<CreditNote>,
    @InjectRepository(SupplierBill)
    private readonly bills: Repository<SupplierBill>,
  ) {}

  /* ------------------------------------------------------------------ *
   * Codes and rules
   * ------------------------------------------------------------------ */

  async listCodes(tenantId: string): Promise<TaxCodeDto[]> {
    const rows = await this.codes.find({
      where: { tenantId },
      order: { kind: 'ASC', code: 'ASC' },
    });
    return rows.map(toTaxCodeDto);
  }

  async createCode(
    tenantId: string,
    input: TaxCodePayload,
  ): Promise<TaxCodeDto> {
    this.assertCodeShape(input);
    try {
      return toTaxCodeDto(
        await this.codes.save(this.codes.create({ tenantId, ...input })),
      );
    } catch (err) {
      throw this.duplicate(
        err,
        `A ${input.kind.toLowerCase()} tax code ${input.code} already exists`,
      );
    }
  }

  /**
   * Rate changes are allowed but do not reach back: documents store the rate
   * and breakdown they were issued with. Only quotes priced after the change
   * pick it up.
   */
  async updateCode(
    tenantId: string,
    id: string,
    input: TaxCodePayload,
  ): Promise<TaxCodeDto> {
    this.assertCodeShape(input);
    const row = await this.codes.findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Tax code not found');
    Object.assign(row, input);
    try {
      return toTaxCodeDto(await this.codes.save(row));
    } catch (err) {
      throw this.duplicate(
        err,
        `A ${input.kind.toLowerCase()} tax code ${input.code} already exists`,
      );
    }
  }

  async listRules(tenantId: string): Promise<TaxRuleDto[]> {
    const rows = await this.rules.find({
      where: { tenantId },
      order: { kind: 'ASC', country: 'ASC' },
    });
    return rows.map(toTaxRuleDto);
  }

  async createRule(
    tenantId: string,
    input: TaxRulePayload,
  ): Promise<TaxRuleDto> {
    const code = await this.codes.findOne({
      where: { id: input.taxCodeId, tenantId },
    });
    if (!code) throw new NotFoundException('Tax code not found');
    if (code.kind !== input.kind) {
      throw new BadRequestException(
        `${code.code} is a ${code.kind.toLowerCase()} code and cannot be used for ${input.kind.toLowerCase()}`,
      );
    }
    try {
      return toTaxRuleDto(
        await this.rules.save(this.rules.create({ tenantId, ...input })),
      );
    } catch (err) {
      throw this.duplicate(
        err,
        `There is already a ${input.kind.toLowerCase()} rule for ${input.country}${input.requiresTaxId ? ' with a tax number' : ''}`,
      );
    }
  }

  async deleteRule(tenantId: string, id: string): Promise<void> {
    const result = await this.rules.delete({ id, tenantId });
    if (!result.affected) throw new NotFoundException('Tax rule not found');
  }

  /* ------------------------------------------------------------------ *
   * Applying
   * ------------------------------------------------------------------ */

  /**
   * Puts the right tax code on every priced line of a quote.
   *
   * The customer's rule decides the treatment. A catalog item's own code
   * still applies under a standard-rate rule — zero-rated books stay
   * zero-rated at home — but a reverse-charge or zero-rated rule overrides
   * it, because an export is an export whatever is being exported.
   *
   * With no rules and no item codes, lines come back exactly as they went in.
   * A code id the client sent is never trusted: it is re-resolved here or
   * dropped.
   */
  async applyToLines(
    tenantId: string,
    items: QuoteLineItem[],
    customerId: string | null,
  ): Promise<QuoteLineItem[]> {
    const [codes, rules] = await Promise.all([
      this.codes.find({ where: { tenantId, kind: 'SALES', isActive: true } }),
      this.rules.find({ where: { tenantId, kind: 'SALES' } }),
    ]);
    const codeById = new Map(codes.map((c) => [c.id, c]));

    const catalogIds = [
      ...new Set(
        items
          .map((i) => i.catalogItemId)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    const catalog = catalogIds.length
      ? await this.catalogItems.find({
          where: { tenantId, id: In(catalogIds) },
        })
      : [];
    const itemCode = new Map(catalog.map((c) => [c.id, c.taxCodeId]));

    const party = await this.partyForCustomer(tenantId, customerId);
    const resolved = party
      ? resolveTaxCode(
          party,
          'SALES',
          rules.map(toTaxRuleDto),
          codes.map(toTaxCodeDto),
        )
      : null;
    const ruleCode = resolved ? (codeById.get(resolved.code.id) ?? null) : null;

    return items.map((item) => {
      if ((item.type ?? 'product') !== 'product') return item;
      const rest = { ...item };
      delete rest.taxCodeId;
      delete rest.taxCode;
      delete rest.taxReverseCharge;

      const ownCode = item.catalogItemId
        ? codeById.get(itemCode.get(item.catalogItemId) ?? '')
        : undefined;
      const overriding =
        ruleCode && (ruleCode.isReverseCharge || Number(ruleCode.rate) === 0);
      const chosen = overriding ? ruleCode : (ownCode ?? ruleCode);
      if (!chosen) return rest;

      return {
        ...rest,
        taxCodeId: chosen.id,
        taxCode: chosen.code,
        taxRate: chosen.isReverseCharge ? 0 : Number(chosen.rate),
        taxReverseCharge: chosen.isReverseCharge,
      };
    });
  }

  /** The purchase code for a supplier, from the purchase rules. */
  async purchaseCodeForSupplier(
    tenantId: string,
    supplierId: string,
  ): Promise<TaxCode | null> {
    const supplier = await this.suppliers.findOne({
      where: { id: supplierId, tenantId },
    });
    if (!supplier) return null;
    const [codes, rules] = await Promise.all([
      this.codes.find({
        where: { tenantId, kind: 'PURCHASE', isActive: true },
      }),
      this.rules.find({ where: { tenantId, kind: 'PURCHASE' } }),
    ]);
    const resolved = resolveTaxCode(
      { country: supplier.country, taxId: supplier.taxId },
      'PURCHASE',
      rules.map(toTaxRuleDto),
      codes.map(toTaxCodeDto),
    );
    return resolved
      ? (codes.find((c) => c.id === resolved.code.id) ?? null)
      : null;
  }

  async findCode(
    tenantId: string,
    id: string,
    kind: TaxKind,
  ): Promise<TaxCode> {
    const code = await this.codes.findOne({ where: { id, tenantId, kind } });
    if (!code)
      throw new NotFoundException(
        `That ${kind.toLowerCase()} tax code does not exist`,
      );
    return code;
  }

  private async partyForCustomer(
    tenantId: string,
    customerId: string | null,
  ): Promise<TaxParty | null> {
    if (!customerId) return null;
    const customer = await this.customers.findOne({
      where: { id: customerId, organizationId: tenantId },
    });
    return customer
      ? { country: customer.country, taxId: customer.taxId }
      : null;
  }

  /* ------------------------------------------------------------------ *
   * The report
   * ------------------------------------------------------------------ */

  /**
   * Output and input tax for a period, by code.
   *
   * Sales are counted when invoiced and credits when issued, each in its own
   * period — a credit in March for a January sale reduces March's output tax,
   * which is how a return is filed. Purchases are counted when the bill is
   * approved, the point at which it becomes a liability in these books.
   */
  async report(tenantId: string, from: Date, to: Date): Promise<TaxReportDto> {
    if (!(to > from))
      throw new BadRequestException(
        'The end of the period must be after the start',
      );

    const [invoices, credits, bills, purchaseCodes] = await Promise.all([
      this.invoices.find({
        where: {
          tenantId,
          issuedAt: Between(from, to),
          status: Not(InvoiceStatus.CANCELLED),
        },
      }),
      this.creditNotes.find({
        where: { tenantId, status: 'ISSUED', issuedAt: Between(from, to) },
      }),
      this.bills.find({
        where: {
          tenantId,
          approvedAt: Between(from, to),
          status: In(['APPROVED', 'PARTIALLY_PAID', 'PAID']),
        },
      }),
      this.codes.find({ where: { tenantId, kind: 'PURCHASE' } }),
    ]);

    const output = new Accumulator();
    for (const invoice of invoices) output.add(breakdownForInvoice(invoice), 1);
    for (const credit of credits) output.add(credit.taxBreakdown ?? [], -1);

    const input = new Accumulator();
    const purchaseById = new Map(purchaseCodes.map((c) => [c.id, c]));
    for (const bill of bills) {
      const code = bill.taxCodeId
        ? purchaseById.get(bill.taxCodeId)
        : undefined;
      input.add(
        [
          {
            taxCodeId: code?.id ?? null,
            code: code?.code ?? 'Uncoded',
            rate: code ? Number(code.rate) : 0,
            reverseCharge: code?.isReverseCharge ?? false,
            net: Number(bill.subtotalAmount),
            tax: Number(bill.taxAmount),
          },
        ],
        1,
      );
    }

    const outputRows = output.rows();
    const inputRows = input.rows();
    const outputTax = sum(outputRows.map((r) => r.tax));
    const inputTax = sum(inputRows.map((r) => r.tax));
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      output: outputRows,
      input: inputRows,
      outputTax,
      inputTax,
      netPayable: sum([outputTax, -inputTax]),
      reverseChargeNet: sum(
        outputRows.filter((r) => r.reverseCharge).map((r) => r.net),
      ),
    };
  }

  private assertCodeShape(input: TaxCodePayload): void {
    if (input.isReverseCharge && Number(input.rate) !== 0) {
      throw new BadRequestException(
        'A reverse charge code is charged at 0% — the customer accounts for the tax',
      );
    }
  }

  private duplicate(err: unknown, message: string): unknown {
    const code = (err as { code?: string }).code;
    return err instanceof QueryFailedError && code === POSTGRES_UNIQUE_VIOLATION
      ? new ConflictException(message)
      : err;
  }
}

const sum = (values: number[]) =>
  cents(values.reduce((s, v) => s + cents(v), 0) / 100) / 100;

class Accumulator {
  private readonly groups = new Map<
    string,
    TaxReportRow & { netC: number; taxC: number }
  >();

  add(lines: TaxBreakdownLine[], sign: 1 | -1): void {
    const seen = new Set<string>();
    for (const line of lines) {
      const key = `${line.taxCodeId ?? line.code}|${line.rate}|${line.reverseCharge}`;
      const g = this.groups.get(key) ?? {
        taxCodeId: line.taxCodeId,
        code: line.code,
        rate: line.rate,
        reverseCharge: line.reverseCharge,
        net: 0,
        tax: 0,
        documents: 0,
        netC: 0,
        taxC: 0,
      };
      g.netC += sign * cents(line.net);
      g.taxC += sign * cents(line.tax);
      if (!seen.has(key)) g.documents += 1;
      seen.add(key);
      this.groups.set(key, g);
    }
  }

  rows(): TaxReportRow[] {
    return [...this.groups.values()]
      .map(({ netC, taxC, ...g }) => ({
        ...g,
        net: netC / 100,
        tax: taxC / 100,
      }))
      .sort((a, b) => b.rate - a.rate || a.code.localeCompare(b.code));
  }
}
