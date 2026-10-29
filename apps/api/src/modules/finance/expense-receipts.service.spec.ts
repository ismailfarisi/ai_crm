import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpenseReceiptsService } from './expense-receipts.service';

const TENANT = 'tenant-1';
const CLAIM = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';

const user = { id: 'user-1', organizationId: TENANT } as never;
const pdf = {
  originalname: 'receipt.pdf',
  mimetype: 'application/pdf',
  size: 8,
  buffer: Buffer.from('%PDF-1.7'),
};

function setup() {
  const claim = {
    id: CLAIM,
    tenantId: TENANT,
    receiptUrl: null as string | null,
  };
  const claims = {
    findOne: jest.fn(async ({ where }: any) =>
      where.id === CLAIM && where.tenantId === TENANT ? claim : null,
    ),
    save: jest.fn(async (c: unknown) => c),
  };
  const attachments = { findOne: jest.fn().mockResolvedValue(null) };
  const files = { upload: jest.fn().mockResolvedValue({ id: FILE_ID }) };
  const service = new ExpenseReceiptsService(
    claims as never,
    attachments as never,
    files as never,
  );
  return { service, claim, claims, attachments, files };
}

describe('ExpenseReceiptsService', () => {
  describe('attach', () => {
    it('stores the file on the claim and points the claim at it', async () => {
      const { service, files } = setup();
      const saved = await service.attach(user, CLAIM, pdf);
      expect(files.upload).toHaveBeenCalledWith(
        user,
        'EXPENSE_CLAIM',
        CLAIM,
        pdf,
      );
      expect(saved.receiptUrl).toBe(`attachment:${FILE_ID}`);
    });

    it('refuses a file that is not a receipt, before storing it', async () => {
      const { service, files } = setup();
      await expect(
        service.attach(user, CLAIM, { ...pdf, mimetype: 'text/html' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(files.upload).not.toHaveBeenCalled();
    });

    it('refuses a claim in another tenant', async () => {
      const { service } = setup();
      await expect(
        service.attach(
          { ...(user as object), organizationId: 'other' } as never,
          CLAIM,
          pdf,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('assertReceiptUrl', () => {
    it('allows nothing, a link, and a file attached to this claim', async () => {
      const { service, attachments } = setup();
      await expect(
        service.assertReceiptUrl(TENANT, null, null),
      ).resolves.toBeUndefined();
      await expect(
        service.assertReceiptUrl(TENANT, null, 'https://files.example/r.png'),
      ).resolves.toBeUndefined();

      attachments.findOne.mockResolvedValue({ id: FILE_ID });
      await expect(
        service.assertReceiptUrl(TENANT, CLAIM, `attachment:${FILE_ID}`),
      ).resolves.toBeUndefined();
      expect(attachments.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: FILE_ID,
          tenantId: TENANT,
          ownerType: 'EXPENSE_CLAIM',
          ownerId: CLAIM,
        }),
      });
    });

    it('refuses a file carried inline as a data URL', async () => {
      const { service } = setup();
      await expect(
        service.assertReceiptUrl(TENANT, null, 'data:image/png;base64,AAAA'),
      ).rejects.toThrow('as a file');
    });

    it('refuses a file that is not attached to this claim', async () => {
      const { service } = setup();
      await expect(
        service.assertReceiptUrl(TENANT, CLAIM, `attachment:${FILE_ID}`),
      ).rejects.toThrow('not attached to this claim');
      // A new claim has no attachments at all.
      await expect(
        service.assertReceiptUrl(TENANT, null, `attachment:${FILE_ID}`),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a malformed reference without querying', async () => {
      const { service, attachments } = setup();
      await expect(
        service.assertReceiptUrl(TENANT, CLAIM, 'attachment:not-a-uuid'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(attachments.findOne).not.toHaveBeenCalled();
    });

    it('refuses a link that is not http(s)', async () => {
      const { service } = setup();
      await expect(
        service.assertReceiptUrl(TENANT, null, 'javascript:alert(1)'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
