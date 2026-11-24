import { BadRequestException } from '@nestjs/common';
import { PERMISSIONS } from '@saas/shared';
import { InvoiceStatus } from '@/modules/quotes/entities/invoice.entity';
import { WhatsAppDocumentService } from './whatsapp-document.service';

const TENANT = 'tenant-1';
const HOUR = 60 * 60 * 1000;

function setup(
  opts: {
    connected?: boolean;
    lastInboundAgo?: number | null;
    template?: string;
    permissions?: string[];
    phone?: string | null;
    sendFails?: boolean;
    payUrl?: string | null;
  } = {},
) {
  const user = {
    id: 'user-1',
    organizationId: TENANT,
    permissions: opts.permissions ?? [
      PERMISSIONS.QUOTE_UPDATE,
      PERMISSIONS.INVOICE_MANAGE,
      PERMISSIONS.CHANNEL_SEND,
    ],
  } as never;
  const configs = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        opts.connected === false
          ? null
          : { isEnabled: true, encryptedCredentials: 'enc' },
      ),
  };
  const messages = {
    findOne: jest.fn().mockResolvedValue(
      opts.lastInboundAgo === null || opts.lastInboundAgo === undefined
        ? null
        : {
            contactId: 'contact-1',
            createdAt: new Date(Date.now() - opts.lastInboundAgo),
          },
    ),
  };
  const customers = {
    findOne: jest.fn().mockResolvedValue({
      id: 'cust-1',
      phone: opts.phone === undefined ? '050 123 4567' : opts.phone,
      country: 'AE',
    }),
  };
  const organizations = {
    findOne: jest
      .fn()
      .mockResolvedValue({ name: 'Northwind Print', country: 'AE' }),
  };
  const quote = {
    id: 'quote-1',
    tenantId: TENANT,
    quoteNumber: 'Q-0012',
    title: 'Shop sign',
    customerId: 'cust-1',
    customerName: 'Acme',
  };
  const quotes = { findOne: jest.fn().mockResolvedValue(quote) };
  const channels = {
    sendMessage: opts.sendFails
      ? jest.fn().mockRejectedValue(new Error('Template not approved'))
      : jest.fn().mockResolvedValue({ id: 'msg-1' }),
  };
  const crypto = {
    decrypt: jest.fn().mockReturnValue({
      documentTemplateName: opts.template,
      documentTemplateLanguage: 'en_GB',
    }),
  };
  const contacts = {
    findOrCreateForChannel: jest.fn().mockResolvedValue({ id: 'contact-new' }),
  };
  const acceptance = {
    createLink: jest
      .fn()
      .mockResolvedValue({ url: 'https://app.test/q/tok', expiresAt: '' }),
    recordSent: jest.fn(),
  };
  const proofs = {
    latestFor: jest.fn().mockResolvedValue({ id: 'proof-1', version: 2 }),
  };
  const invoices = {
    payLinkFor: jest.fn().mockResolvedValue({
      invoice: {
        id: 'inv-1',
        invoiceNumber: 'INV-0007',
        customerId: 'cust-1',
        customerName: 'Acme',
        amount: 1050,
        currency: 'AED',
        dueDate: null,
        status: InvoiceStatus.ISSUED,
      },
      payUrl:
        opts.payUrl === undefined ? 'https://app.test/pay/tok' : opts.payUrl,
    }),
    markSent: jest.fn(),
  };
  const service = new WhatsAppDocumentService(
    configs as never,
    messages as never,
    customers as never,
    organizations as never,
    quotes as never,
    channels as never,
    crypto as never,
    contacts as never,
    acceptance as never,
    proofs as never,
    invoices as never,
  );
  return {
    service,
    user,
    channels,
    contacts,
    acceptance,
    invoices,
    messages,
    proofs,
  };
}

