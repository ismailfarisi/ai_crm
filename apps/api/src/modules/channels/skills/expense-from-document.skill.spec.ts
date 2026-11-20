import { BadRequestException } from '@nestjs/common';
import { CHANNEL_SKILLS, PERMISSIONS } from '@saas/shared';
import { ChannelProviderType } from '../entities/channel-config.entity';
import {
  ExpenseFromDocumentSkill,
  type ResolvedExpenseFromDocument,
} from './expense-from-document.skill';
import type { SkillContext } from './skill.types';

const media = { id: 'wamid-media-1', mimeType: 'image/jpeg' };

const ctx = (over: Partial<SkillContext> = {}): SkillContext => ({
  organizationId: 'org-1',
  userId: 'user-1',
  provider: ChannelProviderType.WHATSAPP_META,
  senderIdentifier: '971500000000',
  permissions: [PERMISSIONS.EXPENSE_SUBMIT],
  message: '',
  attachment: media,
  ...over,
});

const reading = (over: Record<string, unknown> = {}) => ({
  merchantName: 'ENOC',
  amount: 84,
  currency: 'AED',
  expenseDate: '2026-11-19',
  category: 'Travel',
  confidence: 0.92,
  items: [],
  ...over,
});

function setup(scan: Record<string, unknown> = reading()) {
  const expenses = {
    scanReceipt: jest.fn().mockResolvedValue(scan),
    create: jest.fn().mockResolvedValue({
      id: 'claim-1',
      claimNumber: 'EXP-0007',
      currency: 'AED',
    }),
  };
  const receipts = { attach: jest.fn().mockResolvedValue({}) };
  const actors = {
    forContext: jest.fn().mockResolvedValue({
      id: 'user-1',
      organizationId: 'org-1',
      email: 'driver@example.com',
      firstName: 'Omar',
      lastName: 'Saeed',
    }),
  };
  const downloadMedia = jest.fn().mockResolvedValue({
    buffer: Buffer.from('receipt-bytes'),
    mimeType: 'image/jpeg',
  });
  const skill = new ExpenseFromDocumentSkill(
    expenses as never,
    receipts as never,
    actors as never,
    () => ({ downloadMedia }) as never,
  );
  return { skill, expenses, receipts, actors, downloadMedia };
}

async function resolved(
  skill: ExpenseFromDocumentSkill,
  slots: Record<string, unknown> = {},
  context = ctx(),
): Promise<ResolvedExpenseFromDocument> {
  const resolution = await skill.resolve(slots, context);
  if (resolution.kind !== 'resolved') {
    throw new Error(`expected resolved, got ${JSON.stringify(resolution)}`);
  }
  return resolution.value;
}

