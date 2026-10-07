import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RelatedCustomRecords } from './related-custom-records';
import { api } from '@/lib/api/endpoints';

vi.mock('@/lib/api/endpoints', () => ({
  api: {
    customObjects: {
      getReverseLinks: vi.fn(),
    },
  },
  queryKeys: {
    customObjects: {
      reverseLinks: (t: string, id: string) => ['reverse-links', t, id],
    },
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('RelatedCustomRecords', () => {
  it('displays linked custom records', async () => {
    vi.mocked(api.customObjects.getReverseLinks).mockResolvedValue([
      {
        id: 'link-1',
        sourceRecord: {
          id: 'rec-1',
          object: { name: 'Machinery', slug: 'machinery', primaryAttributeSlug: 'name' },
          values: { name: 'Automated Cartoner' },
        },
      },
    ] as any);

    renderWithClient(<RelatedCustomRecords targetType="customer" targetId="cust-1" />);
    expect(await screen.findByText('Automated Cartoner')).toBeDefined();
    expect(screen.getByText('Machinery')).toBeDefined();
  });

  it('displays empty state when no links exist', async () => {
    vi.mocked(api.customObjects.getReverseLinks).mockResolvedValue([] as any);

    renderWithClient(<RelatedCustomRecords targetType="customer" targetId="cust-1" />);
    expect(await screen.findByText('No linked custom records.')).toBeDefined();
  });
});
