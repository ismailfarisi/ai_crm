# AI-Powered Universal Document Templates & Statements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a universal document template system across all Relay CRM commercial & operational documents (Invoices, Quotes, Statements, Delivery Notes, Purchase Orders) with a unified vector PDFKit rendering engine, a Customer Statement of Account service, an AI Template Assistant for generating/tweaking templates from natural language prompts, and a Web UI Template Studio with real-time preview.

**Architecture:**
- `@saas/shared`: Shared Zod schemas (`DocumentTemplateConfig`, `UniversalDocumentData`), default fallback template, and RBAC permissions (`template:read`, `template:manage`).
- `apps/api`:
  - `DocumentTemplate` TypeORM entity & migration.
  - `DocumentPdfRendererService`: Unified vector PDFKit engine with multi-page table wrapping, repeating headers, and running footers (`Page X of Y`).
  - `DocumentTemplateAiService`: Uses `AiService.generateStructured` with Zod validation and AI budget enforcement.
  - `CustomerStatementService`: Aggregates customer invoices, payments, credit notes, computes opening/closing balances and aging buckets, and renders statement PDFs.
  - `DocumentTemplatesService` & Controller: CRUD, default assignment, AI prompt endpoint, and live PDF preview streaming.
  - Service integration: Updates `InvoicesService`, adds `QuotesService.getPdf()`, and updates `DeliveryNotesService` and `PurchaseOrderPdfService`.
- `apps/web`:
  - Settings page `/settings/document-templates` (template list & defaults).
  - Studio `/settings/document-templates/[id]` (split view: AI prompt bar + section accordions on the left; real-time document tabbed preview on the right).

**Tech Stack:** NestJS, TypeORM, PostgreSQL, PDFKit, Zod, Anthropic Claude (`AiService`), Next.js (App Router), Tailwind CSS.

## Global Constraints

- Permissions live in `packages/shared/src/rbac/permissions/` and nowhere else. Never hand-write permission strings at call sites.
- `@saas/shared` is compiled, not source-linked: run `pnpm --filter @saas/shared build` after editing it before other packages can consume changes.
- All AI provider output must be parsed through Zod before use.
- Multi-tenancy: Every database read and write MUST be scoped by `organizationId`.
- No heavy headless browsers (Puppeteer/Chromium): All PDF generation is handled in pure Node.js via PDFKit.
- Safe fallbacks: If a tenant has no custom template, `DEFAULT_DOCUMENT_TEMPLATE_CONFIG` is used automatically.

---

### Task 1: Shared Package — Document Template Schema, Permissions & Types

**Files:**
- Create: `packages/shared/src/rbac/permissions/template.ts`
- Modify: `packages/shared/src/rbac/permissions/index.ts`
- Modify: `packages/shared/src/rbac/permissions.ts`
- Create: `packages/shared/src/templates/document-template.schema.ts`
- Create: `packages/shared/src/templates/index.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/templates/document-template.schema.spec.ts`

**Interfaces:**
- Produces:
  - `PERMISSIONS.DOCUMENT_TEMPLATE_READ` (`template:read`)
  - `PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE` (`template:manage`)
  - `documentTemplateConfigSchema`, `DocumentTemplateConfig`
  - `DEFAULT_DOCUMENT_TEMPLATE_CONFIG`
  - `universalDocumentDataSchema`, `UniversalDocumentData`
  - `DocumentType` enum / union (`'INVOICE' | 'QUOTE' | 'STATEMENT' | 'DELIVERY_NOTE' | 'PURCHASE_ORDER'`)
  - `GenerateTemplateAiInput`, `generateTemplateAiSchema`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/templates/document-template.schema.spec.ts`:
```typescript
import {
  documentTemplateConfigSchema,
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  universalDocumentDataSchema,
  PERMISSIONS,
} from '../index';

