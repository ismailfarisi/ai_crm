import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProductTemplateDto } from '@saas/shared';
import { TemplateConfigurator } from './template-configurator';

vi.mock('@/lib/session-context', () => ({ useCan: () => true }));
vi.mock('@/hooks/use-catalog', () => ({
  usePriceBreaks: () => ({ data: undefined, isLoading: false, error: null }),
}));

function template(blankPreview: ProductTemplateDto['blankPreview']): ProductTemplateDto {
  return {
    id: 'tpl-1',
    templateKey: 'thing',
    version: 1,
    isCurrent: true,
    name: 'Thing',
    description: null,
    currency: 'AED',
    blankPreview,
    parameters: ['length_mm', 'width_mm', 'height_mm'].map((key) => ({
      key,
      label: key,
      type: 'NUMBER' as const,
      unit: 'mm',
      defaultValue: 200,
    })),
    derived: [],
    materials: [],
    operations: [],
    tooling: [],
    pricing: { method: 'MARGIN', targetPct: 0.3 },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as unknown as ProductTemplateDto;
}

describe('TemplateConfigurator blank preview', () => {
  it('draws the box net for a template that opts in', () => {
    render(<TemplateConfigurator template={template('RIGID_BOX')} onBack={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getByRole('img', { name: /Flat blank/ })).toBeDefined();
  });

  it('draws nothing for a sign or cabinet with the same dimensions', () => {
    render(<TemplateConfigurator template={template(null)} onBack={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.queryByRole('img', { name: /Flat blank/ })).toBeNull();
  });
});
