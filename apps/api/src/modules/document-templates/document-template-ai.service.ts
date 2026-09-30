import { Injectable, Logger } from '@nestjs/common';
import {
  DocumentTemplateConfig,
  documentTemplateConfigSchema,
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
} from '@saas/shared';
import { AiService } from '../ai/ai.service';
import { AiStructuredOptions } from '../ai/interfaces/ai-provider.interface';

export interface GenerateTemplateAiParams {
  organizationId: string;
  userId?: string;
  prompt: string;
  baseConfig?: DocumentTemplateConfig;
  tenantContext?: {
    organizationName?: string;
    currency?: string;
  };
}

/**
 * JSON-Schema representation of DocumentTemplateConfig for Anthropic / OpenAI
 * structured tool-calling. Kept in sync with documentTemplateConfigSchema.
 */
export const documentTemplateConfigJsonSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    branding: {
      type: 'object',
      properties: {
        logoUrl: { type: 'string' },
        primaryColor: {
          type: 'string',
          description:
            'Hex color string matching #RGB or #RRGGBB, e.g. #1e3a8a',
        },
        secondaryColor: {
          type: 'string',
          description:
            'Hex color string matching #RGB or #RRGGBB, e.g. #64748b',
        },
        fontFamily: {
          type: 'string',
          enum: ['Helvetica', 'Times-Roman', 'Courier'],
        },
        layoutDensity: {
          type: 'string',
          enum: ['compact', 'normal', 'relaxed'],
        },
        margins: {
          type: 'object',
          properties: {
            top: { type: 'number', minimum: 10, maximum: 100 },
            bottom: { type: 'number', minimum: 10, maximum: 100 },
            left: { type: 'number', minimum: 10, maximum: 100 },
            right: { type: 'number', minimum: 10, maximum: 100 },
          },
          required: ['top', 'bottom', 'left', 'right'],
        },
      },
      required: [
        'primaryColor',
        'secondaryColor',
        'fontFamily',
        'layoutDensity',
        'margins',
      ],
    },
    header: {
      type: 'object',
      properties: {
        layout: {
          type: 'string',
          enum: ['split', 'centered', 'banner'],
        },
        showLogo: { type: 'boolean' },
        showCompanyTaxId: { type: 'boolean' },
        showCompanyPhone: { type: 'boolean' },
        showCompanyEmail: { type: 'boolean' },
        showCompanyAddress: { type: 'boolean' },
        customLabels: {
          type: 'object',
          properties: {
            invoice: { type: 'string' },
            quote: { type: 'string' },
            statement: { type: 'string' },
            deliveryNote: { type: 'string' },
            purchaseOrder: { type: 'string' },
          },
        },
      },
      required: [
        'layout',
        'showLogo',
        'showCompanyTaxId',
        'showCompanyPhone',
        'showCompanyEmail',
        'showCompanyAddress',
      ],
    },
    parties: {
      type: 'object',
      properties: {
        billToLabel: { type: 'string' },
        shipToLabel: { type: 'string' },
        supplierLabel: { type: 'string' },
        showTaxId: { type: 'boolean' },
        showEmail: { type: 'boolean' },
        showPhone: { type: 'boolean' },
        showAddress: { type: 'boolean' },
      },
      required: [
        'billToLabel',
        'shipToLabel',
        'supplierLabel',
        'showTaxId',
        'showEmail',
        'showPhone',
        'showAddress',
      ],
    },
    itemsTable: {
      type: 'object',
      properties: {
        showItemCode: { type: 'boolean' },
        showDescription: { type: 'boolean' },
        showQuantity: { type: 'boolean' },
        showUnitPrice: { type: 'boolean' },
        showDiscount: { type: 'boolean' },
        showTaxRate: { type: 'boolean' },
        showLineTotal: { type: 'boolean' },
        zebraStriping: { type: 'boolean' },
        headerBackgroundColor: {
          type: 'string',
          description: 'Optional hex color for table header background',
        },
        headerTextColor: {
          type: 'string',
          description: 'Optional hex color for table header text',
        },
      },
      required: [
        'showItemCode',
        'showDescription',
        'showQuantity',
        'showUnitPrice',
        'showDiscount',
        'showTaxRate',
        'showLineTotal',
        'zebraStriping',
      ],
    },
    totals: {
      type: 'object',
      properties: {
        showSubtotal: { type: 'boolean' },
        showDiscountTotal: { type: 'boolean' },
        showTaxSummary: { type: 'boolean' },
        showAmountPaid: { type: 'boolean' },
        showBalanceDue: { type: 'boolean' },
        highlightTotal: { type: 'boolean' },
      },
      required: [
        'showSubtotal',
        'showDiscountTotal',
        'showTaxSummary',
        'showAmountPaid',
        'showBalanceDue',
        'highlightTotal',
      ],
    },
    footer: {
      type: 'object',
      properties: {
        bankDetails: {
          type: 'object',
          properties: {
            bankName: { type: 'string' },
            accountName: { type: 'string' },
            accountNumber: { type: 'string' },
            routingOrIban: { type: 'string' },
            swiftBic: { type: 'string' },
          },
        },
        paymentTerms: { type: 'string' },
        notes: { type: 'string' },
        showSignatureBlock: { type: 'boolean' },
        signatureLabel: { type: 'string' },
        showPageNumbers: { type: 'boolean' },
      },
      required: ['showSignatureBlock', 'signatureLabel', 'showPageNumbers'],
    },
  },
  required: ['branding', 'header', 'parties', 'itemsTable', 'totals', 'footer'],
};

