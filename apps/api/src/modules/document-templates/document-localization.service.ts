import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  resolveDocumentLanguage,
  type DocumentLanguage,
  type DocumentTemplateConfig,
  type DocumentType,
  type UniversalDocumentData,
} from '@saas/shared';
import { In, Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { SalesOrderLine } from '../orders/entities/sales-order.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { Quote } from '../quotes/entities/quote.entity';
import { DocumentTemplatesService } from './document-templates.service';

const blank = (value: string | null | undefined) => value?.trim() || undefined;

/**
 * Fills in what an Arabic or bilingual document needs and the per-document
 * services do not load themselves: the organisation's Arabic legal name and
 * address, the customer's Arabic name and address, and the language — the
 * customer's preference, else the template's.
 */
@Injectable()
export class DocumentLocalizationService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(Customer)
    private readonly customers: Repository<Customer>,
    @InjectRepository(SalesOrderLine)
    private readonly orderLines: Repository<SalesOrderLine>,
    @InjectRepository(Quote)
    private readonly quotes: Repository<Quote>,
    private readonly templates: DocumentTemplatesService,
  ) {}

  /** The customer's Arabic name and language, for pages that are not PDFs. */
  async forCustomer(
    tenantId: string,
    customerId: string | null | undefined,
    docType: DocumentType,
  ): Promise<{ language: DocumentLanguage; customer: Customer | null }> {
    const [customer, template] = await Promise.all([
      customerId
        ? this.customers.findOne({ where: { id: customerId, tenantId } })
        : Promise.resolve(null),
      this.templates.resolveForDocumentType(tenantId, docType),
    ]);
    return {
      language: resolveDocumentLanguage(
        customer?.documentLanguage,
        template?.config?.localization?.language,
      ),
      customer,
    };
  }

  /**
   * Arabic descriptions for delivery-note lines, keyed by sales-order line.
   * Order lines keep only the English text, so the Arabic comes from the
   * quote line each one was provisioned from.
   */
  async orderLineDescriptionsAr(
    tenantId: string,
    quoteId: string | null | undefined,
    salesOrderLineIds: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!quoteId || !salesOrderLineIds.length) return result;
    const [quote, lines] = await Promise.all([
      this.quotes.findOne({ where: { id: quoteId, tenantId } }),
      this.orderLines.find({
        where: { id: In(salesOrderLineIds), tenantId },
      }),
    ]);
    const arabicByQuoteLine = new Map(
      (quote?.items ?? [])
        .filter((item) => blank(item.descriptionAr))
        .map((item) => [item.id, item.descriptionAr!.trim()]),
    );
    for (const line of lines) {
      const arabic = line.quoteLineId
        ? arabicByQuoteLine.get(line.quoteLineId)
        : undefined;
      if (arabic) result.set(line.id, arabic);
    }
    return result;
  }

  async localize(
    tenantId: string,
    customerId: string | null | undefined,
    docData: UniversalDocumentData,
    config: DocumentTemplateConfig | null | undefined,
  ): Promise<UniversalDocumentData> {
    const [organization, customer] = await Promise.all([
      this.organizations.findOne({ where: { id: tenantId } }),
      customerId
        ? this.customers.findOne({ where: { id: customerId, tenantId } })
        : Promise.resolve(null),
    ]);
    return localizeDocument(docData, config, organization, customer);
  }
}

export function localizeDocument(
  docData: UniversalDocumentData,
  config: DocumentTemplateConfig | null | undefined,
  organization: Pick<Organization, 'legalNameAr' | 'addressAr'> | null,
  customer: Pick<
    Customer,
    'companyNameAr' | 'addressAr' | 'documentLanguage'
  > | null,
): UniversalDocumentData {
  const language = resolveDocumentLanguage(
    customer?.documentLanguage,
    config?.localization?.language,
  );
  const result: UniversalDocumentData = {
    ...docData,
    language,
    organization: {
      ...docData.organization,
      nameAr: docData.organization.nameAr ?? blank(organization?.legalNameAr),
      addressAr:
        docData.organization.addressAr ?? blank(organization?.addressAr),
    },
  };
  if (customer) {
    result.party = {
      ...docData.party,
      nameAr: docData.party.nameAr ?? blank(customer.companyNameAr),
      addressAr: docData.party.addressAr ?? blank(customer.addressAr),
    };
    // A delivery note's ship-to is the customer; its address is the site's.
    if (docData.secondaryParty?.name === docData.party.name) {
      result.secondaryParty = {
        ...docData.secondaryParty,
        nameAr: docData.secondaryParty.nameAr ?? blank(customer.companyNameAr),
      };
    }
  }
  return result;
}
