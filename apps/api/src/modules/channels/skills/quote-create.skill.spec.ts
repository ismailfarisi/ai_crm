import { CHANNEL_SKILLS, PERMISSIONS } from '@saas/shared';
import { QuoteCreateSkill } from './quote-create.skill';
import type { QuotesService } from '../../quotes/quotes.service';
import type { ContactsService } from '../../contacts/contacts.service';
import type { SkillContext } from './skill.types';

describe('QuoteCreateSkill', () => {
  let quotesService: jest.Mocked<Partial<QuotesService>>;
  let contactsService: jest.Mocked<Partial<ContactsService>>;
  let skill: QuoteCreateSkill;

  const ctx: SkillContext = {
    organizationId: 'org-uuid-1',
    userId: 'user-uuid-1',
    provider: 'TELEGRAM' as any,
    senderIdentifier: '1489789983',
    permissions: [PERMISSIONS.QUOTE_CREATE],
    message: 'create a quote for Acme Corp: 5 Laptops at 1200 and 10 Mice at 25',
  };

  beforeEach(() => {
    quotesService = {
      createQuote: jest.fn(),
    };
    contactsService = {
      findOrCreateForChannel: jest.fn(),
    };
    skill = new QuoteCreateSkill(
      quotesService as unknown as QuotesService,
      contactsService as unknown as ContactsService,
    );
  });

  it('has the correct name and permissions', () => {
    expect(skill.name).toBe(CHANNEL_SKILLS.QUOTE_CREATE);
    expect(skill.requiredPermissions).toEqual([PERMISSIONS.QUOTE_CREATE]);
  });

  it('asks for customer if customerQuery is missing', async () => {
    const res = await skill.resolve(
      {
        lines: [{ itemQuery: 'Laptops', qty: 5, unitPrice: 1200 }],
      },
      ctx,
    );
    expect(res.kind).toBe('question');
    if (res.kind === 'question') {
      expect(res.question.toLowerCase()).toContain('customer');
    }
  });

  it('asks for items if lines are missing or empty', async () => {
    const res = await skill.resolve(
      {
        customerQuery: 'Acme Corp',
        lines: [],
      },
      ctx,
    );
    expect(res.kind).toBe('question');
    if (res.kind === 'question') {
      expect(res.question.toLowerCase()).toContain('items');
    }
  });

  it('resolves when customer and line items are provided', async () => {
    const res = await skill.resolve(
      {
        customerQuery: 'Acme Corp',
        title: 'Office Hardware',
        lines: [
          { itemQuery: 'Laptop', qty: 5, unitPrice: 1200 },
          { itemQuery: 'Mouse', qty: 10, unitPrice: 25 },
        ],
      },
      ctx,
    );

    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.customerName).toBe('Acme Corp');
      expect(res.value.title).toBe('Office Hardware');
      expect(res.value.lines).toHaveLength(2);
      expect(res.value.lines[0]).toEqual({
        description: 'Laptop',
        quantity: 5,
        unitPrice: 1200,
        subtotal: 6000,
      });
      expect(res.value.lines[1]).toEqual({
        description: 'Mouse',
        quantity: 10,
        unitPrice: 25,
        subtotal: 250,
      });
      expect(res.value.totalAmount).toBe(6250);
    }
  });

  it('generates a detailed preview stating lines, total, and confirmation prompt', async () => {
    const previewText = await skill.preview(
      {
        customerName: 'Acme Corp',
        title: 'Office Hardware',
        currency: 'USD',
        lines: [
          { description: 'Laptop', quantity: 5, unitPrice: 1200, subtotal: 6000 },
          { description: 'Mouse', quantity: 10, unitPrice: 25, subtotal: 250 },
        ],
        totalAmount: 6250,
      },
      ctx,
    );

    expect(previewText).toContain('Acme Corp');
    expect(previewText).toContain('Laptop');
    expect(previewText).toContain('Mouse');
    expect(previewText).toContain('6250');
    expect(previewText.toLowerCase()).toContain('yes');
  });

  it('executes quote creation via QuotesService and returns outcome', async () => {
    quotesService.createQuote = jest.fn().mockResolvedValue({
      id: 'quote-uuid-99',
      quoteNumber: 'QT-2026-0042',
      customerName: 'Acme Corp',
      totalAmount: 6250,
      currency: 'USD',
    } as any);

    const outcome = await skill.execute(
      {
        customerName: 'Acme Corp',
        title: 'Office Hardware',
        currency: 'USD',
        lines: [
          { description: 'Laptop', quantity: 5, unitPrice: 1200, subtotal: 6000 },
          { description: 'Mouse', quantity: 10, unitPrice: 25, subtotal: 250 },
        ],
        totalAmount: 6250,
      },
      ctx,
    );

    expect(quotesService.createQuote).toHaveBeenCalledWith(
      'org-uuid-1',
      expect.objectContaining({
        customerName: 'Acme Corp',
        title: 'Office Hardware',
        items: expect.arrayContaining([
          expect.objectContaining({ description: 'Laptop', quantity: 5, unitPrice: 1200 }),
          expect.objectContaining({ description: 'Mouse', quantity: 10, unitPrice: 25 }),
        ]),
      }),
    );

    expect(outcome.resultType).toBe('QUOTE');
    expect(outcome.resultId).toBe('quote-uuid-99');
    expect(outcome.reply).toContain('QT-2026-0042');
  });
});