@Injectable()
export class DocumentTemplateAiService {
  private readonly logger = new Logger(DocumentTemplateAiService.name);

  constructor(private readonly aiService: AiService) {}

  async generateOrRefine(
    params: GenerateTemplateAiParams,
  ): Promise<DocumentTemplateConfig> {
    const orgName =
      params.tenantContext?.organizationName || 'Our Organization';
    const currency = params.tenantContext?.currency || 'USD';

    const systemPrompt = `You are an expert graphic designer and document layout specialist for business software.
Your task is to design or customize a professional business document template configuration (covering invoices, quotes, customer statements, delivery notes, and purchase orders).

Rules:
1. Output MUST strictly conform to the provided JSON schema.
2. Select harmonious, professional hex colors with strong contrast for readability.
3. Margins must be between 20 and 72.
4. Allowed font families are 'Helvetica', 'Times-Roman', or 'Courier'.
5. If an existing baseConfig is provided, preserve unchanged fields and modify ONLY what the user prompt requests.
6. Organization: "${orgName}". Default currency: "${currency}".`;

    const userMessage = params.baseConfig
      ? `User Request: "${params.prompt}"\n\nCurrent Template Configuration:\n${JSON.stringify(params.baseConfig, null, 2)}`
      : `User Request: "${params.prompt}"\n\nGenerate a fresh, complete template starting from standard defaults.`;

    try {
      const options: AiStructuredOptions & {
        prompt?: string;
        systemPrompt?: string;
        schema?: unknown;
      } = {
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        jsonSchema: documentTemplateConfigJsonSchema,
        schemaName: 'document_template_config',
        prompt: userMessage,
        systemPrompt,
        schema: documentTemplateConfigSchema,
      };

      const response = await this.aiService.generateStructured<unknown>(
        'document_template_generation',
        options,
        {
          organizationId: params.organizationId,
          userId: params.userId,
        },
      );

      const candidate =
        (response as { data?: unknown; result?: unknown })?.data ??
        (response as { data?: unknown; result?: unknown })?.result;

      if (!candidate) {
        this.logger.warn(
          'AI service returned empty result for template generation; falling back to default',
        );
        return DEFAULT_DOCUMENT_TEMPLATE_CONFIG;
      }

      const parsed = documentTemplateConfigSchema.safeParse(candidate);
      if (!parsed.success) {
        this.logger.warn(
          `AI returned invalid document template config: ${parsed.error.message}`,
        );
        return DEFAULT_DOCUMENT_TEMPLATE_CONFIG;
      }

      return parsed.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to generate document template with AI, falling back to default: ${message}`,
      );
      return DEFAULT_DOCUMENT_TEMPLATE_CONFIG;
    }
  }
}