describe('ExpenseFromDocumentSkill', () => {
  it('is a file-only chat skill for people who may submit expenses', () => {
    const { skill } = setup();
    expect(skill.name).toBe(CHANNEL_SKILLS.EXPENSE_FROM_DOCUMENT);
    expect(skill.requiredPermissions).toEqual([PERMISSIONS.EXPENSE_SUBMIT]);
    expect(skill.attachment).toBe('required');
    expect(skill.surfaces).toEqual(['channel']);
  });

  it('reads the receipt and asks to confirm what it found', async () => {
    const { skill, expenses, downloadMedia } = setup();
    const value = await resolved(skill);

    expect(downloadMedia).toHaveBeenCalledWith(
      'org-1',
      ChannelProviderType.WHATSAPP_META,
      'wamid-media-1',
      expect.any(Number),
    );
    expect(expenses.scanReceipt).toHaveBeenCalledWith(
      {
        base64: Buffer.from('receipt-bytes').toString('base64'),
        mimeType: 'image/jpeg',
      },
      { organizationId: 'org-1', userId: 'user-1' },
    );
    expect(value).toMatchObject({
      merchantName: 'ENOC',
      amount: 84,
      currency: 'AED',
      expenseDate: '2026-11-19',
      category: 'Travel',
      notes: [],
    });

    const preview = await skill.preview(value);
    expect(preview).toContain('ENOC, Travel: 84.00 AED, dated 2026-11-19.');
    expect(preview).toContain('Nothing is paid until it is approved');
    expect(preview).toContain('Reply YES');
    expect(expenses.create).not.toHaveBeenCalled();
  });

  it('lets what the person typed win over what was read', async () => {
    const { skill } = setup();
    const value = await resolved(skill, {
      amount: 90,
      category: 'Office Supplies',
      note: 'printer paper',
    });
    expect(value).toMatchObject({
      amount: 90,
      category: 'Office Supplies',
      note: 'printer paper',
    });
  });

  it('ignores a typed category that is not one of ours', async () => {
    const { skill } = setup();
    const value = await resolved(skill, { category: 'Bribes' });
    expect(value.category).toBe('Travel');
  });

  it('asks for the amount when it cannot be read, then carries on without re-reading', async () => {
    const { skill, expenses } = setup(
      reading({ amount: 0, confidence: 0, currency: 'USD', merchantName: '' }),
    );
    const first = await skill.resolve({}, ctx());
    expect(first).toMatchObject({
      kind: 'question',
      question: expect.stringContaining('How much was it'),
    });
    if (first.kind !== 'question') throw new Error('unreachable');

    const value = await resolved(
      skill,
      { ...first.slots, amount: 45 },
      ctx({ message: '45', attachment: undefined }),
    );
    expect(expenses.scanReceipt).toHaveBeenCalledTimes(1);
    expect(value).toMatchObject({
      amount: 45,
      // A scan that did not run has no currency or date worth keeping.
      currency: null,
      expenseDate: null,
      media,
    });
    expect(value.notes.join(' ')).toContain('today');
  });

  it('warns when the receipt was hard to read', async () => {
    const { skill } = setup(reading({ confidence: 0.4 }));
    const value = await resolved(skill);
    expect(await skill.preview(value)).toContain('hard to read');
  });

  it('refuses a file it cannot read or store as a receipt', async () => {
    const { skill, downloadMedia } = setup();
    const resolution = await skill.resolve(
      {},
      ctx({ attachment: { id: 'm', mimeType: 'audio/ogg' } }),
    );
    expect(resolution).toMatchObject({
      kind: 'refused',
      reason: expect.stringContaining('PDF or a photo'),
    });
    expect(downloadMedia).not.toHaveBeenCalled();
  });

  it('refuses, rather than throws, when the file cannot be fetched', async () => {
    const { skill, downloadMedia } = setup();
    downloadMedia.mockRejectedValue(new BadRequestException('File is too large'));
    await expect(skill.resolve({}, ctx())).resolves.toMatchObject({
      kind: 'refused',
      reason: expect.stringContaining('File is too large'),
    });
  });

  it("submits the claim as the sender's own and attaches the receipt", async () => {
    const { skill, expenses, receipts } = setup();
    const value = await resolved(skill, { note: 'fuel for the van' });
    const outcome = await skill.execute(value, ctx());

    expect(expenses.create).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        category: 'Travel',
        amount: 84,
        currency: 'AED',
        merchantName: 'ENOC',
        notes: 'fuel for the van',
      }),
      { id: 'user-1', name: 'Omar Saeed', email: 'driver@example.com' },
    );
    // No status is passed: the claim is submitted and enters approval.
    expect(expenses.create.mock.calls[0][1].status).toBeUndefined();
    expect(receipts.attach).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      'claim-1',
      expect.objectContaining({
        originalname: 'receipt-EXP-0007.jpg',
        mimetype: 'image/jpeg',
        size: Buffer.from('receipt-bytes').length,
      }),
    );
    expect(outcome).toEqual({
      reply:
        'Submitted EXP-0007: 84.00 AED, ENOC (Travel). It is waiting for approval.',
      resultType: 'EXPENSE_CLAIM',
      resultId: 'claim-1',
    });
  });

  it('does not submit twice when YES is retried after the receipt failed to attach', async () => {
    const { skill, expenses, receipts } = setup();
    receipts.attach.mockRejectedValueOnce(new Error('storage down'));
    const value = await resolved(skill);

    const first = await skill.execute(value, ctx());
    expect(first.reply).toContain('could not attach the receipt');

    await skill.execute(value, ctx());
    expect(expenses.create).toHaveBeenCalledTimes(1);
    expect(receipts.attach).toHaveBeenCalledTimes(2);
  });
});
