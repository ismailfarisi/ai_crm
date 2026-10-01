import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  DocumentTemplateConfig,
  DocumentType,
} from '@saas/shared';
import { DocumentTemplatesService } from './document-templates.service';
import { DocumentTemplate } from './entities/document-template.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { DocumentTemplateAiService } from './document-template-ai.service';
import { DocumentPdfRendererService } from './document-pdf-renderer.service';

describe('DocumentTemplatesService', () => {
  let service: DocumentTemplatesService;
  let mockTemplateRepo: any;
  let mockOrgRepo: any;
  let mockAiService: any;
  let mockPdfRenderer: any;

  const orgId = 'org-111';
  const userId = 'user-222';

  const sampleTemplate: DocumentTemplate = {
    id: 'tmpl-1',
    tenantId: orgId,
    name: 'Modern Blue Invoice',
    description: 'Clean modern invoice template',
    isDefault: true,
    appliesTo: ['INVOICE', 'QUOTE'],
    config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    createdById: userId,
  };

  const sampleOrg: Partial<Organization> = {
    id: orgId,
    name: 'Acme Paper & Print Ltd',
    baseCurrency: 'USD',
    taxId: 'US-999888777',
    addressLine1: '123 Printway Ave',
    city: 'Metropolis',
    country: 'US',
    phone: '+1 555 123 4567',
    email: 'billing@acmeprint.com',
    website: 'https://acmeprint.example.com',
  };

  beforeEach(() => {
    mockTemplateRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((entity) => ({ ...entity })),
      save: jest.fn((entity) =>
        Promise.resolve({ id: entity.id || 'tmpl-new', ...entity }),
      ),
      remove: jest.fn((entity) => Promise.resolve(entity)),
    };

    mockOrgRepo = {
      findOne: jest.fn().mockResolvedValue(sampleOrg),
    };

    mockAiService = {
      generateOrRefine: jest.fn().mockResolvedValue({
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        branding: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
          primaryColor: '#0f172a',
        },
      }),
    };

    mockPdfRenderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test preview')),
    };

    service = new DocumentTemplatesService(
      mockTemplateRepo,
      mockOrgRepo,
      mockAiService,
      mockPdfRenderer,
    );
  });

  describe('findAll', () => {
    it('should return all templates for the tenant organization', async () => {
      mockTemplateRepo.find.mockResolvedValue([sampleTemplate]);

      const result = await service.findAll(orgId);

      expect(mockTemplateRepo.find).toHaveBeenCalledWith({
        where: { tenantId: orgId },
        order: { isDefault: 'DESC', createdAt: 'DESC' },
      });
      expect(result).toEqual([sampleTemplate]);
    });
  });

  describe('findById', () => {
    it('should return the template if it exists within the organization', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(sampleTemplate);

      const result = await service.findById(orgId, 'tmpl-1');

      expect(mockTemplateRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'tmpl-1', tenantId: orgId },
      });
      expect(result).toEqual(sampleTemplate);
    });

    it('should throw NotFoundException if template not found', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(null);

      await expect(service.findById(orgId, 'tmpl-missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create and save a new template', async () => {
      const dto = {
        name: 'Classic Delivery Slip',
        description: 'Simple packing slip',
        isDefault: false,
        appliesTo: ['DELIVERY_NOTE' as DocumentType],
        config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      };

      const result = await service.create(orgId, userId, dto);

      expect(mockTemplateRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: orgId,
          createdById: userId,
          name: 'Classic Delivery Slip',
          isDefault: false,
          appliesTo: ['DELIVERY_NOTE'],
        }),
      );
      expect(mockTemplateRepo.save).toHaveBeenCalled();
      expect(result.name).toBe('Classic Delivery Slip');
    });

    it('should use default config if config is not provided', async () => {
      const dto = {
        name: 'Minimal Template',
      };

      await service.create(orgId, userId, dto);

      expect(mockTemplateRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        }),
      );
    });

    it('should adjust existing default templates if new template is set as default', async () => {
      const existingDefault: DocumentTemplate = {
        ...sampleTemplate,
        id: 'tmpl-1',
        isDefault: true,
        appliesTo: ['INVOICE', 'QUOTE'],
      };

      mockTemplateRepo.find.mockResolvedValue([existingDefault]);

      const dto = {
        name: 'New Default Invoice',
        isDefault: true,
        appliesTo: ['INVOICE' as DocumentType],
        config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      };

      await service.create(orgId, userId, dto);

      // Existing default should have INVOICE removed, keeping QUOTE
      expect(mockTemplateRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tmpl-1',
          appliesTo: ['QUOTE'],
          isDefault: true,
        }),
      );
    });
  });

  describe('update', () => {
    it('should update and save the template', async () => {
      mockTemplateRepo.findOne.mockResolvedValue({ ...sampleTemplate });

      const result = await service.update(orgId, 'tmpl-1', {
        name: 'Updated Template Name',
      });

      expect(mockTemplateRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Updated Template Name',
        }),
      );
      expect(result.name).toBe('Updated Template Name');
    });

    it('should throw NotFoundException if template does not exist', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update(orgId, 'tmpl-missing', { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should adjust other default templates when updating a template to default', async () => {
      const templateToUpdate: DocumentTemplate = {
        ...sampleTemplate,
        id: 'tmpl-2',
        isDefault: false,
        appliesTo: ['STATEMENT'],
      };
      const existingDefault: DocumentTemplate = {
        ...sampleTemplate,
        id: 'tmpl-1',
        isDefault: true,
        appliesTo: ['STATEMENT', 'QUOTE'],
      };

      mockTemplateRepo.findOne.mockResolvedValue({ ...templateToUpdate });
      mockTemplateRepo.find.mockResolvedValue([existingDefault]);

      await service.update(orgId, 'tmpl-2', {
        isDefault: true,
        appliesTo: ['STATEMENT'],
      });

      expect(mockTemplateRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tmpl-1',
          appliesTo: ['QUOTE'],
          isDefault: true,
        }),
      );
    });
  });

  describe('delete & default guardrails', () => {
    it('should delete a non-default template', async () => {
      const nonDefaultTemplate = {
        ...sampleTemplate,
        id: 'tmpl-non-default',
        isDefault: false,
      };
      mockTemplateRepo.findOne.mockResolvedValue(nonDefaultTemplate);

      await service.delete(orgId, 'tmpl-non-default');

      expect(mockTemplateRepo.remove).toHaveBeenCalledWith(nonDefaultTemplate);
    });

    it('should throw NotFoundException if template does not exist', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(null);

      await expect(service.delete(orgId, 'tmpl-missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when trying to delete the only default template', async () => {
      mockTemplateRepo.findOne.mockResolvedValue({ ...sampleTemplate });
      // No other templates in organization
      mockTemplateRepo.find.mockResolvedValue([{ ...sampleTemplate }]);

      await expect(service.delete(orgId, 'tmpl-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockTemplateRepo.remove).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if deleting a default leaves an appliesTo docType without a default', async () => {
      const defaultInvoiceAndQuote = {
        ...sampleTemplate,
        id: 'tmpl-1',
        isDefault: true,
        appliesTo: ['INVOICE', 'QUOTE'],
      };
      const otherDefault = {
        ...sampleTemplate,
        id: 'tmpl-2',
        isDefault: true,
        appliesTo: ['INVOICE'], // covers INVOICE, but QUOTE has no other default!
      };

      mockTemplateRepo.findOne.mockResolvedValue(defaultInvoiceAndQuote);
      mockTemplateRepo.find.mockResolvedValue([
        defaultInvoiceAndQuote,
        otherDefault,
      ]);

      await expect(service.delete(orgId, 'tmpl-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockTemplateRepo.remove).not.toHaveBeenCalled();
    });

    it('should allow deleting a default template if all its document types have another default designated', async () => {
      const defaultToDel = {
        ...sampleTemplate,
        id: 'tmpl-1',
        isDefault: true,
        appliesTo: ['INVOICE'],
      };
      const anotherDefault = {
        ...sampleTemplate,
        id: 'tmpl-2',
        isDefault: true,
        appliesTo: ['INVOICE', 'QUOTE'], // also covers INVOICE!
      };

      mockTemplateRepo.findOne.mockResolvedValue(defaultToDel);
      mockTemplateRepo.find.mockResolvedValue([defaultToDel, anotherDefault]);

      await service.delete(orgId, 'tmpl-1');

      expect(mockTemplateRepo.remove).toHaveBeenCalledWith(defaultToDel);
    });
  });

  describe('setDefault', () => {
    it('should designate a template as default and update appliesTo', async () => {
      const targetTemplate: DocumentTemplate = {
        ...sampleTemplate,
        id: 'tmpl-2',
        isDefault: false,
        appliesTo: [],
      };
      const existingDefault: DocumentTemplate = {
        ...sampleTemplate,
        id: 'tmpl-1',
        isDefault: true,
        appliesTo: ['INVOICE', 'QUOTE'],
      };

      mockTemplateRepo.findOne.mockResolvedValue({ ...targetTemplate });
      mockTemplateRepo.find.mockResolvedValue([existingDefault]);

      const result = await service.setDefault(orgId, 'tmpl-2', ['INVOICE']);

      expect(result.isDefault).toBe(true);
      expect(result.appliesTo).toEqual(['INVOICE']);

      // Existing default should have INVOICE removed
      expect(mockTemplateRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tmpl-1',
          appliesTo: ['QUOTE'],
          isDefault: true,
        }),
      );
    });

    it('should set other template isDefault to false if all its appliesTo types were transferred', async () => {
      const targetTemplate: DocumentTemplate = {
        ...sampleTemplate,
        id: 'tmpl-2',
        isDefault: false,
        appliesTo: [],
      };
      const existingDefault: DocumentTemplate = {
        ...sampleTemplate,
        id: 'tmpl-1',
        isDefault: true,
        appliesTo: ['INVOICE'],
      };

      mockTemplateRepo.findOne.mockResolvedValue({ ...targetTemplate });
      mockTemplateRepo.find.mockResolvedValue([existingDefault]);

      await service.setDefault(orgId, 'tmpl-2', ['INVOICE']);

      // Existing default has no types left, so isDefault becomes false
      expect(mockTemplateRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tmpl-1',
          appliesTo: [],
          isDefault: false,
        }),
      );
    });

    it('should throw NotFoundException if template to set default is not found', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(null);

      await expect(
        service.setDefault(orgId, 'tmpl-missing', ['INVOICE']),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolveForDocumentType', () => {
    it('should resolve default template specifically applying to the document type', async () => {
      const quoteDefault = {
        ...sampleTemplate,
        id: 'tmpl-quote',
        isDefault: true,
        appliesTo: ['QUOTE'],
      };
      const invoiceDefault = {
        ...sampleTemplate,
        id: 'tmpl-inv',
        isDefault: true,
        appliesTo: ['INVOICE'],
      };

      mockTemplateRepo.find.mockResolvedValue([quoteDefault, invoiceDefault]);

      const result = await service.resolveForDocumentType(orgId, 'QUOTE');

      expect(result).toEqual(quoteDefault);
    });

    it('should fallback to general default template if no specific docType match', async () => {
      const generalDefault = {
        ...sampleTemplate,
        id: 'tmpl-gen',
        isDefault: true,
        appliesTo: [],
      };

      mockTemplateRepo.find.mockResolvedValue([generalDefault]);

      const result = await service.resolveForDocumentType(
        orgId,
        'PURCHASE_ORDER',
      );

      expect(result).toEqual(generalDefault);
    });

    it('should fallback to any template applying to docType if not default', async () => {
      const nonDefaultTypeMatch = {
        ...sampleTemplate,
        id: 'tmpl-match',
        isDefault: false,
        appliesTo: ['STATEMENT'],
      };

      mockTemplateRepo.find.mockResolvedValue([nonDefaultTypeMatch]);

      const result = await service.resolveForDocumentType(orgId, 'STATEMENT');

      expect(result).toEqual(nonDefaultTypeMatch);
    });

    it('should return null if no templates exist in organization', async () => {
      mockTemplateRepo.find.mockResolvedValue([]);

      const result = await service.resolveForDocumentType(orgId, 'INVOICE');

      expect(result).toBeNull();
    });
  });

  describe('generateAi', () => {
    it('should call DocumentTemplateAiService with organization context and return config', async () => {
      const prompt = 'Navy blue corporate layout with compact density';
      const baseConfig = DEFAULT_DOCUMENT_TEMPLATE_CONFIG;

      const result = await service.generateAi(
        orgId,
        userId,
        prompt,
        baseConfig,
      );

      expect(mockOrgRepo.findOne).toHaveBeenCalledWith({
        where: { id: orgId },
      });
      expect(mockAiService.generateOrRefine).toHaveBeenCalledWith({
        organizationId: orgId,
        userId,
        prompt,
        baseConfig,
        tenantContext: {
          organizationName: 'Acme Paper & Print Ltd',
          currency: 'USD',
        },
      });
      expect(result.branding.primaryColor).toBe('#0f172a');
    });
  });

  describe('previewPdf', () => {
    it('should construct mock data for INVOICE and render PDF buffer', async () => {
      const config: DocumentTemplateConfig = DEFAULT_DOCUMENT_TEMPLATE_CONFIG;

      const buffer = await service.previewPdf(orgId, config, 'INVOICE');

      expect(mockPdfRenderer.render).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'INVOICE',
          number: expect.stringContaining('INV'),
          currency: 'USD',
          organization: expect.objectContaining({
            name: 'Acme Paper & Print Ltd',
          }),
          party: expect.objectContaining({
            name: expect.any(String),
          }),
          items: expect.any(Array),
          totals: expect.objectContaining({
            total: expect.any(Number),
          }),
        }),
        config,
      );
      expect(buffer).toBeInstanceOf(Buffer);
    });

    it('should construct mock data for STATEMENT with statementSummary and render PDF', async () => {
      const config: DocumentTemplateConfig = DEFAULT_DOCUMENT_TEMPLATE_CONFIG;

      await service.previewPdf(orgId, config, 'STATEMENT');

      expect(mockPdfRenderer.render).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'STATEMENT',
          statementSummary: expect.objectContaining({
            openingBalance: expect.any(Number),
            closingBalance: expect.any(Number),
            aging: expect.any(Object),
          }),
        }),
        config,
      );
    });

    it('should construct mock data for DELIVERY_NOTE with secondaryParty and render PDF', async () => {
      const config: DocumentTemplateConfig = DEFAULT_DOCUMENT_TEMPLATE_CONFIG;

      await service.previewPdf(orgId, config, 'DELIVERY_NOTE');

      expect(mockPdfRenderer.render).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'DELIVERY_NOTE',
          secondaryParty: expect.objectContaining({
            label: 'Ship To',
          }),
        }),
        config,
      );
    });
  });
});
