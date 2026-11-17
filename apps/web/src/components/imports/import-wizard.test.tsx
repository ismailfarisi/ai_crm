import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PERMISSIONS, type ImportPreviewDto } from '@saas/shared';
import { ImportWizard } from './import-wizard';

let granted: string[] = [];
vi.mock('@/lib/session-context', () => ({
  useSession: () => ({
    check: (rule: { permission?: string }) => !rule.permission || granted.includes(rule.permission),
  }),
}));

const preview = vi.fn();
const commit = vi.fn();
vi.mock('@/hooks/use-imports', () => ({
  useImportRuns: () => ({ data: [] }),
  useImportPreview: () => ({ mutateAsync: preview, isPending: false }),
  useCommitImport: () => ({ mutateAsync: commit, isPending: false }),
}));
vi.mock('@/lib/api/endpoints', () => ({ api: { imports: {} } }));

const result = (over: Partial<ImportPreviewDto> = {}): ImportPreviewDto => ({
  entity: 'customers',
  fileName: 'customers.csv',
  headers: ['Customer', 'E-mail', 'TRN'],
  mapping: { companyName: 0, email: 1, taxId: 2 },
  totalRows: 3,
  counts: { valid: 2, invalid: 1, existing: 1, repeats: 0 },
  rows: [
    { rowNumber: 2, values: { companyName: 'Al Noor' }, issues: [], match: 'existing', matchLabel: 'Al Noor' },
    { rowNumber: 3, values: { companyName: 'Beta' }, issues: [], match: 'new', matchLabel: null },
    {
      rowNumber: 4,
      values: { companyName: 'Gamma', taxId: '12' },
      issues: [{ field: 'taxId', message: 'A UAE TRN is 15 digits' }],
      match: 'new',
      matchLabel: null,
    },
  ],
  ...over,
});

const upload = () => {
  const file = new File(['Customer\nAl Noor\n'], 'customers.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Spreadsheet file'), { target: { files: [file] } });
  return file;
};

describe('ImportWizard', () => {
  beforeEach(() => {
    preview.mockReset().mockResolvedValue(result());
    commit.mockReset().mockResolvedValue({
      id: 'run-1',
      entity: 'customers',
      fileName: 'customers.csv',
      onDuplicate: 'update',
      totalRows: 3,
      created: 1,
      updated: 1,
      skipped: 0,
      failed: 1,
      failures: [{ rowNumber: 4, values: {}, issues: [{ field: 'taxId', message: 'A UAE TRN is 15 digits' }] }],
      createdById: 'u-1',
      createdByName: 'Olivia Owner',
      createdAt: '2026-11-17T00:00:00Z',
    });
  });

  it('offers only what the user may create', () => {
    granted = [PERMISSIONS.CATALOG_MANAGE];
    render(<ImportWizard />);
    expect(screen.queryByLabelText(/Customers/)).toBeNull();
    expect(screen.getByLabelText(/Catalog products/)).toBeChecked();
    expect(screen.getByLabelText(/Work centres/)).toBeInTheDocument();
  });

  it('walks upload, match, review and import, and sends the chosen mapping', async () => {
    granted = [PERMISSIONS.CUSTOMER_CREATE, PERMISSIONS.CUSTOMER_UPDATE];
    render(<ImportWizard initialEntity="customers" />);
    const file = upload();

    await screen.findByText('Match your columns');
    expect(preview).toHaveBeenCalledWith({ entity: 'customers', file });
    expect(screen.getByLabelText(/Email/)).toHaveValue('1');
    fireEvent.change(screen.getByLabelText(/Tax ID/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check rows' }));

    await screen.findByText('A UAE TRN is 15 digits', { exact: false });
    expect(preview).toHaveBeenLastCalledWith({
      entity: 'customers',
      file,
      mapping: { companyName: 0, email: 1, taxId: null },
    });
    fireEvent.click(screen.getByLabelText('Update them with this file'));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await screen.findByText('Import finished. 1 row was not imported.');
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ onDuplicate: 'update' }));
    expect(screen.getByRole('button', { name: /Failed rows \(Excel\)/ })).toBeInTheDocument();
  });

  it('skips duplicates when the user cannot update them', async () => {
    granted = [PERMISSIONS.CUSTOMER_CREATE];
    render(<ImportWizard initialEntity="customers" />);
    upload();
    fireEvent.click(await screen.findByRole('button', { name: 'Check rows' }));
    expect(await screen.findByLabelText('Update them with this file')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(commit).toHaveBeenCalledWith(expect.objectContaining({ onDuplicate: 'skip' })));
  });

  it('holds back until every required field has a column', async () => {
    granted = [PERMISSIONS.CUSTOMER_CREATE];
    preview.mockResolvedValue(result({ mapping: { companyName: null, email: 1, taxId: 2 } }));
    render(<ImportWizard initialEntity="customers" />);
    upload();
    expect(await screen.findByText('Pick a column for Company name.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check rows' })).toBeDisabled();
  });
});
