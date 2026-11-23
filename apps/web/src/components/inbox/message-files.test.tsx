import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChannelMessageFileDto } from '@/lib/api/endpoints';
import { MessageFiles, isFilePlaceholder } from './message-files';

const link = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({ toast: { error: (message: string) => toastError(message) } }));
vi.mock('@/lib/api/endpoints', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/endpoints')>();
  return {
    ...original,
    api: {
      ...original.api,
      attachments: { ...original.api.attachments, link: (id: string) => link(id) },
    },
  };
});

const pdf: ChannelMessageFileDto = {
  filename: 'sign-artwork.pdf',
  mimeType: 'application/pdf',
  status: 'saved',
  attachmentId: 'att-1',
  sizeBytes: 2048,
};
const photo: ChannelMessageFileDto = {
  filename: 'photo-1.jpg',
  mimeType: 'image/jpeg',
  status: 'saved',
  attachmentId: 'att-2',
  sizeBytes: 512,
};

beforeEach(() => {
  link.mockReset();
  toastError.mockReset();
  link.mockImplementation(async (id: string) => ({
    url: `https://api.test/attachments/${id}/download?token=t`,
    expiresAt: '2026-11-23T12:05:00.000Z',
    filename: 'f',
  }));
});

describe('MessageFiles', () => {
  it('lists every file with its name and size', () => {
    render(<MessageFiles files={[pdf, { ...pdf, filename: 'spec.pdf', attachmentId: 'att-3' }]} />);
    expect(screen.getByLabelText('Download sign-artwork.pdf')).toBeTruthy();
    expect(screen.getByLabelText('Download spec.pdf')).toBeTruthy();
    expect(screen.getAllByText('2 KB')).toHaveLength(2);
  });

  it('asks for a signed link only when a document is opened', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<MessageFiles files={[pdf]} />);
    expect(link).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Download sign-artwork.pdf'));
    await waitFor(() => expect(link).toHaveBeenCalledWith('att-1'));
    expect(open).toHaveBeenCalledWith(
      'https://api.test/attachments/att-1/download?token=t',
      '_blank',
      'noopener',
    );
    open.mockRestore();
  });

  it('previews a picture', async () => {
    render(<MessageFiles files={[photo]} />);
    const img = (await screen.findByAltText('photo-1.jpg')) as HTMLImageElement;
    expect(img.src).toBe('https://api.test/attachments/att-2/download?token=t');
  });

  it('says so while a file is still being saved, and offers nothing to open', () => {
    render(<MessageFiles files={[{ ...pdf, status: 'saving', attachmentId: undefined }]} />);
    expect(screen.getByText('Saving…')).toBeTruthy();
    expect(screen.queryByLabelText('Download sign-artwork.pdf')).toBeNull();
    expect(link).not.toHaveBeenCalled();
  });

  it('says so when a file could not be saved', () => {
    render(<MessageFiles files={[{ ...photo, status: 'failed', attachmentId: undefined }]} />);
    expect(screen.getByText('Could not be saved')).toBeTruthy();
    expect(link).not.toHaveBeenCalled();
  });

  it('tells the person when a file cannot be opened', async () => {
    link.mockRejectedValue(new Error('403'));
    render(<MessageFiles files={[pdf]} />);
    fireEvent.click(screen.getByLabelText('Download sign-artwork.pdf'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not open sign-artwork.pdf'));
  });
});

describe('isFilePlaceholder', () => {
  it('hides a body that only names the file shown beside it', () => {
    expect(isFilePlaceholder('[Document: sign-artwork.pdf]', [pdf])).toBe(true);
    expect(isFilePlaceholder('[Image]', [photo])).toBe(true);
    expect(isFilePlaceholder('[3 Slack files]', [pdf, pdf, pdf])).toBe(true);
  });

  it('keeps what the sender typed, and any body when there is no file', () => {
    expect(isFilePlaceholder('Artwork for the shop sign', [pdf])).toBe(false);
    expect(isFilePlaceholder('[Image]', [])).toBe(false);
    expect(isFilePlaceholder('[Media/Unsupported Content]', undefined)).toBe(false);
  });
});
