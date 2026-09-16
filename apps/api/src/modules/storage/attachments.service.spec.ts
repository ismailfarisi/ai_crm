import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PERMISSIONS } from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { AttachmentsService } from './attachments.service';
import type { StorageService } from './storage.service';

const asUser = (permissions: string[]): AuthenticatedUser =>
  ({
    id: 'u1',
    organizationId: 'org1',
    email: 'kim@northwind.test',
    firstName: 'Kim',
    lastName: 'Reyes',
    permissions,
  }) as unknown as AuthenticatedUser;

const pdf = {
  originalname: 'artwork.pdf',
  mimetype: 'application/pdf',
  size: 1024,
  buffer: Buffer.from('%PDF-1.4 hello'),
};

describe('AttachmentsService', () => {
  let attachments: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    softDelete: jest.Mock;
  };
  let storage: {
    keyFor: jest.Mock;
    put: jest.Mock;
    delete: jest.Mock;
    linkFor: jest.Mock;
  };
  let ownerExists: jest.Mock;
  let service: AttachmentsService;

  beforeEach(() => {
    attachments = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn((row: unknown) => ({
        ...(row as object),
        id: 'a1',
        createdAt: new Date('2026-09-16T09:00:00Z'),
      })),
      create: jest.fn((row: unknown) => row),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    storage = {
      keyFor: jest.fn().mockReturnValue('org1/quote/q1/key'),
      put: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      linkFor: jest.fn().mockResolvedValue({
        url: 'https://api.test/attachments/a1/download?expires=1&token=t',
        expiresAt: new Date('2026-09-16T09:05:00Z'),
      }),
    };
    ownerExists = jest.fn().mockResolvedValue(true);
    const dataSource = {
      getRepository: () => ({
        metadata: { columns: [{ propertyName: 'tenantId' }] },
        exists: ownerExists,
      }),
    };
    service = new AttachmentsService(
      attachments as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      storage as unknown as StorageService,
      dataSource as never,
    );
  });

  const OWNER = '7f1c2a3b-4d5e-6f70-8a9b-0c1d2e3f4a5b';

  it('needs the owner record’s update permission to attach a file', async () => {
    await expect(
      service.upload(asUser([PERMISSIONS.QUOTE_READ]), 'QUOTE', OWNER, pdf),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('stores the bytes before the row that points at them', async () => {
    const dto = await service.upload(
      asUser([PERMISSIONS.QUOTE_UPDATE]),
      'QUOTE',
      OWNER,
      pdf,
    );
    expect(storage.put).toHaveBeenCalledWith(
      'org1/quote/q1/key',
      pdf.buffer,
      'application/pdf',
    );
    expect(dto.filename).toBe('artwork.pdf');
    expect(attachments.save).toHaveBeenCalled();
  });

  it('refuses a type the browser would execute', async () => {
    await expect(
      service.upload(asUser([PERMISSIONS.QUOTE_UPDATE]), 'QUOTE', OWNER, {
        ...pdf,
        originalname: 'x.html',
        mimetype: 'text/html',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a file over the size limit', async () => {
    await expect(
      service.upload(asUser([PERMISSIONS.QUOTE_UPDATE]), 'QUOTE', OWNER, {
        ...pdf,
        size: 40 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('will not reach a record in another tenant, permission or not', async () => {
    ownerExists.mockResolvedValue(false);
    await expect(
      service.list(asUser([PERMISSIONS.QUOTE_READ]), 'QUOTE', OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('re-checks the owner before handing out a download link', async () => {
    attachments.findOne.mockResolvedValue({
      id: 'a1',
      ownerType: 'QUOTE',
      ownerId: OWNER,
      storageKey: 'org1/quote/q1/key',
      filename: 'artwork.pdf',
    });
    await expect(service.link(asUser([]), 'a1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const link = await service.link(asUser([PERMISSIONS.QUOTE_READ]), 'a1');
    expect(link.url).toContain('/attachments/a1/download');
    expect(link.expiresAt).toBe('2026-09-16T09:05:00.000Z');
  });

  it('soft-deletes the row and removes the object', async () => {
    attachments.findOne.mockResolvedValue({
      id: 'a1',
      ownerType: 'QUOTE',
      ownerId: OWNER,
      storageKey: 'org1/quote/q1/key',
      filename: 'artwork.pdf',
    });
    await service.remove(asUser([PERMISSIONS.QUOTE_UPDATE]), 'a1');
    expect(attachments.softDelete).toHaveBeenCalledWith({ id: 'a1' });
    expect(storage.delete).toHaveBeenCalledWith('org1/quote/q1/key');
  });
});
