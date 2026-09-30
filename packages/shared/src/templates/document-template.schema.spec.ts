import { describe, it, expect } from 'vitest';
import {
  documentTemplateConfigSchema,
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  universalDocumentDataSchema,
  documentTypeSchema,
  generateTemplateAiSchema,
  PERMISSIONS,
  permissionsForSystemRole,
  SYSTEM_ROLES,
} from '../index';

describe('Document Template Schema & Permissions', () => {
  describe('RBAC permissions', () => {
    it('should expose template permissions', () => {
      expect(PERMISSIONS.DOCUMENT_TEMPLATE_READ).toBe('template:read');
      expect(PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE).toBe('template:manage');
    });

    it('should grant DOCUMENT_TEMPLATE_MANAGE and DOCUMENT_TEMPLATE_READ to admin', () => {
      const adminPerms = permissionsForSystemRole(SYSTEM_ROLES.ADMIN);
      expect(adminPerms).toContain(PERMISSIONS.DOCUMENT_TEMPLATE_READ);
      expect(adminPerms).toContain(PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE);
    });

    it('should grant DOCUMENT_TEMPLATE_READ but not DOCUMENT_TEMPLATE_MANAGE to standard staff roles', () => {
      for (const role of [SYSTEM_ROLES.MANAGER, SYSTEM_ROLES.MEMBER, SYSTEM_ROLES.VIEWER]) {
        const perms = permissionsForSystemRole(role);
        expect(perms).toContain(PERMISSIONS.DOCUMENT_TEMPLATE_READ);
        expect(perms).not.toContain(PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE);
      }
    });
  });

  describe('documentTypeSchema', () => {
    it('should accept valid document types', () => {
      const validTypes = ['INVOICE', 'QUOTE', 'STATEMENT', 'DELIVERY_NOTE', 'PURCHASE_ORDER'];
      for (const type of validTypes) {
        expect(documentTypeSchema.parse(type)).toBe(type);
      }
    });

    it('should reject invalid document types', () => {
      expect(() => documentTypeSchema.parse('RECEIPT')).toThrow();
      expect(() => documentTypeSchema.parse('CONTRACT')).toThrow();
      expect(() => documentTypeSchema.parse('')).toThrow();
    });
  });

  describe('documentTemplateConfigSchema & DEFAULT_DOCUMENT_TEMPLATE_CONFIG', () => {
    it('should validate DEFAULT_DOCUMENT_TEMPLATE_CONFIG against schema', () => {
      const result = documentTemplateConfigSchema.safeParse(DEFAULT_DOCUMENT_TEMPLATE_CONFIG);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.branding.primaryColor).toBe('#1e3a8a');
        expect(result.data.branding.secondaryColor).toBe('#64748b');
        expect(result.data.branding.fontFamily).toBe('Helvetica');
        expect(result.data.header.layout).toBe('split');
        expect(result.data.parties.billToLabel).toBe('Bill To');
        expect(result.data.itemsTable.showLineTotal).toBe(true);
        expect(result.data.totals.showSubtotal).toBe(true);
        expect(result.data.footer.showPageNumbers).toBe(true);
      }
    });

    it('should reject invalid hex colors in branding or itemsTable', () => {
      const invalidPrimary = {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        branding: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
          primaryColor: 'not-a-color',
        },
      };
      expect(documentTemplateConfigSchema.safeParse(invalidPrimary).success).toBe(false);

      const invalidSecondary = {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        branding: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
          secondaryColor: '#12345',
        },
      };
      expect(documentTemplateConfigSchema.safeParse(invalidSecondary).success).toBe(false);

      const invalidTableHeader = {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        itemsTable: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.itemsTable,
          headerBackgroundColor: 'blue',
        },
      };
      expect(documentTemplateConfigSchema.safeParse(invalidTableHeader).success).toBe(false);
    });

    it('should reject invalid fonts in config', () => {
      const invalidFont = {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        branding: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
          fontFamily: 'Comic Sans',
        },
      };
      expect(documentTemplateConfigSchema.safeParse(invalidFont).success).toBe(false);
    });

    it('should reject margins outside acceptable range (10-100)', () => {
      const tooSmall = {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        branding: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
          margins: { top: 5, bottom: 40, left: 40, right: 40 },
        },
      };
      expect(documentTemplateConfigSchema.safeParse(tooSmall).success).toBe(false);

      const tooLarge = {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        branding: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
          margins: { top: 40, bottom: 150, left: 40, right: 40 },
        },
      };
      expect(documentTemplateConfigSchema.safeParse(tooLarge).success).toBe(false);
    });

    it('should accept valid optional fields like logoUrl, bankDetails, customLabels', () => {
      const customConfig = {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        branding: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
          logoUrl: 'https://example.com/logo.png',
        },
        header: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.header,
          customLabels: {
            invoice: 'TAX INVOICE',
          },
        },
        itemsTable: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.itemsTable,
          headerBackgroundColor: '#1e3a8a',
          headerTextColor: '#ffffff',
        },
        footer: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.footer,
          bankDetails: {
            bankName: 'First National Bank',
            accountNumber: '123456789',
            routingOrIban: 'GB12ABCD',
            swiftBic: 'ABCDEFXX',
          },
        },
      };
      const result = documentTemplateConfigSchema.safeParse(customConfig);
      expect(result.success).toBe(true);
    });
  });

  describe('universalDocumentDataSchema', () => {
    it('should validate sample UniversalDocumentData', () => {
      const sampleDoc = {
        type: 'INVOICE',
        number: 'INV-2026-0001',
        status: 'PAID',
        issuedAt: new Date().toISOString(),
        dueDate: '2026-10-30T00:00:00.000Z',
        currency: 'USD',
        organization: {
          name: 'Acme Corp',
          logoUrl: 'https://example.com/logo.png',
          address: '123 Business Way, Tech City',
          taxId: 'US-123456789',
          phone: '+1-555-0100',
          email: 'billing@acme.com',
          website: 'https://acme.com',
        },
        party: {
          name: 'Client Inc',
          companyName: 'Client Technologies Ltd',
          address: '456 Customer Ave, Market Town',
          email: 'ap@client.com',
          phone: '+1-555-0200',
          taxId: 'US-987654321',
        },
        secondaryParty: {
          label: 'Ship To',
          name: 'Client Warehouse',
          address: '789 Depot Rd, Industrial Park',
          carrier: 'FedEx Freight',
          trackingReference: 'TRK-998877',
        },
        items: [
          {
            code: 'SRV-001',
            description: 'Web development services',
            quantity: 10,
            unitPrice: 150,
            discount: 50,
            taxRate: 10,
            amount: 1450,
          },
        ],
        totals: {
          subtotal: 1500,
          discounts: 50,
          taxes: [
            {
              rate: 10,
              label: 'VAT 10%',
              amount: 145,
            },
          ],
          total: 1595,
          amountPaid: 1595,
          balanceDue: 0,
        },
        notes: 'Payment terms: Net 30',
        paymentTerms: 'Due upon receipt',
      };
      const result = universalDocumentDataSchema.safeParse(sampleDoc);
      expect(result.success).toBe(true);
    });

    it('should validate statement document with statementSummary', () => {
      const statementDoc = {
        type: 'STATEMENT',
        number: 'STM-2026-001',
        status: 'ISSUED',
        issuedAt: new Date(),
        currency: 'USD',
        organization: {
          name: 'Acme Corp',
        },
        party: {
          name: 'Client Inc',
        },
        items: [],
        totals: {
          total: 4500,
          balanceDue: 4500,
        },
        statementSummary: {
          openingBalance: 1000,
          closingBalance: 4500,
          periodFrom: '2026-01-01',
          periodTo: '2026-01-31',
          aging: {
            current: 2500,
            days30: 1000,
            days60: 1000,
            days90Plus: 0,
          },
        },
      };
      const result = universalDocumentDataSchema.safeParse(statementDoc);
      expect(result.success).toBe(true);
    });

    it('should reject invalid document missing required fields', () => {
      const missingType = {
        number: 'INV-1',
        status: 'DRAFT',
        issuedAt: new Date().toISOString(),
        organization: { name: 'Acme' },
        party: { name: 'Client' },
        totals: { total: 100 },
      };
      expect(universalDocumentDataSchema.safeParse(missingType).success).toBe(false);

      const missingTotals = {
        type: 'INVOICE',
        number: 'INV-1',
        status: 'DRAFT',
        issuedAt: new Date().toISOString(),
        organization: { name: 'Acme' },
        party: { name: 'Client' },
      };
      expect(universalDocumentDataSchema.safeParse(missingTotals).success).toBe(false);
    });
  });

  describe('generateTemplateAiSchema', () => {
    it('should validate valid prompt input', () => {
      const valid = {
        prompt: 'Create a modern minimalist dark navy invoice template',
        baseConfig: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      };
      const result = generateTemplateAiSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject prompt shorter than 3 characters', () => {
      const invalid = {
        prompt: 'ab',
      };
      expect(generateTemplateAiSchema.safeParse(invalid).success).toBe(false);
    });
  });
});
