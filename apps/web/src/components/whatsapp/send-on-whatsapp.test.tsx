import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { WhatsAppSendResultDto } from '@saas/shared';
import { SendOnWhatsAppButton } from './send-on-whatsapp';

const base: WhatsAppSendResultDto = {
  method: 'CHANNEL',
  to: '971501234567',
  text: 'Hello, here is your quote Q-0012: https://app/q/abc',
  url: 'https://app/q/abc',
  expiresAt: null,
  chatUrl: null,
  reason: null,
  usedTemplate: false,
  linkPending: false,
};

async function sendWith(result: WhatsAppSendResultDto, to = '') {
  const send = vi.fn().mockResolvedValue(result);
  render(<SendOnWhatsAppButton what="Q-0012" customerName="Al Noor" send={send} />);
  fireEvent.click(screen.getByRole('button', { name: /send on whatsapp/i }));
  if (to) fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: to } });
  const buttons = screen.getAllByRole('button', { name: /send on whatsapp/i });
  fireEvent.click(buttons[buttons.length - 1]);
  return send;
}

describe('SendOnWhatsAppButton', () => {
  it('says it was sent from the business number and is in the inbox', async () => {
    const send = await sendWith(base);
    expect(await screen.findByText('Sent on WhatsApp')).toBeTruthy();
    expect(screen.getByText(/sent from your business whatsapp number to \+971501234567/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /open whatsapp/i })).toBeNull();
    expect(send).toHaveBeenCalledWith(null);
  });

  it('says it was not sent and offers the click-to-chat link, with the reason', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const send = await sendWith(
      {
        ...base,
        method: 'CLICK_TO_CHAT',
        chatUrl: 'https://wa.me/971501234567?text=Hello',
        reason: 'No WhatsApp number is connected.',
      },
      '+971 50 123 4567',
    );
    expect(await screen.findByText('Send it from your own WhatsApp')).toBeTruthy();
    expect(screen.getByText(/not sent yet/i)).toBeTruthy();
    expect(screen.getByText('No WhatsApp number is connected.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /open whatsapp/i }));
    expect(open).toHaveBeenCalledWith(
      'https://wa.me/971501234567?text=Hello',
      '_blank',
      'noopener,noreferrer',
    );
    expect(send).toHaveBeenCalledWith('+971 50 123 4567');
  });

  it('only makes the new quote link once Open WhatsApp is pressed', async () => {
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ...base,
        method: 'CLICK_TO_CHAT',
        text: 'Hello, here is your quote Q-0012: [link]',
        url: null,
        reason: 'No WhatsApp number is connected.',
        linkPending: true,
      })
      .mockResolvedValueOnce({
        ...base,
        method: 'CLICK_TO_CHAT',
        chatUrl: 'https://wa.me/971501234567?text=Hello',
      });
    render(<SendOnWhatsAppButton what="Q-0012" customerName="Al Noor" send={send} />);
    fireEvent.click(screen.getByRole('button', { name: /send on whatsapp/i }));
    const buttons = screen.getAllByRole('button', { name: /send on whatsapp/i });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText(/any link they were sent before stops working/i)).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /open whatsapp/i }));
    await vi.waitFor(() => expect(tab.location.href).toBe('https://wa.me/971501234567?text=Hello'));
    expect(send).toHaveBeenLastCalledWith(null, true);
    expect(tab.opener).toBeNull();
  });

  it('shows why it could not send at all', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Al Noor has no mobile number on record.'));
    render(<SendOnWhatsAppButton what="Q-0012" customerName="Al Noor" send={send} />);
    fireEvent.click(screen.getByRole('button', { name: /send on whatsapp/i }));
    const buttons = screen.getAllByRole('button', { name: /send on whatsapp/i });
    fireEvent.click(buttons[buttons.length - 1]);
    expect((await screen.findByRole('alert')).textContent).toContain('no mobile number');
  });
});
