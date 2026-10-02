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
  ): Promise<DocumentTemplate> {
    const template = await this.templateRepo.findOne({
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

    if (isDefault && appliesTo.length > 0) {
      await this.unsetDefaultConflict(organizationId, appliesTo);
    }

    const template = this.templateRepo.create({
      tenantId: organizationId,
      createdById: userId,
      name: dto.name,
      description: dto.description ?? null,
      isDefault,
      appliesTo,
      config: dto.config ?? DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
    });

    return this.templateRepo.save(template);
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateDocumentTemplateDto,
  ): Promise<DocumentTemplate> {
    const template = await this.findById(organizationId, id);

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
      if (dto.isDefault) {
        const targetTypes = template.appliesTo ?? [];
        if (targetTypes.length > 0) {
          await this.unsetDefaultConflict(organizationId, targetTypes, id);
        }
        template.isDefault = true;
      } else {
        template.isDefault = false;
      }
    }

    return this.templateRepo.save(template);
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const template = await this.findById(organizationId, id);

    if (template.isDefault) {
      const allTemplates = await this.templateRepo.find({
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

    await this.templateRepo.remove(template);
  }

  async setDefault(
    organizationId: string,
    id: string,
    docTypes?: DocumentType[],
  ): Promise<DocumentTemplate> {
    const template = await this.findById(organizationId, id);

    if (docTypes && docTypes.length > 0) {
      template.appliesTo = docTypes;
    }
    template.isDefault = true;

    const targetTypes = template.appliesTo || [];
    if (targetTypes.length > 0) {
      await this.unsetDefaultConflict(organizationId, targetTypes, id);
    } else {
      // If template covers all (empty appliesTo), clear isDefault on all other templates
      const otherTemplates = await this.templateRepo.find({
        where: { tenantId: organizationId },
      });
      for (const other of otherTemplates) {
        if (other.id !== id && other.isDefault) {
          other.isDefault = false;
          await this.templateRepo.save(other);
        }
      }
    }

    return this.templateRepo.save(template);
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

  private async unsetDefaultConflict(
    organizationId: string,
    types: DocumentType[],
    excludeId?: string,
  ): Promise<void> {
    const existingTemplates = await this.templateRepo.find({
      where: { tenantId: organizationId },
    });

    for (const other of existingTemplates) {
      if (other.id !== excludeId && other.isDefault) {
        const remaining = (other.appliesTo || []).filter(
          (t) => !types.includes(t),
        );
        if (remaining.length !== (other.appliesTo || []).length) {
          other.appliesTo = remaining;
          if (remaining.length === 0) {
            other.isDefault = false;
          }
          await this.templateRepo.save(other);
        }
      }
    }
  }

  private buildPreviewData(
    org: Organization | null,
    docType: DocumentType,
  ): UniversalDocumentData {
    const orgName = org?.name || 'Acme Packaging & Supplies Ltd';
    const currency = org?.baseCurrency || 'USD';
    const orgAddress =
      [org?.addressLine1, org?.city, org?.country].filter(Boolean).join(', ') ||
      '100 Industrial Parkway, Suite 400, Chicago, IL 60601';

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
        taxId: org?.taxId || 'US-987654321',
        phone: org?.phone || '+1 (312) 555-0140',
        email: org?.email || 'billing@acmepackaging.example.com',
        website: org?.website || 'https://acmepackaging.example.com',
      },
      party:
        docType === 'PURCHASE_ORDER'
          ? {
              name: 'Raw Paperboard Mill Co',
              companyName: 'Raw Paperboard Mill Co',
              address: '500 Pulp Road, Savannah, GA 31401',
              email: 'orders@paperboardmill.example.com',
              phone: '+1 (912) 555-0199',
              taxId: 'US-112233445',
            }
          : {
              name: 'Sarah Connor',
              companyName: 'Cyberdyne Logistics Inc',
              address: '742 Evergreen Terrace, Springfield, OR 97477',
              email: 'accounts@cyberdyne.example.com',
              phone: '+1 (503) 555-0188',
              taxId: 'US-554433221',
            },
      items: [
        {
          code: 'BOX-MD-01',
          description: 'Custom Rigid Corrugated Box (12" x 12" x 8")',
          quantity: 250,
          unitPrice: 3.25,
          discount: 0,
          taxRate: 8.5,
          amount: 812.5,
        },
        {
          code: 'INS-FOAM-02',
          description: 'Anti-Static Foam Cushion Inserts',
          quantity: 250,
          unitPrice: 1.2,
          discount: 20,
          taxRate: 8.5,
          amount: 280,
        },
        {
          code: 'PRT-OFFSET',
          description: 'Spot UV & Matte Lamination Custom Printing',
          quantity: 1,
          unitPrice: 150,
          discount: 0,
          taxRate: 8.5,
          amount: 150,
        },
      ],
      totals: {
        subtotal: 1262.5,
        discounts: 20,
        taxes: [
          {
            rate: 8.5,
            label: 'State Tax (8.5%)',
            amount: 105.61,
          },
        ],
        total: 1348.11,
        amountPaid: docType === 'INVOICE' ? 500 : 0,
        balanceDue: docType === 'INVOICE' ? 848.11 : 1348.11,
      },
      notes:
        docType === 'STATEMENT'
          ? 'Please review your outstanding balance. Contact accounts receivable if you have questions.'
          : 'Thank you for your business! All goods remain property of seller until payment in full.',
      paymentTerms:
        docType === 'QUOTE'
          ? 'Estimate valid for 14 days from date of issue.'
          : 'Net 30 Days. Payments accepted via ACH or wire transfer.',
    };

    if (docType === 'STATEMENT') {
      docData.statementSummary = {
        openingBalance: 450.0,
        closingBalance: 1298.11,
        periodFrom: new Date(Date.now() - 30 * 86400000)
          .toISOString()
          .slice(0, 10),
        periodTo: new Date().toISOString().slice(0, 10),
        aging: {
          current: 848.11,
          days30: 300.0,
          days60: 150.0,
          days90Plus: 0.0,
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
