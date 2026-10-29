import { BadRequestException } from '@nestjs/common';
import {
  CHANNEL_SKILLS,
  PERMISSIONS,
  type BillCaptureResult,
} from '@saas/shared';
import { ChannelProviderType } from '../entities/channel-config.entity';
import {
  BillFromDocumentSkill,
  type ResolvedBillFromDocument,
} from './bill-from-document.skill';
import type { SkillContext } from './skill.types';

const media = {
  id: 'wamid-media-1',
  mimeType: 'application/pdf',
  filename: 'INV-7781.pdf',
};

const ctx = (over: Partial<SkillContext> = {}): SkillContext => ({
  organizationId: 'org-1',
  userId: 'user-1',
  provider: ChannelProviderType.WHATSAPP_META,
  senderIdentifier: '971500000000',
  permissions: [PERMISSIONS.BILL_CREATE],
  message: '',
  attachment: media,
  ...over,
});

const capture = (over: Partial<BillCaptureResult> = {}): BillCaptureResult => ({
  invoice: {
    isInvoice: true,
    supplierName: 'Gulf Board Trading L.L.C.',
    supplierTaxId: null,
    supplierInvoiceNumber: 'INV-7781',
    purchaseOrderReference: 'PO-2026-0031',
    billDate: '2026-10-20',
    dueDate: null,
    currency: 'AED',
    subtotalAmount: 1350,
    taxAmount: 67.5,
    totalAmount: 1417.5,
    lines: [
      {
        description: 'Kraft board 300gsm',
        qty: 500,
        unitCost: 2.4,
        lineTotal: 1200,
      },
      { description: 'Delivery', qty: 1, unitCost: 150, lineTotal: 150 },
    ],
    confidence: 0.9,
    uncertainFields: [],
  },
  supplier: {
    id: 'sup-1',
    companyName: 'Gulf Board Trading LLC',
    currency: 'AED',
  },
  supplierCandidates: [],
  purchaseOrder: { id: 'po-31', poNumber: 'PO-2026-0031' },
  orderCandidates: [],
  lines: [
    { index: 0, purchaseOrderLineId: 'pol-1', score: 0.9 },
    { index: 1, purchaseOrderLineId: null, score: 0 },
  ],
  duplicateOf: null,
  warnings: [],
  model: 'claude-sonnet-5-5',
  promptVersion: 'bill-capture/1',
  ...over,
});

function setup(result: BillCaptureResult = capture()) {
  const billCapture = { capture: jest.fn().mockResolvedValue(result) };
  const payables = {
    billableLines: jest.fn().mockResolvedValue([
      {
        purchaseOrderLineId: 'pol-9',
        description: 'Kraft board 300gsm',
        qtyBillable: 500,
        orderUnitCost: 2.4,
      },
    ]),
    create: jest.fn().mockResolvedValue({
      id: 'bill-1',
      billNumber: 'BILL-2026-0042',
      matchStatus: 'MATCHED',
    }),
  };
  const attachments = { upload: jest.fn().mockResolvedValue({}) };
  const actors = {
    forContext: jest
      .fn()
      .mockResolvedValue({ id: 'user-1', organizationId: 'org-1' }),
  };
  const channels = {
    downloadMedia: jest.fn().mockResolvedValue({
      buffer: Buffer.from('%PDF'),
      mimeType: 'application/pdf',
    }),
  };
  const skill = new BillFromDocumentSkill(
    billCapture as never,
    payables as never,
    attachments as never,
    actors as never,
    () => channels as never,
  );
  return { skill, billCapture, payables, attachments, channels };
}

