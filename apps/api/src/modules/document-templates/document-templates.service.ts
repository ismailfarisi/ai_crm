import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  DocumentTemplateConfig,
  DocumentType,
  UniversalDocumentData,
} from '@saas/shared';
import { DocumentTemplate } from './entities/document-template.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { DocumentTemplateAiService } from './document-template-ai.service';
import { DocumentPdfRendererService } from './document-pdf-renderer.service';
import type {
  CreateDocumentTemplateDto,
  UpdateDocumentTemplateDto,
} from './dto/document-template.dto';

@Injectable()
export class DocumentTemplatesService {
  constructor(
    @InjectRepository(DocumentTemplate)
    private readonly templateRepo: Repository<DocumentTemplate>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    private readonly templateAiService: DocumentTemplateAiService,
    private readonly pdfRenderer: DocumentPdfRendererService,
  ) {}

  async findAll(organizationId: string): Promise<DocumentTemplate[]> {
    return this.templateRepo.find({
      where: { tenantId: organizationId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  async findById(
    organizationId: string,
    id: string,
    repo: Repository<DocumentTemplate> = this.templateRepo,
  ): Promise<DocumentTemplate> {
    const template = await repo.findOne({
      where: { id, tenantId: organizationId },
    });

    if (!template) {
      throw new NotFoundException(
        `Document template with ID "${id}" not found`,
      );
    }

    return template;
  }

  async create(
    organizationId: string,
    userId: string,
    dto: CreateDocumentTemplateDto,
  ): Promise<DocumentTemplate> {
    const appliesTo = dto.appliesTo ?? [];
    const isDefault = dto.isDefault ?? false;

    return this.withDefaultsLocked(organizationId, async (repo) => {
      if (isDefault) {
        await this.unsetDefaultConflict(repo, organizationId, appliesTo);
      }

      const template = repo.create({
        tenantId: organizationId,
        createdById: userId,
        name: dto.name,
        description: dto.description ?? null,
        isDefault,
        appliesTo,
        config: dto.config ?? DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      });

      return repo.save(template);
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateDocumentTemplateDto,
  ): Promise<DocumentTemplate> {
    return this.withDefaultsLocked(organizationId, async (repo) => {
      const template = await this.findById(organizationId, id, repo);

      if (dto.name !== undefined) {
        template.name = dto.name;
      }
      if (dto.description !== undefined) {
        template.description = dto.description;
      }
      if (dto.config !== undefined) {
        template.config = dto.config;
      }
      if (dto.appliesTo !== undefined) {
        template.appliesTo = dto.appliesTo;
      }

      if (dto.isDefault !== undefined) {
        template.isDefault = dto.isDefault;
      }

      // Becoming a default, or a default changing what it covers, takes
      // those types (or the general slot) from whichever default held them.
      if (
        template.isDefault &&
        (dto.isDefault === true || dto.appliesTo !== undefined)
      ) {
        await this.unsetDefaultConflict(
          repo,
          organizationId,
          template.appliesTo ?? [],
          id,
        );
      }

      return repo.save(template);
    });
  }

  async delete(organizationId: string, id: string): Promise<void> {
    // Under the defaults lock: two concurrent deletes of two defaults would
    // otherwise each see the other as still covering its types.
    await this.withDefaultsLocked(organizationId, async (repo) => {
      const template = await this.findById(organizationId, id, repo);
      await this.assertNotLastDefault(repo, organizationId, template);
      await repo.remove(template);
    });
  }

  private async assertNotLastDefault(
    repo: Repository<DocumentTemplate>,
    organizationId: string,
    template: DocumentTemplate,
  ): Promise<void> {
    const id = template.id;
    if (template.isDefault) {
      const allTemplates = await repo.find({
        where: { tenantId: organizationId },
      });
      const otherDefaults = allTemplates.filter(
        (t) => t.id !== id && t.isDefault,
      );

      if (template.appliesTo && template.appliesTo.length > 0) {
        const uncoveredTypes = template.appliesTo.filter(
          (docType) =>
            !otherDefaults.some((other) => other.appliesTo?.includes(docType)),
        );

        if (uncoveredTypes.length > 0) {
          throw new BadRequestException(
            `Cannot delete template: it is the only default template for ${uncoveredTypes.join(
              ', ',
            )} without another template being designated`,
          );
        }
      } else if (otherDefaults.length === 0) {
        throw new BadRequestException(
          'Cannot delete the only default document template without another template being designated',
        );
      }
    }
  }

  async setDefault(
    organizationId: string,
    id: string,
    docTypes?: DocumentType[],
  ): Promise<DocumentTemplate> {
    return this.withDefaultsLocked(organizationId, async (repo) => {
      const template = await this.findById(organizationId, id, repo);

      if (docTypes && docTypes.length > 0) {
        template.appliesTo = docTypes;
      }
      template.isDefault = true;

      const targetTypes = template.appliesTo || [];
      if (targetTypes.length > 0) {
        await this.unsetDefaultConflict(repo, organizationId, targetTypes, id);
      } else {
        // If template covers all (empty appliesTo), clear isDefault on all other templates
        const otherTemplates = await repo.find({
          where: { tenantId: organizationId },
        });
        for (const other of otherTemplates) {
          if (other.id !== id && other.isDefault) {
            other.isDefault = false;
            await repo.save(other);
          }
        }
      }

      return repo.save(template);
    });
  }

  async resolveForDocumentType(
    organizationId: string,
    docType: DocumentType,
  ): Promise<DocumentTemplate | null> {
    const templates = await this.templateRepo.find({
      where: { tenantId: organizationId },
    });

    if (templates.length === 0) {
      return null;
    }

    // 1. Default template matching docType
    const defaultForType = templates.find(
      (t) => t.isDefault && t.appliesTo && t.appliesTo.includes(docType),
    );
    if (defaultForType) return defaultForType;

    // 2. Default template with empty appliesTo (general default)
    const generalDefault = templates.find(
      (t) => t.isDefault && (!t.appliesTo || t.appliesTo.length === 0),
    );
    if (generalDefault) return generalDefault;

    // 3. Non-default template applying to docType
    const specificType = templates.find(
      (t) => t.appliesTo && t.appliesTo.includes(docType),
    );
    if (specificType) return specificType;

    // 4. Any default template
    const anyDefault = templates.find((t) => t.isDefault);
    if (anyDefault) return anyDefault;

    return null;
  }

  async generateAi(
    organizationId: string,
    userId: string,
    prompt: string,
    baseConfig?: DocumentTemplateConfig,
  ): Promise<DocumentTemplateConfig> {
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });

    return this.templateAiService.generateOrRefine({
      organizationId,
      userId,
      prompt,
      baseConfig,
      tenantContext: {
        organizationName: org?.name,
        currency: org?.baseCurrency || 'USD',
      },
    });
  }

  async previewPdf(
    organizationId: string,
    config: DocumentTemplateConfig,
    docType: DocumentType,
  ): Promise<Buffer> {
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });

    const docData = this.buildPreviewData(org, docType);
    return this.pdfRenderer.render(docData, config);
  }

  /**
   * Runs a change to which template is default in one transaction, holding
   * a per-tenant advisory lock.
   *
   * Clearing the old default and saving the new one are two writes; apart,
   * a failure between them left a document type with no default. And the
   * invariant ("one default per document type") spans rows, so a row lock
   * cannot protect it: two concurrent setDefaults would each read the other's
   * predecessor as the one to clear, and both end up default. The advisory
   * lock serialises every default change within a tenant. Only the general
   * scope (no document types) can also be held by a unique index -
   * `uq_document_templates_general_default`; per-type scopes live in an
   * array column, which no unique index can express.
   */
  private withDefaultsLocked<T>(
    organizationId: string,
    work: (repo: Repository<DocumentTemplate>) => Promise<T>,
  ): Promise<T> {
    return this.templateRepo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `document_templates:default:${organizationId}`,
      ]);
      return work(manager.getRepository(DocumentTemplate));
    });
  }

  /**
   * Takes `types` away from every other default template. With no types -
   * a general default - retires the other general default instead, so there
   * is never more than one.
   */
  private async unsetDefaultConflict(
    repo: Repository<DocumentTemplate>,
    organizationId: string,
    types: DocumentType[],
    excludeId?: string,
  ): Promise<void> {
    const existingTemplates =
      (await repo.find({
        where: { tenantId: organizationId },
      })) ?? [];

    for (const other of existingTemplates) {
      if (other.id === excludeId || !other.isDefault) continue;
      if (types.length === 0) {
        if ((other.appliesTo ?? []).length === 0) {
          other.isDefault = false;
          await repo.save(other);
        }
        continue;
      }
      const remaining = (other.appliesTo || []).filter(
        (t) => !types.includes(t),
      );
      if (remaining.length !== (other.appliesTo || []).length) {
        other.appliesTo = remaining;
        if (remaining.length === 0) {
          other.isDefault = false;
        }
        await repo.save(other);
      }
    }
  }

  private buildPreviewData(
    org: Organization | null,
    docType: DocumentType,
  ): UniversalDocumentData {
    // The same sample the template studio previews (Meridian Packaging billing
    // Al Noor Sweets, UAE VAT at 5%), with every total worked out from the
    // rows. It used to be a US sample whose discount was counted twice.
    const orgName = org?.name || 'Meridian Packaging Co';
    const currency = org?.baseCurrency || 'AED';
    const orgAddress =
      [org?.addressLine1, org?.city, org?.country].filter(Boolean).join(', ') ||
      'Plot 14, Industrial Area 13, Sharjah, UAE';
    const vatRate = 5;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const sampleLines =
      docType === 'PURCHASE_ORDER'
        ? [
            { code: 'GB-1200', description: 'Greyboard 1200 gsm, 700×1000 sheet', quantity: 2400, unitPrice: 3.15, discount: 0 },
            { code: 'ART-157', description: 'Art paper 157 gsm wrap, 700×1000 sheet', quantity: 2600, unitPrice: 0.95, discount: 10 },
          ]
        : [
            { code: 'RB-200', description: 'Rigid box 200×150×60, gold foil lid', quantity: 5000, unitPrice: 4.6, discount: 0 },
            { code: 'EVA-2C', description: 'EVA foam insert, 2 cavities', quantity: 5000, unitPrice: 0.85, discount: 0 },
            { code: 'SLV-ML', description: 'Printed paper sleeve, matt lamination', quantity: 5000, unitPrice: 0.4, discount: 5 },
          ];
    const items = sampleLines.map((line) => ({
      ...line,
      taxRate: vatRate,
      amount: round2(line.quantity * line.unitPrice * (1 - line.discount / 100)),
    }));
    const gross = round2(sampleLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0));
    const net = round2(items.reduce((sum, line) => sum + line.amount, 0));
    const vat = round2(net * (vatRate / 100));
    const total = round2(net + vat);
    const amountPaid = docType === 'INVOICE' ? 15000 : 0;
    const balanceDue = round2(total - amountPaid);
    const openingBalance = 4200;

    const numbers: Record<DocumentType, string> = {
      INVOICE: 'INV-2026-0042',
      QUOTE: 'QT-2026-0189',
      STATEMENT: 'STM-2026-0007',
      DELIVERY_NOTE: 'DN-2026-0312',
      PURCHASE_ORDER: 'PO-2026-0095',
    };

    const docData: UniversalDocumentData = {
      type: docType,
      number: numbers[docType] || 'DOC-PREVIEW-001',
      status:
        docType === 'QUOTE'
          ? 'SENT'
          : docType === 'DELIVERY_NOTE'
            ? 'SHIPPED'
            : 'ISSUED',
      issuedAt: new Date().toISOString(),
      dueDate:
        docType === 'INVOICE'
          ? new Date(Date.now() + 30 * 86400000).toISOString()
          : undefined,
      validUntil:
        docType === 'QUOTE'
          ? new Date(Date.now() + 14 * 86400000).toISOString()
          : undefined,
      currency,
      organization: {
        name: orgName,
        address: orgAddress,
        taxId: org?.taxId || '100234567800003',
        phone: org?.phone || '+971 6 555 0142',
        email: org?.email || 'accounts@meridianpackaging.example',
        website: org?.website || 'https://meridianpackaging.example',
      },
      party:
        docType === 'PURCHASE_ORDER'
          ? {
              name: 'Gulf Board Trading LLC',
              companyName: 'Gulf Board Trading LLC',
              address: 'Warehouse 22, Al Jurf Industrial Area 2, Ajman, UAE',
              email: 'orders@gulfboard.example',
              phone: '+971 6 555 0177',
              taxId: '100456789100003',
            }
          : {
              name: 'Al Noor Sweets',
              companyName: 'Al Noor Sweets',
              address: 'Warehouse 7, Al Qusais Industrial Area 2, Dubai, UAE',
              email: 'accounts@alnoorsweets.example',
              phone: '+971 4 555 0186',
              taxId: '100398765400003',
            },
      items,
      totals: {
        // Before discounts; the Discount row takes them off.
        subtotal: gross,
        discounts: round2(gross - net),
        taxes: [{ rate: vatRate, label: `VAT (${vatRate}%)`, amount: vat }],
        total,
        amountPaid,
        balanceDue,
      },
      notes:
        docType === 'STATEMENT'
          ? 'Please review your outstanding balance. Contact accounts receivable if you have questions.'
          : 'Thank you for your business! All goods remain property of seller until payment in full.',
      paymentTerms:
        docType === 'QUOTE'
          ? 'Valid for 14 days from the issue date.'
          : 'Net 30 days. Bank transfer to the account on this invoice.',
    };

    if (docType === 'STATEMENT') {
      docData.statementSummary = {
        openingBalance,
        closingBalance: round2(openingBalance + total),
        periodFrom: new Date(Date.now() - 30 * 86400000)
          .toISOString()
          .slice(0, 10),
        periodTo: new Date().toISOString().slice(0, 10),
        aging: {
          current: total,
          days30: openingBalance,
          days60: 0,
          days90Plus: 0,
        },
      };
    }

    if (docType === 'DELIVERY_NOTE') {
      docData.secondaryParty = {
        label: 'Ship To',
        name: 'Cyberdyne Dock 3 Facility',
        address: '800 Industrial Highway, Bay 14, Portland, OR 97201',
        carrier: 'Standard Ground Freight',
        trackingReference: 'TRK-9848201-US',
      };
    }

    return docData;
  }
}
