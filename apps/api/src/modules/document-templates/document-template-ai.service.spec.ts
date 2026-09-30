import { DocumentTemplateAiService } from './document-template-ai.service';
import { AiService } from '../ai/ai.service';
import { DEFAULT_DOCUMENT_TEMPLATE_CONFIG } from '@saas/shared';

describe('DocumentTemplateAiService', () => {
  let service: DocumentTemplateAiService;
  let mockAiService: Partial<AiService>;

  beforeEach(() => {
    mockAiService = {
      generateStructured: jest.fn().mockResolvedValue({
        data: {
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

    expect(mockAiService.generateStructured).toHaveBeenCalledWith(
      'document_template_generation',
      expect.objectContaining({
        schemaName: 'document_template_config',
        jsonSchema: expect.any(Object),
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining(
              'Make an elegant teal corporate template with Net 15 terms',
            ),
          }),
        ]),
        system: expect.stringContaining('Acme Corp'),
        prompt: expect.stringContaining(
          'Make an elegant teal corporate template with Net 15 terms',
        ),
      }),
      {
        organizationId: 'org-123',
        userId: 'user-456',
      },
    );

    expect(result.branding.primaryColor).toBe('#0f766e');
    expect(result.footer.paymentTerms).toBe('Net 15 days upon receipt');
  });

  it('should support result property on response object for backwards compatibility', async () => {
    (mockAiService.generateStructured as jest.Mock).mockResolvedValueOnce({
      result: {
        ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        branding: {
          ...DEFAULT_DOCUMENT_TEMPLATE_CONFIG.branding,
          primaryColor: '#7c3aed',
        },
      },
    });

    const result = await service.generateOrRefine({
      organizationId: 'org-123',
      prompt: 'Purple theme',
    });

    expect(result.branding.primaryColor).toBe('#7c3aed');
  });

  it('should pass baseConfig for refinement when provided', async () => {
    await service.generateOrRefine({
      organizationId: 'org-123',
      prompt: 'Change font to Times-Roman',
      baseConfig: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      tenantContext: { organizationName: 'Acme Corp' },
    });

    const callArgs = (mockAiService.generateStructured as jest.Mock).mock
      .calls[0][1];
    expect(callArgs.prompt).toContain('Current Template Configuration:');
    expect(callArgs.prompt).toContain('"fontFamily": "Helvetica"');
    expect(callArgs.messages[0].content).toContain(
      'Current Template Configuration:',
    );
  });

  it('should instruct fresh template generation when baseConfig is omitted', async () => {
    await service.generateOrRefine({
      organizationId: 'org-123',
      prompt: 'Create minimal invoice template',
    });

    const callArgs = (mockAiService.generateStructured as jest.Mock).mock
      .calls[0][1];
    expect(callArgs.prompt).not.toContain('Current Template Configuration:');
    expect(callArgs.prompt).toContain('fresh, complete template');
  });

  it('should fall back gracefully to DEFAULT_DOCUMENT_TEMPLATE_CONFIG if AI returns empty or null', async () => {
    (mockAiService.generateStructured as jest.Mock).mockResolvedValueOnce({
      data: null,
    });

    const result = await service.generateOrRefine({
      organizationId: 'org-123',
      prompt: 'Something invalid',
    });

    expect(result).toEqual(DEFAULT_DOCUMENT_TEMPLATE_CONFIG);
  });

  it('should fall back gracefully to DEFAULT_DOCUMENT_TEMPLATE_CONFIG if AI returns invalid schema', async () => {
    (mockAiService.generateStructured as jest.Mock).mockResolvedValueOnce({
      data: {
        branding: {
          primaryColor: 'not-a-hex-color', // invalid hex
        },
      },
    });

    const result = await service.generateOrRefine({
      organizationId: 'org-123',
      prompt: 'Corrupt response',
    });

    expect(result).toEqual(DEFAULT_DOCUMENT_TEMPLATE_CONFIG);
  });

  it('should fall back gracefully to DEFAULT_DOCUMENT_TEMPLATE_CONFIG if AiService throws an error', async () => {
    (mockAiService.generateStructured as jest.Mock).mockRejectedValueOnce(
      new Error('AI provider rate limit or budget exceeded'),
    );

    const result = await service.generateOrRefine({
      organizationId: 'org-123',
      prompt: 'Trigger failure',
    });

    expect(result).toEqual(DEFAULT_DOCUMENT_TEMPLATE_CONFIG);
  });
});