describe('Document Template Schema & Permissions', () => {
  it('should expose template permissions', () => {
    expect(PERMISSIONS.DOCUMENT_TEMPLATE_READ).toBe('template:read');
    expect(PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE).toBe('template:manage');
  });

  it('should validate DEFAULT_DOCUMENT_TEMPLATE_CONFIG against schema', () => {
    const result = documentTemplateConfigSchema.safeParse(DEFAULT_DOCUMENT_TEMPLATE_CONFIG);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.branding.primaryColor).toBe('#1e3a8a');
      expect(result.data.header.layout).toBe('split');
      expect(result.data.itemsTable.showLineTotal).toBe(true);
      expect(result.data.footer.showPageNumbers).toBe(true);
    }
  });

  it('should reject invalid hex colors or invalid fonts in config', () => {
    const invalidConfig = {
      ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      branding: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
        primaryColor: 'not-a-color',
      },
    };
    const result = documentTemplateConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it('should validate sample UniversalDocumentData', () => {
    const sampleDoc = {
      type: 'INVOICE',
      number: 'INV-2026-0001',
      status: 'PAID',
      issuedAt: new Date().toISOString(),
      currency: 'USD',
      organization: {
        name: 'Acme Corp',
      },
      party: {
        name: 'Client Inc',
      },
      items: [
        {
          description: 'Web development services',
          quantity: 10,
          unitPrice: 150,
          amount: 1500,
        },
      ],
      totals: {
        subtotal: 1500,
        total: 1500,
      },
    };
    const result = universalDocumentDataSchema.safeParse(sampleDoc);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @saas/shared test document-template.schema.spec.ts`  
Expected: FAIL with module/type resolution errors.

- [ ] **Step 3: Implement permissions and schemas**

Create `packages/shared/src/rbac/permissions/template.ts`:
```typescript
export const TEMPLATE_PERMISSIONS = {
  DOCUMENT_TEMPLATE_READ: 'template:read',
  DOCUMENT_TEMPLATE_MANAGE: 'template:manage',
} as const;
```

Update `packages/shared/src/rbac/permissions/index.ts`:
Export `TEMPLATE_PERMISSIONS`.

Update `packages/shared/src/rbac/permissions.ts`:
Merge `TEMPLATE_PERMISSIONS` into `PERMISSIONS` and add them to appropriate role bundles (`admin` and `owner` have `DOCUMENT_TEMPLATE_MANAGE`; all staff roles have `DOCUMENT_TEMPLATE_READ`).

Create `packages/shared/src/templates/document-template.schema.ts`:
```typescript
import { z } from 'zod';

export const documentTypeSchema = z.enum([
  'INVOICE',
  'QUOTE',
  'STATEMENT',
  'DELIVERY_NOTE',
  'PURCHASE_ORDER',
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const documentTemplateConfigSchema = z.object({
  branding: z.object({
    logoUrl: z.string().url().optional().or(z.literal('')),
    primaryColor: z.string().regex(hexColorRegex, 'Invalid hex color'),
    secondaryColor: z.string().regex(hexColorRegex, 'Invalid hex color'),
    fontFamily: z.enum(['Helvetica', 'Times-Roman', 'Courier']).default('Helvetica'),
    layoutDensity: z.enum(['compact', 'normal', 'relaxed']).default('normal'),
    margins: z.object({
      top: z.number().min(10).max(100).default(40),
      bottom: z.number().min(10).max(100).default(40),
      left: z.number().min(10).max(100).default(40),
      right: z.number().min(10).max(100).default(40),
    }),
  }),
  header: z.object({
    layout: z.enum(['split', 'centered', 'banner']).default('split'),
    showLogo: z.boolean().default(true),
    showCompanyTaxId: z.boolean().default(true),
    showCompanyPhone: z.boolean().default(true),
    showCompanyEmail: z.boolean().default(true),
    showCompanyAddress: z.boolean().default(true),
    customLabels: z.object({
      invoice: z.string().optional(),
      quote: z.string().optional(),
      statement: z.string().optional(),
      deliveryNote: z.string().optional(),
      purchaseOrder: z.string().optional(),
    }).default({}),
  }),
  parties: z.object({
    billToLabel: z.string().default('Bill To'),
    shipToLabel: z.string().default('Ship To'),
    supplierLabel: z.string().default('Vendor'),
    showTaxId: z.boolean().default(true),
    showEmail: z.boolean().default(true),
    showPhone: z.boolean().default(true),
    showAddress: z.boolean().default(true),
  }),
  itemsTable: z.object({
    showItemCode: z.boolean().default(true),
    showDescription: z.boolean().default(true),
    showQuantity: z.boolean().default(true),
    showUnitPrice: z.boolean().default(true),
    showDiscount: z.boolean().default(true),
    showTaxRate: z.boolean().default(true),
    showLineTotal: z.boolean().default(true),
    zebraStriping: z.boolean().default(false),
    headerBackgroundColor: z.string().regex(hexColorRegex).optional(),
    headerTextColor: z.string().regex(hexColorRegex).optional(),
  }),
  totals: z.object({
    showSubtotal: z.boolean().default(true),
    showDiscountTotal: z.boolean().default(true),
    showTaxSummary: z.boolean().default(true),
    showAmountPaid: z.boolean().default(true),
    showBalanceDue: z.boolean().default(true),
    highlightTotal: z.boolean().default(true),
  }),
  footer: z.object({
    bankDetails: z.object({
      bankName: z.string().optional(),
      accountName: z.string().optional(),
      accountNumber: z.string().optional(),
      routingOrIban: z.string().optional(),
      swiftBic: z.string().optional(),
    }).default({}),
    paymentTerms: z.string().optional(),
    notes: z.string().optional(),
    showSignatureBlock: z.boolean().default(false),
    signatureLabel: z.string().default('Authorized Signature'),
    showPageNumbers: z.boolean().default(true),
  }),
});

export type DocumentTemplateConfig = z.infer<typeof documentTemplateConfigSchema>;

export const DEFAULT_DOCUMENT_TEMPLATE_CONFIG: DocumentTemplateConfig = {
  branding: {
    primaryColor: '#1e3a8a',
    secondaryColor: '#64748b',
    fontFamily: 'Helvetica',
    layoutDensity: 'normal',
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
  },
  header: {
    layout: 'split',
    showLogo: true,
    showCompanyTaxId: true,
    showCompanyPhone: true,
    showCompanyEmail: true,
    showCompanyAddress: true,
    customLabels: {},
  },
  parties: {
    billToLabel: 'Bill To',
    shipToLabel: 'Ship To',
    supplierLabel: 'Vendor',
    showTaxId: true,
    showEmail: true,
    showPhone: true,
    showAddress: true,
  },
  itemsTable: {
    showItemCode: true,
    showDescription: true,
    showQuantity: true,
    showUnitPrice: true,
    showDiscount: true,
    showTaxRate: true,
    showLineTotal: true,
    zebraStriping: false,
  },
  totals: {
    showSubtotal: true,
    showDiscountTotal: true,
    showTaxSummary: true,
    showAmountPaid: true,
    showBalanceDue: true,
    highlightTotal: true,
  },
  footer: {
    bankDetails: {},
    paymentTerms: 'Payment due within 30 days of issue date.',
    notes: 'Thank you for your business.',
    showSignatureBlock: false,
    signatureLabel: 'Authorized Signature',
    showPageNumbers: true,
  },
};

export const universalDocumentDataSchema = z.object({
  type: documentTypeSchema,
  number: z.string(),
  status: z.string(),
  issuedAt: z.union([z.string(), z.date()]),
  dueDate: z.union([z.string(), z.date()]).optional(),
  validUntil: z.union([z.string(), z.date()]).optional(),
  currency: z.string().default('USD'),
  organization: z.object({
    name: z.string(),
    logoUrl: z.string().optional(),
    address: z.string().optional(),
    taxId: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    website: z.string().optional(),
  }),
  party: z.object({
    name: z.string(),
    companyName: z.string().optional(),
    address: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    taxId: z.string().optional(),
  }),
  secondaryParty: z.object({
    label: z.string(),
    name: z.string(),
    address: z.string().optional(),
    carrier: z.string().optional(),
    trackingReference: z.string().optional(),
  }).optional(),
  items: z.array(z.object({
    code: z.string().optional(),
    description: z.string(),
    quantity: z.number().optional(),
    unitPrice: z.number().optional(),
    discount: z.number().optional(),
    taxRate: z.number().optional(),
    amount: z.number().optional(),
  })).default([]),
  totals: z.object({
    subtotal: z.number().optional(),
    discounts: z.number().optional(),
    taxes: z.array(z.object({
      rate: z.number(),
      label: z.string(),
      amount: z.number(),
    })).optional(),
    total: z.number(),
    amountPaid: z.number().optional(),
    balanceDue: z.number().optional(),
  }),
  statementSummary: z.object({
    openingBalance: z.number(),
    closingBalance: z.number(),
    periodFrom: z.union([z.string(), z.date()]),
    periodTo: z.union([z.string(), z.date()]),
    aging: z.object({
      current: z.number(),
      days30: z.number(),
      days60: z.number(),
      days90Plus: z.number(),
    }),
  }).optional(),
  notes: z.string().optional(),
  paymentTerms: z.string().optional(),
});

export type UniversalDocumentData = z.infer<typeof universalDocumentDataSchema>;

export const generateTemplateAiSchema = z.object({
  prompt: z.string().min(3),
  baseConfig: documentTemplateConfigSchema.optional(),
});
export type GenerateTemplateAiInput = z.infer<typeof generateTemplateAiSchema>;
```

Create `packages/shared/src/templates/index.ts` and export all.
Update `packages/shared/src/index.ts` to export from `./templates`.

- [ ] **Step 4: Run test and build shared package**

Run: `pnpm --filter @saas/shared test document-template.schema.spec.ts`  
Expected: PASS  
Run: `pnpm --filter @saas/shared build`  
Expected: Clean compilation to `dist/`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/rbac/ packages/shared/src/templates/ packages/shared/src/index.ts
git commit -m "feat(shared): add document template schema, permissions and universal document contract"
```

---

### Task 2: Database Migration & Entity in `apps/api`

**Files:**
- Create: `apps/api/src/modules/document-templates/entities/document-template.entity.ts`
- Create: `apps/api/src/database/migrations/1786130000000-CreateDocumentTemplates.ts`
- Test: `apps/api/src/modules/document-templates/entities/document-template.entity.spec.ts`

**Interfaces:**
- Produces:
  - `DocumentTemplate` TypeORM entity
  - Migration creating `document_templates` table with tenant index and unique default constraint per tenant & doc type.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/document-templates/entities/document-template.entity.spec.ts`:
```typescript
import { DocumentTemplate } from './document-template.entity';
import { DEFAULT_DOCUMENT_TEMPLATE_CONFIG } from '@saas/shared';

describe('DocumentTemplate Entity', () => {
  it('should instantiate entity with defaults and typed config', () => {
    const template = new DocumentTemplate();
    template.id = 'a8f5e14b-70c8-47ec-a417-814d33a1e285';
    template.organizationId = '9b2d3e1a-821b-4172-8857-e9c8a14b3011';
    template.name = 'Modern Minimalist';
    template.isDefault = true;
    template.appliesTo = ['INVOICE', 'QUOTE'];
    template.config = DEFAULT_DOCUMENT_TEMPLATE_CONFIG;

    expect(template.name).toBe('Modern Minimalist');
    expect(template.config.branding.primaryColor).toBe('#1e3a8a');
    expect(template.appliesTo).toContain('INVOICE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test document-template.entity.spec.ts`  
Expected: FAIL with "Cannot find module ./document-template.entity".

- [ ] **Step 3: Write Entity and Migration**

Create `apps/api/src/modules/document-templates/entities/document-template.entity.ts`:
```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { DocumentTemplateConfig, DocumentType } from '@saas/shared';

@Entity('document_templates')
@Index('idx_document_templates_org', ['organizationId'])
export class DocumentTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @Column({
    name: 'applies_to',
    type: 'text',
    array: true,
    default: '{}',
  })
  appliesTo: DocumentType[];

  @Column({ type: 'jsonb' })
  config: DocumentTemplateConfig;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;
}
```

Create `apps/api/src/database/migrations/1786130000000-CreateDocumentTemplates.ts`:
```typescript
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateDocumentTemplates1786130000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'document_templates',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'organization_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'name',
            type: 'varchar',
            length: '120',
            isNullable: false,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'is_default',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'applies_to',
            type: 'text',
            isArray: true,
            default: "'{}'",
            isNullable: false,
          },
          {
            name: 'config',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'created_by_id',
            type: 'uuid',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'document_templates',
      new TableIndex({
        name: 'idx_document_templates_org',
        columnNames: ['organization_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('document_templates', true);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test document-template.entity.spec.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/document-templates/entities/ apps/api/src/database/migrations/
git commit -m "feat(api): add DocumentTemplate entity and migration"
```

---

### Task 3: Unified High-Performance Vector PDF Renderer (`DocumentPdfRendererService`)

**Files:**
- Create: `apps/api/src/modules/document-templates/document-pdf-renderer.service.ts`
- Test: `apps/api/src/modules/document-templates/document-pdf-renderer.service.spec.ts`

**Interfaces:**
- Produces:
  - `DocumentPdfRendererService.render(doc: UniversalDocumentData, template?: DocumentTemplateConfig): Promise<Buffer>`
  - Handles multi-page line item table wrapping, repeating headers on subsequent pages, running footers (`Page X of Y`), status badges, and formatting.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/document-templates/document-pdf-renderer.service.spec.ts`:
```typescript
import { DocumentPdfRendererService } from './document-pdf-renderer.service';
import { DEFAULT_DOCUMENT_TEMPLATE_CONFIG, UniversalDocumentData } from '@saas/shared';

describe('DocumentPdfRendererService', () => {
  let renderer: DocumentPdfRendererService;

  beforeEach(() => {
    renderer = new DocumentPdfRendererService();
  });

  const baseDoc: UniversalDocumentData = {
    type: 'INVOICE',
    number: 'INV-2026-0099',
    status: 'ISSUED',
    issuedAt: new Date('2026-09-30'),
    dueDate: new Date('2026-10-30'),
    currency: 'USD',
    organization: {
      name: 'Northwind Traders',
      address: '123 Market St, London, UK',
      taxId: 'GB123456789',
      phone: '+44 20 7946 0912',
      email: 'billing@northwind.com',
    },
    party: {
      name: 'Acme Corporation',
      companyName: 'Acme Corp',
      address: '456 Industrial Way, Suite 100',
      email: 'accounts@acme.com',
      taxId: 'US-987654321',
    },
    items: [
      {
        code: 'SVC-001',
        description: 'Cloud Infrastructure Consulting - Initial Architecture Assessment and Setup',
        quantity: 40,
        unitPrice: 150,
        amount: 6000,
      },
      {
        code: 'SVC-002',
        description: 'Database Optimization and Index Tuning',
        quantity: 15,
        unitPrice: 160,
        amount: 2400,
      },
    ],
    totals: {
      subtotal: 8400,
      taxes: [{ rate: 20, label: 'VAT 20%', amount: 1680 }],
      total: 10080,
      balanceDue: 10080,
    },
    notes: 'Payment required within net 30 days.',
  };

  it('should render a valid PDF buffer for an Invoice', async () => {
    const buffer = await renderer.render(baseDoc, DEFAULT_DOCUMENT_TEMPLATE_CONFIG);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    // PDF Magic bytes: %PDF-
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('should render valid PDF buffer for Quote, Statement, Delivery Note and Purchase Order', async () => {
    const docTypes: UniversalDocumentData['type'][] = [
      'QUOTE',
      'STATEMENT',
      'DELIVERY_NOTE',
      'PURCHASE_ORDER',
    ];

    for (const type of docTypes) {
      const doc: UniversalDocumentData = {
        ...baseDoc,
        type,
        statementSummary: type === 'STATEMENT' ? {
          openingBalance: 1200,
          closingBalance: 11280,
          periodFrom: new Date('2026-09-01'),
          periodTo: new Date('2026-09-30'),
          aging: { current: 10080, days30: 1200, days60: 0, days90Plus: 0 },
        } : undefined,
      };
      const buffer = await renderer.render(doc, DEFAULT_DOCUMENT_TEMPLATE_CONFIG);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    }
  });

  it('should cleanly handle multi-page pagination for many line items', async () => {
    const manyItems = Array.from({ length: 45 }, (_, i) => ({
      code: `SKU-${i + 1}`,
      description: `Product description for item #${i + 1} with extra details that wrap across multiple lines of text`,
      quantity: i + 1,
      unitPrice: 25.5,
      amount: (i + 1) * 25.5,
    }));

    const longDoc: UniversalDocumentData = {
      ...baseDoc,
      items: manyItems,
      totals: {
        subtotal: 26000,
        total: 26000,
      },
    };

    const buffer = await renderer.render(longDoc, DEFAULT_DOCUMENT_TEMPLATE_CONFIG);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test document-pdf-renderer.service.spec.ts`  
Expected: FAIL with "Cannot find module ./document-pdf-renderer.service".

- [ ] **Step 3: Implement `DocumentPdfRendererService`**

Create `apps/api/src/modules/document-templates/document-pdf-renderer.service.ts`:
Implement clean vector drawing using PDFKit:
- Page setup with margins (`A4`, margin: `template.branding.margins`).
- Header renderer: layout `split`, `centered`, or `banner`. Custom labels or default title (`INVOICE`, `QUOTATION`, `STATEMENT OF ACCOUNT`, `DELIVERY NOTE`, `PURCHASE ORDER`).
- Metadata & dates formatting.
- Party blocks: Bill To & Ship To / Vendor.
- Items Table: Dynamic vertical measurement, page-break threshold (`if (y > pageHeight - footerHeight) { doc.addPage(); renderTableHeader(); }`). Repeating table header on new page.
- Statement Summary: Renders aging breakdown table if `doc.type === 'STATEMENT'`.
- Totals block: Subtotal, discounts, tax rates list, total, balance due, status badge with color coding.
- Footer: Bank details, payment terms, notes, signature line, and 2-pass page numbering (`doc.bufferedPageRange()`).
- Error-safe logo rendering: If `logoUrl` fails or is not found, renders clean typography fallback.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test document-pdf-renderer.service.spec.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/document-templates/document-pdf-renderer.service.ts apps/api/src/modules/document-templates/document-pdf-renderer.service.spec.ts
git commit -m "feat(templates): implement unified DocumentPdfRendererService using PDFKit"
```

---

### Task 4: AI Template Assistant Service (`DocumentTemplateAiService`)

**Files:**
- Create: `apps/api/src/modules/document-templates/document-template-ai.service.ts`
- Test: `apps/api/src/modules/document-templates/document-template-ai.service.spec.ts`

**Interfaces:**
- Consumes: `AiService` (from `apps/api/src/modules/ai`)
- Produces:
  - `DocumentTemplateAiService.generateOrRefine(options: { prompt: string; baseConfig?: DocumentTemplateConfig; tenantContext: { organizationName: string; currency?: string } }): Promise<DocumentTemplateConfig>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/document-templates/document-template-ai.service.spec.ts`:
```typescript
import { DocumentTemplateAiService } from './document-template-ai.service';
import { AiService } from '../ai/ai.service';
import { DEFAULT_DOCUMENT_TEMPLATE_CONFIG } from '@saas/shared';

describe('DocumentTemplateAiService', () => {
  let service: DocumentTemplateAiService;
  let mockAiService: Partial<AiService>;

  beforeEach(() => {
    mockAiService = {
      generateStructured: jest.fn().mockResolvedValue({
        result: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
          branding: {
            ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
            primaryColor: '#0f766e',
          },
          footer: {
            ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.footer,
            paymentTerms: 'Net 15 days upon receipt',
          },
        },
      }),
    };
    service = new DocumentTemplateAiService(mockAiService as AiService);
  });

  it('should call AiService with structured schema and return validated config', async () => {
    const result = await service.generateOrRefine({
      organizationId: 'org-123',
      userId: 'user-456',
      prompt: 'Make an elegant teal corporate template with Net 15 terms',
      tenantContext: { organizationName: 'Acme Corp', currency: 'EUR' },
    });

    expect(mockAiService.generateStructured).toHaveBeenCalled();
    expect(result.branding.primaryColor).toBe('#0f766e');
    expect(result.footer.paymentTerms).toBe('Net 15 days upon receipt');
  });

  it('should pass baseConfig for refinement when provided', async () => {
    await service.generateOrRefine({
      organizationId: 'org-123',
      prompt: 'Change font to Times-Roman',
      baseConfig: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      tenantContext: { organizationName: 'Acme Corp' },
    });

    const callArgs = (mockAiService.generateStructured as jest.Mock).mock.calls[0][1];
    expect(callArgs.prompt).toContain('Current Template Configuration:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test document-template-ai.service.spec.ts`  
Expected: FAIL with "Cannot find module ./document-template-ai.service".

- [ ] **Step 3: Implement `DocumentTemplateAiService`**

Create `apps/api/src/modules/document-templates/document-template-ai.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import {
  DocumentTemplateConfig,
  documentTemplateConfigSchema,
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
} from '@saas/shared';
import { AiService } from '../ai/ai.service';

export interface GenerateTemplateAiParams {
  organizationId: string;
  userId?: string;
  prompt: string;
  baseConfig?: DocumentTemplateConfig;
  tenantContext: {
    organizationName: string;
    currency?: string;
  };
}

@Injectable()
export class DocumentTemplateAiService {
  private readonly logger = new Logger(DocumentTemplateAiService.name);

  constructor(private readonly aiService: AiService) {}

  async generateOrRefine(params: GenerateTemplateAiParams): Promise<DocumentTemplateConfig> {
    const systemPrompt = `You are an expert graphic designer and document layout specialist for business software.
Your task is to design or customize a professional business document template configuration (covering invoices, quotes, customer statements, delivery notes, and purchase orders).

Rules:
1. Output MUST strictly conform to the provided JSON schema.
2. Select harmonious, professional hex colors with strong contrast for readability.
3. Margins must be between 20 and 72.
4. Allowed font families are 'Helvetica', 'Times-Roman', or 'Courier'.
5. If an existing baseConfig is provided, preserve unchanged fields and modify ONLY what the user prompt requests.
6. Organization: "${params.tenantContext.organizationName}". Default currency: "${params.tenantContext.currency || 'USD'}".`;

    const userMessage = params.baseConfig
      ? `User Request: "${params.prompt}"\n\nCurrent Template Configuration:\n${JSON.stringify(params.baseConfig, null, 2)}`
      : `User Request: "${params.prompt}"\n\nGenerate a fresh, complete template starting from standard defaults.`;

    const response = await this.aiService.generateStructured<DocumentTemplateConfig>(
      'document_template_generation',
      {
        prompt: userMessage,
        systemPrompt,
        schema: documentTemplateConfigSchema,
      },
      {
        organizationId: params.organizationId,
        userId: params.userId,
      },
    );

    return response.result || DEFAULT_DOCUMENT_TEMPLATE_CONFIG;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test document-template-ai.service.spec.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/document-templates/document-template-ai.service.ts apps/api/src/modules/document-templates/document-template-ai.service.spec.ts
git commit -m "feat(templates): implement DocumentTemplateAiService with structured generation"
```

---

### Task 5: Customer Statement Engine (`CustomerStatementService`)

**Files:**
- Create: `apps/api/src/modules/customers/customer-statement.service.ts`
- Test: `apps/api/src/modules/customers/customer-statement.service.spec.ts`
- Modify: `apps/api/src/modules/customers/customers.controller.ts`
- Modify: `apps/api/src/modules/customers/customers.module.ts`

**Interfaces:**
- Produces:
  - `CustomerStatementService.generateStatementData(tenantId: string, customerId: string, from: Date, to: Date): Promise<UniversalDocumentData>`
  - `CustomerStatementService.getStatementPdf(tenantId: string, customerId: string, from: Date, to: Date): Promise<{ buffer: Buffer; filename: string }>`
  - `GET /customers/:id/statement/pdf?from=...&to=...` endpoint

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/customers/customer-statement.service.spec.ts`:
```typescript
import { CustomerStatementService } from './customer-statement.service';
import { Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { Invoice } from '../quotes/entities/invoice.entity';
import { InvoicePayment } from '../quotes/entities/invoice-payment.entity';
import { DocumentPdfRendererService } from '../document-templates/document-pdf-renderer.service';
import { DocumentTemplatesService } from '../document-templates/document-templates.service';
import { Organization } from '../organizations/entities/organization.entity';

describe('CustomerStatementService', () => {
  let service: CustomerStatementService;
  let mockCustomerRepo: Partial<Repository<Customer>>;
  let mockInvoiceRepo: Partial<Repository<Invoice>>;
  let mockPaymentRepo: Partial<Repository<InvoicePayment>>;
  let mockOrgRepo: Partial<Repository<Organization>>;
  let mockRenderer: Partial<DocumentPdfRendererService>;
  let mockTemplatesService: Partial<DocumentTemplatesService>;

  beforeEach(() => {
    mockCustomerRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'cust-1',
        name: 'Acme Industries',
        email: 'billing@acme.com',
        phone: '+1 555 1234',
        organizationId: 'org-1',
      }),
    };
    mockOrgRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'org-1',
        name: 'Northwind',
      }),
    };
    mockInvoiceRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-2026-0001',
          amount: 1000,
          currency: 'USD',
          issuedAt: new Date('2026-09-10'),
          dueDate: new Date('2026-10-10'),
        },
      ]),
    };
    mockPaymentRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'pay-1',
          invoiceId: 'inv-1',
          amount: 400,
          paymentDate: new Date('2026-09-15'),
          reference: 'WIRE-9921',
        },
      ]),
    };
    mockRenderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test buffer')),
    };
    mockTemplatesService = {
      resolveForDocumentType: jest.fn().mockResolvedValue(null),
    };

    service = new CustomerStatementService(
      mockCustomerRepo as any,
      mockInvoiceRepo as any,
      mockPaymentRepo as any,
      mockOrgRepo as any,
      mockRenderer as any,
      mockTemplatesService as any,
    );
  });

  it('should compute opening balance, transaction ledger, and closing balance', async () => {
    const data = await service.generateStatementData(
      'org-1',
      'cust-1',
      new Date('2026-09-01'),
      new Date('2026-09-30'),
    );

    expect(data.type).toBe('STATEMENT');
    expect(data.party.name).toBe('Acme Industries');
    expect(data.statementSummary).toBeDefined();
    expect(data.statementSummary?.closingBalance).toBe(600); // 1000 invoice - 400 payment
    expect(data.items.length).toBe(2); // 1 invoice + 1 payment row
  });

  it('should render PDF via DocumentPdfRendererService', async () => {
    const result = await service.getStatementPdf(
      'org-1',
      'cust-1',
      new Date('2026-09-01'),
      new Date('2026-09-30'),
    );

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.filename).toContain('Statement-Acme_Industries');
    expect(mockRenderer.render).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api test customer-statement.service.spec.ts`  
Expected: FAIL with "Cannot find module ./customer-statement.service".

- [ ] **Step 3: Implement `CustomerStatementService` and Controller Endpoint**

Create `apps/api/src/modules/customers/customer-statement.service.ts`:
- Injects repositories: `Customer`, `Invoice`, `InvoicePayment`, `Organization`, `DocumentPdfRendererService`, `DocumentTemplatesService`.
- Fetches all historical transactions prior to `from` date to compute opening balance.
- Fetches all invoices and payments between `from` and `to`.
- Builds ledger items:
  - Invoices: debit `amount`
  - Payments: credit `amount`
- Calculates aging buckets (Current, 1-30, 31-60, 61-90, 90+ days) from open invoices.
- Calls `renderer.render(universalDoc, template?.config)`.

Update `apps/api/src/modules/customers/customers.controller.ts`:
Add endpoint:
```typescript
@Get(':id/statement/pdf')
@RequirePermissions(PERMISSIONS.CUSTOMER_READ)
@ApiOperation({ summary: 'Download customer statement of account PDF' })
async getStatementPdf(
  @CurrentUser() user: AuthenticatedUser,
  @Param('id', ParseUUIDPipe) id: string,
  @Query('from') fromStr?: string,
  @Query('to') toStr?: string,
  @Res() res?: Response,
): Promise<void> {
  const from = fromStr ? new Date(fromStr) : new Date(Date.now() - 30 * 86400000);
  const to = toStr ? new Date(toStr) : new Date();
  const { buffer, filename } = await this.statementService.getStatementPdf(
    user.organizationId,
    id,
    from,
    to,
  );
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end(buffer);
}
```

Update `apps/api/src/modules/customers/customers.module.ts`:
Import `DocumentTemplatesModule`, provide and export `CustomerStatementService`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api test customer-statement.service.spec.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/customers/customer-statement.service.ts apps/api/src/modules/customers/customer-statement.service.spec.ts apps/api/src/modules/customers/customers.controller.ts apps/api/src/modules/customers/customers.module.ts
git commit -m "feat(customers): implement CustomerStatementService and statement PDF endpoint"
```

---

### Task 6: Document Templates Module, Service & Controller

**Files:**
- Create: `apps/api/src/modules/document-templates/document-templates.service.ts`
- Create: `apps/api/src/modules/document-templates/document-templates.controller.ts`
- Create: `apps/api/src/modules/document-templates/document-templates.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/document-templates/document-templates.service.spec.ts`
- Test: `apps/api/src/modules/document-templates/document-templates.controller.spec.ts`

**Interfaces:**
- Produces:
  - CRUD operations for `DocumentTemplate` (list, findOne, create, update, delete, setDefault)
  - `resolveForDocumentType(tenantId: string, docType: DocumentType): Promise<DocumentTemplate | null>`
  - `generateAi(tenantId, userId, dto): Promise<DocumentTemplateConfig>`
  - `previewPdf(tenantId, config, docType): Promise<Buffer>`
  - Full REST API with permission guards.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/modules/document-templates/document-templates.service.spec.ts`:
```typescript
import { DocumentTemplatesService } from './document-templates.service';
import { Repository } from 'typeorm';
import { DocumentTemplate } from './entities/document-template.entity';
import { DEFAULT_DOCUMENT_TEMPLATE_CONFIG } from '@saas/shared';

describe('DocumentTemplatesService', () => {
  let service: DocumentTemplatesService;
  let mockRepo: Partial<Repository<DocumentTemplate>>;

  beforeEach(() => {
    mockRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'tmpl-1', ...entity })),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    service = new DocumentTemplatesService(
      mockRepo as any,
      {} as any, // AI service
      {} as any, // Renderer
      {} as any, // Org repo
    );
  });

  it('should list templates scoped to tenant', async () => {
    await service.findAll('org-1');
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  });

  it('should create a new template with validated config', async () => {
    const result = await service.create('org-1', 'user-1', {
      name: 'Custom Template',
      isDefault: false,
      appliesTo: ['INVOICE'],
      config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
    });
    expect(result.id).toBe('tmpl-1');
    expect(result.name).toBe('Custom Template');
  });
});
```

Create `apps/api/src/modules/document-templates/document-templates.controller.spec.ts`:
Verify routes exist, are protected by `PERMISSIONS.DOCUMENT_TEMPLATE_READ` / `MANAGE`, and call service.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test document-templates.service.spec.ts`  
Expected: FAIL with "Cannot find module ./document-templates.service".

- [ ] **Step 3: Implement Service, Controller, and Module**

Create `apps/api/src/modules/document-templates/document-templates.service.ts`:
Implement:
- `findAll(organizationId: string)`
- `findById(organizationId: string, id: string)`
- `create(organizationId: string, userId: string, dto: ...)`
- `update(organizationId: string, id: string, dto: ...)`
- `delete(organizationId: string, id: string)`: Guards against deleting the sole default template.
- `setDefault(organizationId: string, id: string, docTypes: DocumentType[])`: Ensures only one template is default per document type within the tenant.
- `resolveForDocumentType(organizationId: string, type: DocumentType)`: Returns default template for the document type or tenant default.
- `previewPdf(organizationId: string, config: DocumentTemplateConfig, type: DocumentType)`: Feeds sample mock data matching `type` into `DocumentPdfRendererService.render()` and returns the buffer.

Create `apps/api/src/modules/document-templates/document-templates.controller.ts`:
- `@Controller('settings/document-templates')`
- `@Get()`, `@Get(':id')`, `@Post()`, `@Patch(':id')`, `@Delete(':id')`, `@Post(':id/set-default')`, `@Post('generate-ai')`, `@Post('preview-pdf')`.

Create `apps/api/src/modules/document-templates/document-templates.module.ts`:
Imports `TypeOrmModule.forFeature([DocumentTemplate, Organization])`, `AiModule`. Provides and exports `DocumentTemplatesService`, `DocumentPdfRendererService`, `DocumentTemplateAiService`.

Add `DocumentTemplatesModule` to `imports` in `apps/api/src/app.module.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test document-templates`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/document-templates/ apps/api/src/app.module.ts
git commit -m "feat(templates): implement DocumentTemplatesModule, service and controller"
```

---

### Task 7: Document Service Integrations (Invoices, Quotes, Orders, Purchasing)

**Files:**
- Modify: `apps/api/src/modules/quotes/invoices.service.ts`
- Modify: `apps/api/src/modules/quotes/quotes.service.ts`
- Modify: `apps/api/src/modules/quotes/quotes.controller.ts`
- Modify: `apps/api/src/modules/quotes/quotes.module.ts`
- Modify: `apps/api/src/modules/orders/orders.module.ts`
- Modify: `apps/api/src/modules/purchasing/purchasing.module.ts`
- Tests: `apps/api/src/modules/quotes/quotes.service.spec.ts`, `invoices.service.spec.ts`

**Interfaces:**
- Consumes: `DocumentPdfRendererService`, `DocumentTemplatesService`
- Produces:
  - `InvoicesService.getPdf()` renders via unified `DocumentPdfRendererService` with tenant's active template.
  - `QuotesService.getPdf()` renders quotation PDF via unified `DocumentPdfRendererService`.
  - `GET /quotes/:id/pdf` endpoint added.

- [ ] **Step 1: Write the failing tests**

Update `apps/api/src/modules/quotes/quotes.service.spec.ts`:
Add test verifying `quotesService.getPdf(tenantId, quoteId)` resolves the quote, transforms into `UniversalDocumentData`, and calls `DocumentPdfRendererService.render()`.

Update `apps/api/src/modules/quotes/invoices.service.spec.ts`:
Verify `getPdf()` utilizes `DocumentPdfRendererService` and `DocumentTemplatesService`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api test quotes.service.spec.ts`  
Expected: FAIL with "quotesService.getPdf is not a function".

- [ ] **Step 3: Implement integrations**

In `apps/api/src/modules/quotes/quotes.module.ts`:
Import `DocumentTemplatesModule`.

In `apps/api/src/modules/quotes/quotes.service.ts`:
Add:
```typescript
async getPdf(tenantId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
  const quote = await this.findById(tenantId, id);
  const organization = await this.organizationRepository.findOne({ where: { id: tenantId } });
  const template = await this.documentTemplatesService.resolveForDocumentType(tenantId, 'QUOTE');

  const universalDoc: UniversalDocumentData = {
    type: 'QUOTE',
    number: quote.quoteNumber,
    status: quote.status,
    issuedAt: quote.createdAt,
    validUntil: quote.validUntil,
    currency: quote.currency,
    organization: {
      name: organization?.name || 'Relay CRM',
    },
    party: {
      name: quote.customerName,
      email: quote.customerEmail,
    },
    items: (quote.lines || []).map((line) => ({
      code: line.productCode,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      amount: line.lineTotal,
    })),
    totals: {
      subtotal: quote.subtotalAmount,
      total: quote.totalAmount,
    },
    notes: quote.notes,
    paymentTerms: quote.paymentTerms,
  };

  const buffer = await this.renderer.render(universalDoc, template?.config);
  return { buffer, filename: `${quote.quoteNumber}.pdf` };
}
```

In `apps/api/src/modules/quotes/quotes.controller.ts`:
Add `@Get(':id/pdf')`:
```typescript
@Get(':id/pdf')
@RequirePermissions(PERMISSIONS.QUOTE_READ)
@ApiOperation({ summary: 'Download quote PDF' })
async getPdf(
  @CurrentUser() user: AuthenticatedUser,
  @Param('id', ParseUUIDPipe) id: string,
  @Res() res: Response,
): Promise<void> {
  const { buffer, filename } = await this.quotesService.getPdf(user.organizationId, id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end(buffer);
}
```

In `apps/api/src/modules/quotes/invoices.service.ts`:
Update `getPdf()` to transform `Invoice` to `UniversalDocumentData`, resolve template via `DocumentTemplatesService`, and render with `DocumentPdfRendererService`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter api test quotes.service.spec.ts`  
Run: `pnpm --filter api test invoices.service.spec.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/quotes/ apps/api/src/modules/orders/ apps/api/src/modules/purchasing/
git commit -m "feat(quotes,invoices): integrate unified DocumentPdfRendererService across documents"
```

---

### Task 8: Web UI Studio & Pages (`apps/web`)

**Files:**
- Create: `apps/web/src/hooks/use-document-templates.ts`
- Create: `apps/web/src/app/(app)/settings/document-templates/page.tsx`
- Create: `apps/web/src/app/(app)/settings/document-templates/[id]/page.tsx`
- Create: `apps/web/src/components/settings/document-templates/template-list-view.tsx`
- Create: `apps/web/src/components/settings/document-templates/template-studio.tsx`
- Create: `apps/web/src/components/settings/document-templates/template-preview-panel.tsx`
- Test: `apps/web/src/hooks/use-document-templates.spec.ts`

**Interfaces:**
- Produces:
  - `/settings/document-templates` overview page.
  - `/settings/document-templates/[id]` (and `new`) Studio Editor with split layout:
    - AI prompt input with quick starter buttons.
    - Branding, Header, Parties, Table, Totals, and Footer controls.
    - Live multi-document tabbed preview (`Invoice`, `Quote`, `Statement`, `Delivery Note`, `Purchase Order`) and PDF download.

- [ ] **Step 1: Write the failing hook test**

Create `apps/web/src/hooks/use-document-templates.spec.ts`:
```typescript
import { renderHook, act } from '@testing-library/react';
import { useDocumentTemplates } from './use-document-templates';

global.fetch = jest.fn();

describe('useDocumentTemplates', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockReset();
  });

  it('should fetch list of templates', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'tmpl-1', name: 'Default Modern', isDefault: true }],
    });

    const { result } = renderHook(() => useDocumentTemplates());
    await act(async () => {
      await result.current.fetchTemplates();
    });

    expect(result.current.templates.length).toBe(1);
    expect(result.current.templates[0].name).toBe('Default Modern');
  });

  it('should send AI prompt and return generated config', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        branding: { primaryColor: '#0f766e' },
      }),
    });

    const { result } = renderHook(() => useDocumentTemplates());
    let generated;
    await act(async () => {
      generated = await result.current.generateWithAi('Make it teal');
    });

    expect(generated.branding.primaryColor).toBe('#0f766e');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test use-document-templates.spec.ts`  
Expected: FAIL with "Cannot find module ./use-document-templates".

- [ ] **Step 3: Implement Hook and Web Components**

Create `apps/web/src/hooks/use-document-templates.ts`:
Provide hooks for `fetchTemplates`, `saveTemplate`, `deleteTemplate`, `setDefault`, `generateWithAi`, and `fetchPreviewPdf`.

Create `apps/web/src/components/settings/document-templates/template-list-view.tsx`:
- Lists templates in clean cards with branding preview swatch, active document badges, and actions.
- Button: "New Template", "Create with AI".

Create `apps/web/src/components/settings/document-templates/template-studio.tsx`:
- Split layout:
  - Left panel:
    - AI prompt bar: `"Describe how you want your template to look..."` with submit button & quick prompt pills (*"Modern Tech"*, *"Classic Letterhead"*, *"Add Bank Details"*, *"Compact Table"*).
    - Section accordions: Branding, Header, Parties, Line Items, Totals, Footer.
  - Right panel:
    - Tab bar for `Invoice`, `Quote`, `Statement`, `Delivery Note`, `Purchase Order`.
    - Live HTML preview component and "Download PDF Preview" action.

Create Next.js routes:
- `apps/web/src/app/(app)/settings/document-templates/page.tsx`
- `apps/web/src/app/(app)/settings/document-templates/[id]/page.tsx`

Add link to `Document Templates` in Settings navigation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test use-document-templates.spec.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/ apps/web/src/components/settings/document-templates/ apps/web/src/app/\(app\)/settings/document-templates/
git commit -m "feat(web): implement Document Templates Studio with AI prompt bar and live preview"
```

---

### Task 9: Full Workspace Verification & Documentation

**Files:**
- Modify: `docs/FLAGS.md`

- [ ] **Step 1: Run typechecks and builds across all packages**

```bash
pnpm --filter @saas/shared build
pnpm --filter api build
pnpm --filter web build
```
Expected: Clean build with zero TypeScript errors.

- [ ] **Step 2: Run all unit and integration test suites**

```bash
pnpm --filter @saas/shared test
pnpm --filter api test
pnpm --filter web test
```
Expected: All tests passing.

- [ ] **Step 3: Update `docs/FLAGS.md`**

Update `docs/FLAGS.md` documenting:
- AI-Powered Universal Document Templates & Customer Statements implemented.
- Unified vector PDFKit engine across all 5 document types (`INVOICE`, `QUOTE`, `STATEMENT`, `DELIVERY_NOTE`, `PURCHASE_ORDER`).
- Quotes and Customer Statements now have native PDF export.

- [ ] **Step 4: Commit**

```bash
git add docs/FLAGS.md
git commit -m "docs: mark universal document templates and statements complete"
```
