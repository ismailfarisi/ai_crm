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
