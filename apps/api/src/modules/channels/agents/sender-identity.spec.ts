import {
  canonicalSender,
  emailOnRecord,
  phoneOnRecord,
} from './sender-identity';

describe('canonicalSender', () => {
  it('reads a WhatsApp number with or without the plus', () => {
    expect(canonicalSender('WHATSAPP_META', '971501234567')).toBe(
      '971501234567',
    );
    expect(canonicalSender('WHATSAPP_META', '+971501234567')).toBe(
      '971501234567',
    );
  });

  it.each([
    '',
    'abc',
    '0501234567',
    '971 50 123 4567',
    '97150',
    '1'.repeat(16),
  ])('refuses %p as a WhatsApp sender', (raw) => {
    expect(canonicalSender('WHATSAPP_META', raw)).toBeNull();
  });

  it('lowercases a plain email address', () => {
    expect(canonicalSender('EMAIL_SMTP', ' Buyer@Acme.AE ')).toBe(
      'buyer@acme.ae',
    );
  });

  // The reply is sent to the sender string, so one that a mail server would
  // deliver to a second party must never be treated as the customer.
  it.each([
    'buyer@acme.ae, attacker@evil.test',
    'buyer@acme.ae;attacker@evil.test',
    'Buyer <buyer@acme.ae>',
    '"buyer@acme.ae" <attacker@evil.test>',
    'buyer@acme.ae\nBcc: attacker@evil.test',
    'buyer@acme.ae attacker@evil.test',
    'buyer@acme',
  ])('refuses %p as an email sender', (raw) => {
    expect(canonicalSender('EMAIL_SMTP', raw)).toBeNull();
    expect(canonicalSender('EMAIL_RESEND', raw)).toBeNull();
  });

  it('takes a private Telegram chat and refuses a group', () => {
    expect(canonicalSender('TELEGRAM', '55501234')).toBe('55501234');
    expect(canonicalSender('TELEGRAM', '-100123456')).toBeNull();
  });

  it('refuses a channel it does not know', () => {
    expect(canonicalSender('SMS', '971501234567')).toBeNull();
  });
});

describe('phoneOnRecord', () => {
  it.each([
    ['+971 50 123 4567', null, '971501234567'],
    ['00971-50-1234567', null, '971501234567'],
    ['050 123 4567', 'AE', '971501234567'],
    ['(050) 123-4567', 'ae', '971501234567'],
    ['50 123 4567', 'AE', '971501234567'],
    ['971501234567', 'AE', '971501234567'],
    ['07700 900123', 'GB', '447700900123'],
  ])('reads %p in %p as %p', (raw, country, expected) => {
    expect(phoneOnRecord(raw, country)).toBe(expected);
  });

  it.each([
    ['050 123 4567', null],
    ['050 123 4567', 'ZZ'],
    ['971501234567', null],
    ['050 123 4567 / 04 333 4444', 'AE'],
    ['+971501234567 +971502222222', 'AE'],
    ['050 123 4567 ext 12', 'AE'],
    ['', 'AE'],
    [null, 'AE'],
    ['12345', 'AE'],
  ])('does not guess at %p in %p', (raw, country) => {
    expect(phoneOnRecord(raw, country)).toBeNull();
  });

  it('never reads a national number as another country’s', () => {
    // A Saudi customer's 050 number is not the UAE number with those digits.
    expect(phoneOnRecord('050 123 4567', 'SA')).toBe('966501234567');
    expect(phoneOnRecord('050 123 4567', 'SA')).not.toBe(
      phoneOnRecord('050 123 4567', 'AE'),
    );
  });
});

describe('emailOnRecord', () => {
  it('lowercases one address and refuses a list', () => {
    expect(emailOnRecord(' Accounts@Acme.ae ')).toBe('accounts@acme.ae');
    expect(emailOnRecord('a@acme.ae, b@acme.ae')).toBeNull();
    expect(emailOnRecord(null)).toBeNull();
  });
});
