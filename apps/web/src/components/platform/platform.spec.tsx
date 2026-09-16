import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AttachmentDto, AuditLogDto } from '@saas/shared';
import { AttachmentsPanel } from './attachments-panel';
import { ActivityTimeline, describeAction } from './activity-timeline';

// Hoisted: `vi.mock` is lifted above the file, so the doubles it closes over
// have to be created there too.
const { attachments, audit } = vi.hoisted(() => ({
  attachments: {
    list: vi.fn(),
    upload: vi.fn(),
    link: vi.fn(),
    remove: vi.fn(),
  },
  audit: { list: vi.fn(), forSubject: vi.fn() },
}));

vi.mock('@/lib/api/endpoints', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/endpoints')>(
    '@/lib/api/endpoints',
  );
  return {
    ...actual,
    api: { ...actual.api, attachments, audit },
  };
});

const wrap = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const file = (overrides: Partial<AttachmentDto> = {}): AttachmentDto => ({
  id: 'a1',
  ownerType: 'QUOTE',
  ownerId: 'q1',
  filename: 'artwork.pdf',
  contentType: 'application/pdf',
  sizeBytes: 2048,
  uploadedById: 'u1',
  uploadedByName: 'Kim Reyes',
  createdAt: '2026-09-16T09:00:00.000Z',
  ...overrides,
});

const entry = (overrides: Partial<AuditLogDto> = {}): AuditLogDto => ({
  id: 'l1',
  action: 'quote.update',
  subjectType: 'QUOTE',
  subjectId: 'q1',
  summary: null,
  actorId: 'u1',
  actorName: 'Kim Reyes',
  ip: '10.0.0.1',
  changedFields: ['status'],
  before: { status: 'DRAFT' },
  after: { status: 'APPROVED' },
  origin: 'HUMAN',
  channel: 'WEB',
  messageId: null,
  model: null,
  promptVersion: null,
  confidence: null,
  createdAt: '2026-09-16T09:00:00.000Z',
  ...overrides,
});

describe('AttachmentsPanel', () => {
  it('says what can be attached when there is nothing yet', async () => {
    attachments.list.mockResolvedValue([]);
    wrap(<AttachmentsPanel ownerType="QUOTE" ownerId="q1" />);
    expect(await screen.findByText(/Nothing attached yet/)).toBeTruthy();
  });

  it('lists a file with its size and who added it', async () => {
    attachments.list.mockResolvedValue([file()]);
    wrap(<AttachmentsPanel ownerType="QUOTE" ownerId="q1" />);
    expect(await screen.findByText('artwork.pdf')).toBeTruthy();
    expect(screen.getByText(/2 KB · Kim Reyes/)).toBeTruthy();
  });

  it('hides attach and remove from someone who can only read the record', async () => {
    attachments.list.mockResolvedValue([file()]);
    wrap(<AttachmentsPanel ownerType="QUOTE" ownerId="q1" canEdit={false} />);
    await screen.findByText('artwork.pdf');
    expect(screen.queryByText('Attach')).toBeNull();
    expect(screen.queryByLabelText('Remove artwork.pdf')).toBeNull();
    // Reading is still offered.
    expect(screen.getByLabelText('Download artwork.pdf')).toBeTruthy();
  });

  it('fetches a fresh signed link at click time, not at render time', async () => {
    attachments.list.mockResolvedValue([file()]);
    attachments.link.mockResolvedValue({
      url: 'https://api.test/attachments/a1/download?expires=1&token=t',
      expiresAt: '2026-09-16T09:05:00.000Z',
      filename: 'artwork.pdf',
    });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    wrap(<AttachmentsPanel ownerType="QUOTE" ownerId="q1" />);
    await screen.findByText('artwork.pdf');
    expect(attachments.link).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Download artwork.pdf'));
    await waitFor(() => expect(attachments.link).toHaveBeenCalledWith('a1'));
    expect(open).toHaveBeenCalled();
    open.mockRestore();
  });
});

describe('ActivityTimeline', () => {
  it('names what changed in plain words', async () => {
    audit.forSubject.mockResolvedValue([entry()]);
    wrap(<ActivityTimeline subjectType="QUOTE" subjectId="q1" />);
    expect(await screen.findByText(/Updated/)).toBeTruthy();
    expect(screen.getByText(/Changed status/)).toBeTruthy();
  });

  it('marks a record the model drafted, with the model and prompt version', async () => {
    audit.forSubject.mockResolvedValue([
      entry({
        action: 'purchase_order_create.execute',
        origin: 'AI_DRAFTED',
        channel: 'TELEGRAM',
        model: 'claude-sonnet-5',
        promptVersion: 'po-create/1',
        confidence: 0.93,
      }),
    ]);
    wrap(<ActivityTimeline subjectType="PURCHASE_ORDER" subjectId="p1" />);
    expect(await screen.findByText(/drafted by AI/)).toBeTruthy();
    expect(screen.getByText(/claude-sonnet-5 · po-create\/1/)).toBeTruthy();
  });

  it('is honest when the trail is empty rather than implying nothing happened', async () => {
    audit.forSubject.mockResolvedValue([]);
    wrap(<ActivityTimeline subjectType="QUOTE" subjectId="q1" />);
    expect(await screen.findByText(/The trail starts when this record is next changed/)).toBeTruthy();
  });
});

describe('describeAction', () => {
  it('reads as English, not as a route', () => {
    expect(describeAction('quote.create')).toBe('Created');
    expect(describeAction('invoice.void')).toBe('Voided');
    expect(describeAction('auth.login')).toBe('Signed in');
    expect(describeAction('purchase_order_create.execute')).toBe('Ran from chat');
  });
});