describe('Send on WhatsApp', () => {
  it('sends free text from the business number inside 24 hours and records it in the customer thread', async () => {
    const { service, user, channels, acceptance } = setup({
      lastInboundAgo: 2 * HOUR,
    });
    const result = await service.sendQuote(user, 'quote-1');

    expect(result).toMatchObject({
      method: 'CHANNEL',
      to: '971501234567',
      url: 'https://app.test/q/tok',
      chatUrl: null,
      usedTemplate: false,
    });
    expect(channels.sendMessage).toHaveBeenCalledWith(TENANT, 'user-1', {
      provider: 'WHATSAPP_META',
      recipient: '971501234567',
      body: expect.stringContaining('https://app.test/q/tok'),
      contactId: 'contact-1',
      metadata: { document: { kind: 'quote', id: 'quote-1' } },
    });
    expect(acceptance.recordSent).toHaveBeenCalled();
  });

  it('uses the approved template outside 24 hours', async () => {
    const { service, user, channels } = setup({
      lastInboundAgo: 30 * HOUR,
      template: 'kerf_document',
    });
    const result = await service.sendQuote(user, 'quote-1');

    expect(result).toMatchObject({ method: 'CHANNEL', usedTemplate: true });
    expect(channels.sendMessage.mock.calls[0][2].template).toEqual({
      name: 'kerf_document',
      language: 'en_GB',
      parameters: ['quote Q-0012', 'https://app.test/q/tok'],
    });
  });

  it('falls back to click-to-chat outside 24 hours with no template', async () => {
    const { service, user, channels, acceptance } = setup({
      lastInboundAgo: 30 * HOUR,
    });
    const result = await service.sendQuote(user, 'quote-1');

    expect(channels.sendMessage).not.toHaveBeenCalled();
    expect(acceptance.recordSent).not.toHaveBeenCalled();
    expect(result.method).toBe('CLICK_TO_CHAT');
    expect(result.reason).toContain('24 hours');
    expect(result.chatUrl).toMatch(/^https:\/\/wa\.me\/971501234567\?text=/);
    expect(decodeURIComponent(result.chatUrl!.split('text=')[1])).toContain(
      'https://app.test/q/tok',
    );
  });

  it('falls back to click-to-chat for a customer who never wrote and no template', async () => {
    const { service, user, channels, contacts } = setup({
      lastInboundAgo: null,
    });
    const result = await service.sendProof(user, 'quote-1');
    expect(result.method).toBe('CLICK_TO_CHAT');
    expect(channels.sendMessage).not.toHaveBeenCalled();
    expect(contacts.findOrCreateForChannel).not.toHaveBeenCalled();
  });

  it('starts a thread for a customer who never wrote when the template sends', async () => {
    const { service, user, channels } = setup({
      lastInboundAgo: null,
      template: 'kerf_document',
    });
    await service.sendProof(user, 'quote-1');
    expect(channels.sendMessage.mock.calls[0][2]).toMatchObject({
      contactId: 'contact-new',
      metadata: { document: { kind: 'proof', id: 'proof-1' } },
      template: {
        parameters: ['artwork proof 2 for Q-0012', 'https://app.test/q/tok'],
      },
    });
  });

  it('falls back to click-to-chat when no WhatsApp number is connected', async () => {
    const { service, user, messages } = setup({
      connected: false,
      lastInboundAgo: HOUR,
    });
    const result = await service.sendInvoice(user, 'inv-1');
    expect(result).toMatchObject({
      method: 'CLICK_TO_CHAT',
      url: 'https://app.test/pay/tok',
    });
    expect(result.reason).toContain('not connected');
    expect(messages.findOne).not.toHaveBeenCalled();
  });

  it('falls back to click-to-chat for staff not allowed to send from the business number', async () => {
    const { service, user, channels } = setup({
      lastInboundAgo: HOUR,
      permissions: [PERMISSIONS.INVOICE_MANAGE],
    });
    const result = await service.sendInvoice(user, 'inv-1');
    expect(result.method).toBe('CLICK_TO_CHAT');
    expect(channels.sendMessage).not.toHaveBeenCalled();
  });

  it('falls back to click-to-chat when WhatsApp refuses the message', async () => {
    const { service, user, invoices } = setup({
      lastInboundAgo: HOUR,
      sendFails: true,
    });
    const result = await service.sendInvoice(user, 'inv-1');
    expect(result.method).toBe('CLICK_TO_CHAT');
    expect(result.reason).toContain('did not accept');
    expect(result.reason).not.toContain('Template not approved');
    expect(invoices.markSent).not.toHaveBeenCalled();
  });

  it('marks the invoice sent when the business number sends it', async () => {
    const { service, user, invoices } = setup({
      lastInboundAgo: HOUR,
      payUrl: null,
    });
    const result = await service.sendInvoice(user, 'inv-1');
    expect(result.method).toBe('CHANNEL');
    expect(result.text).toContain('INV-0007');
    expect(result.text).toContain('AED 1050.00');
    expect(invoices.markSent).toHaveBeenCalledWith(TENANT, 'inv-1');
  });

  it('uses a typed number instead of the one on the customer', async () => {
    const { service, user } = setup({ connected: false, phone: null });
    const result = await service.sendQuote(user, 'quote-1', {
      to: '+44 7700 900123',
    });
    expect(result.to).toBe('447700900123');
  });

  it('refuses when there is no usable number, before issuing a new link', async () => {
    const { service, user, acceptance } = setup({ phone: null });
    await expect(service.sendQuote(user, 'quote-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(acceptance.createLink).not.toHaveBeenCalled();
  });

  it('refuses a proof send when there is no proof', async () => {
    const { service, user, proofs } = setup();
    proofs.latestFor.mockResolvedValue(null);
    await expect(service.sendProof(user, 'quote-1')).rejects.toThrow(
      'no artwork proof',
    );
  });
});