describe('BillFromDocumentSkill', () => {
  it('is a channel-only skill that takes files and needs bill:create', () => {
    const { skill } = setup();
    expect(skill.name).toBe(CHANNEL_SKILLS.BILL_FROM_DOCUMENT);
    expect(skill.attachment).toBe('required');
    expect(skill.surfaces).toEqual(['channel']);
    expect(skill.requiredPermissions).toEqual([PERMISSIONS.BILL_CREATE]);
  });

  it('downloads the file, reads it with the caption, and proposes the bill', async () => {
    const { skill, billCapture, channels } = setup();
    const r = await skill.resolve({}, ctx({ message: 'board invoice' }));

    expect(channels.downloadMedia).toHaveBeenCalledWith(
      'org-1',
      ChannelProviderType.WHATSAPP_META,
      'wamid-media-1',
      expect.any(Number),
    );
    expect(billCapture.capture).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      expect.objectContaining({
        mimeType: 'application/pdf',
        filename: 'INV-7781.pdf',
      }),
      'board invoice',
    );
    expect(r.kind).toBe('resolved');
    const value = (r as { value: ResolvedBillFromDocument }).value;
    expect(value).toMatchObject({
      supplierId: 'sup-1',
      purchaseOrderId: 'po-31',
      supplierInvoiceNumber: 'INV-7781',
      taxAmount: 67.5,
    });
    expect(value.lines.map((l) => l.purchaseOrderLineId)).toEqual([
      'pol-1',
      null,
    ]);
    expect(value.notes.join(' ')).toContain(
      '"Delivery" is not on PO-2026-0031',
    );
  });

  it('refuses rather than throws when the file cannot be read', async () => {
    const { skill, billCapture } = setup();
    billCapture.capture.mockRejectedValue(
      new BadRequestException('Kerf could not make sense of this invoice.'),
    );
    const r = await skill.resolve({}, ctx());
    expect(r).toEqual({
      kind: 'refused',
      reason: expect.stringContaining('could not make sense'),
    });
  });

  it('refuses a file type it cannot read without downloading it', async () => {
    const { skill, channels } = setup();
    const r = await skill.resolve(
      {},
      ctx({ attachment: { id: 'x', mimeType: 'audio/ogg' } }),
    );
    expect(r.kind).toBe('refused');
    expect(channels.downloadMedia).not.toHaveBeenCalled();
  });

  it('refuses a duplicate, an unknown supplier and a non-invoice', async () => {
    for (const result of [
      capture({ duplicateOf: { id: 'b', billNumber: 'BILL-2026-0007' } }),
      capture({
        supplier: null,
        supplierCandidates: [{ id: 's', companyName: 'Gulf Packaging' }],
      }),
      capture({ warnings: [{ code: 'NOT_AN_INVOICE', message: '' }] }),
    ]) {
      const { skill } = setup(result);
      expect((await skill.resolve({}, ctx())).kind).toBe('refused');
    }
  });

  it('asks which order, keeps what it read, and takes a numbered answer', async () => {
    const { skill, billCapture, payables } = setup(
      capture({
        purchaseOrder: null,
        lines: [],
        orderCandidates: [
          {
            id: 'po-31',
            poNumber: 'PO-2026-0031',
            totalAmount: 1200,
            currency: 'AED',
          },
          {
            id: 'po-35',
            poNumber: 'PO-2026-0035',
            totalAmount: 900,
            currency: 'AED',
          },
        ],
      }),
    );

    const asked = await skill.resolve({}, ctx());
    expect(asked.kind).toBe('question');
    const slots = (asked as { slots: Record<string, unknown> }).slots;
    expect(slots._capture).toBeDefined();
    expect(slots._media).toEqual(media);
    expect(slots.pendingChoice).toBeDefined();

    // The reply arrives without the file; the read is not repeated.
    const answered = await skill.resolve(
      slots,
      ctx({ message: '2', attachment: undefined }),
    );
    expect(billCapture.capture).toHaveBeenCalledTimes(1);
    expect(payables.billableLines).toHaveBeenCalledWith('org-1', 'po-35');
    expect(answered.kind).toBe('resolved');
    expect(
      (answered as { value: ResolvedBillFromDocument }).value.purchaseOrderId,
    ).toBe('po-35');
  });

  it('asks for the invoice number when it could not be read', async () => {
    const result = capture();
    result.invoice.supplierInvoiceNumber = null;
    const { skill } = setup(result);
    const asked = await skill.resolve({}, ctx());
    expect(asked.kind).toBe('question');

    const slots = (asked as { slots: Record<string, unknown> }).slots;
    const answered = await skill.resolve(
      { ...slots, supplierInvoiceNumber: 'INV-7781' },
      ctx({ attachment: undefined }),
    );
    expect(
      (answered as { value: ResolvedBillFromDocument }).value
        .supplierInvoiceNumber,
    ).toBe('INV-7781');
  });

  it('previews the money and says nothing is posted', async () => {
    const { skill } = setup();
    const r = await skill.resolve({}, ctx());
    const text = await skill.preview(
      (r as { value: ResolvedBillFromDocument }).value,
    );
    expect(text).toContain('Gulf Board Trading LLC');
    expect(text).toContain('PO-2026-0031');
    expect(text).toContain('1,417.50 AED');
    expect(text).toContain('Nothing is posted');
  });

  it('enters the draft through the payables service and attaches the file', async () => {
    const { skill, payables, attachments } = setup();
    const r = await skill.resolve({}, ctx());
    const value = (r as { value: ResolvedBillFromDocument }).value;
    const outcome = await skill.execute(
      value,
      ctx({ message: 'yes', attachment: undefined }),
    );

    expect(payables.create).toHaveBeenCalledWith(
      'org-1',
      'user-1',
      expect.objectContaining({
        supplierId: 'sup-1',
        purchaseOrderId: 'po-31',
        supplierInvoiceNumber: 'INV-7781',
      }),
    );
    expect(attachments.upload).toHaveBeenCalledWith(
      expect.anything(),
      'BILL',
      'bill-1',
      expect.objectContaining({
        originalname: 'INV-7781.pdf',
        mimetype: 'application/pdf',
      }),
    );
    expect(outcome).toMatchObject({ resultType: 'BILL', resultId: 'bill-1' });
    expect(outcome.reply).toContain('BILL-2026-0042');
  });

  it('does not enter the bill twice when a retried YES follows a failure', async () => {
    const { skill, payables, attachments } = setup();
    const value = (
      (await skill.resolve({}, ctx())) as { value: ResolvedBillFromDocument }
    ).value;
    attachments.upload.mockRejectedValueOnce(new Error('storage down'));

    const first = await skill.execute(value, ctx());
    expect(first.reply).toContain('could not attach');
    await skill.execute(value, ctx());
    expect(payables.create).toHaveBeenCalledTimes(1);
  });
});
