import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Not, QueryFailedError, Repository } from 'typeorm';
import {
  expectedUaeRate,
  isUaeVatMode,
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
  treatmentAllowed,
  treatmentIsReverseCharge,
} from '@saas/shared';
import { CatalogItem } from '../catalog/entities/catalog-item.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CreditNote } from '../credits/entities/credit-note.entity';
import { Organization } from '../organizations/entities/organization.entity';
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
  treatment: row.treatment,
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
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
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
    payload: TaxCodePayload,
  ): Promise<TaxCodeDto> {
    const input = await this.assertCodeShape(tenantId, payload);
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
    payload: TaxCodePayload,
  ): Promise<TaxCodeDto> {
    const input = await this.assertCodeShape(tenantId, payload);
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

  /**
   * The purchase code a document carries — the one chosen, else the supplier's
   * from the purchase rules — and the percentage it adds to a net amount.
   * Reverse-charge codes add nothing (the buyer self-accounts); exempt and
   * zero-rated codes have a rate of 0.
   */
  async purchaseTaxFor(
    tenantId: string,
    taxCodeId: string | null | undefined,
    supplierId: string | null | undefined,
  ): Promise<{ code: TaxCode | null; rate: number }> {
    const code = taxCodeId
      ? await this.findCode(tenantId, taxCodeId, 'PURCHASE')
      : supplierId
        ? await this.purchaseCodeForSupplier(tenantId, supplierId)
        : null;
    const rate =
      code && !code.isReverseCharge ? Math.max(0, Number(code.rate) || 0) : 0;
    return { code, rate };
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
      where: { id: customerId, tenantId },
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
    // Reported in base currency, at the rate each document was posted at —
    // the figure that reached the tax account.
    for (const invoice of invoices) {
      output.add(breakdownForInvoice(invoice), 1, invoice.fxRate ?? 1);
    }
    for (const credit of credits) {
      output.add(credit.taxBreakdown ?? [], -1, credit.fxRate ?? 1);
    }

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
        bill.fxRate ?? 1,
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

  /**
   * Checks a code before it is stored, and returns it as it should be stored.
   *
   * In UAE VAT mode the treatment decides: it must be there, allowed for the
   * kind, at the rate the treatment carries, and it — not the checkbox —
   * says whether the code is reverse charge. A purchase reverse charge or
   * import is 5% (the self-assessed tax); a sales reverse charge is a 0%
   * notice. Elsewhere the EU rule stands: reverse charge is 0%.
   */
  private async assertCodeShape(
    tenantId: string,
    input: TaxCodePayload,
  ): Promise<TaxCodePayload> {
    const organization = await this.organizations.findOne({
      where: { id: tenantId },
    });
    if (!organization || !isUaeVatMode(organization)) {
      if (input.isReverseCharge && Number(input.rate) !== 0) {
        throw new BadRequestException(
          'A reverse charge code is charged at 0% — the customer accounts for the tax',
        );
      }
      return input;
    }

    const { kind, treatment } = input;
    if (!treatment) {
      throw new BadRequestException('Choose a VAT treatment for this code');
    }
    if (!treatmentAllowed(kind, treatment)) {
      throw new BadRequestException(
        'That VAT treatment is not available for this kind of tax code',
      );
    }
    const rate = expectedUaeRate(kind, treatment);
    if (Number(input.rate) !== rate) {
      throw new BadRequestException(
        `${treatment} codes are charged at ${rate}%`,
      );
    }
    return {
      ...input,
      isReverseCharge:
        kind === 'PURCHASE'
          ? treatmentIsReverseCharge(treatment)
          : treatment === 'REVERSE_CHARGE',
    };
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

  add(lines: TaxBreakdownLine[], sign: 1 | -1, rate = 1): void {
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
      g.netC += sign * cents(line.net * rate);
      g.taxC += sign * cents(line.tax * rate);
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
