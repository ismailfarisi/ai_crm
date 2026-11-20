/**
 * Turning what a channel reports about a sender, and what a customer record
 * holds, into values that can be compared for equality.
 *
 * Everything here fails closed: a value that cannot be read as exactly one
 * number or address gives `null`, and `null` never matches anything.
 */

export type SenderKind = 'phone' | 'email' | 'chat';

/** What a channel identifies a sender by. */
export function senderKind(provider: string): SenderKind | null {
  switch (provider) {
    case 'WHATSAPP_META':
      return 'phone';
    case 'EMAIL_SMTP':
    case 'EMAIL_RESEND':
      return 'email';
    case 'TELEGRAM':
    case 'SLACK':
      return 'chat';
    default:
      return null;
  }
}

/** One address and nothing else: no display name, list, comment or space. */
const PLAIN_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * The sender in the one form it is stored and compared in, or null when it
 * does not name exactly one person to reply to.
 *
 * The reply goes back to this same value, so it must not be something a mail
 * server or a chat platform would deliver to more than one party: an address
 * list (`a@x.com, b@y.com`), a `Name <address>` pair, or a group chat.
 */
export function canonicalSender(provider: string, raw: string): string | null {
  const value = String(raw ?? '').trim();
  switch (senderKind(provider)) {
    case 'phone': {
      const digits = /^\+?\d+$/.test(value) ? value.replace('+', '') : '';
      return isPhoneLength(digits) ? digits : null;
    }
    case 'email': {
      const lower = value.toLowerCase();
      return lower.length <= 255 && PLAIN_EMAIL.test(lower) ? lower : null;
    }
    case 'chat':
      // Telegram: a private chat id is positive; a group's is negative, and a
      // reply there is read by everyone in it. Slack: a member id.
      if (provider === 'TELEGRAM')
        return /^\d{1,20}$/.test(value) ? value : null;
      return /^[A-Z0-9]{3,40}$/.test(value) ? value : null;
    default:
      return null;
  }
}

const isPhoneLength = (digits: string) =>
  digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0');

/**
 * Dialling codes for reading a number typed without one ("050 123 4567").
 * A country missing here is not guessed: its national numbers match nobody
 * until they are stored with a `+`.
 */
const CALLING_CODES: Record<string, string> = {
  AE: '971',
  SA: '966',
  QA: '974',
  KW: '965',
  BH: '973',
  OM: '968',
  YE: '967',
  IQ: '964',
  JO: '962',
  LB: '961',
  SY: '963',
  EG: '20',
  TR: '90',
  IR: '98',
  PS: '970',
  IN: '91',
  PK: '92',
  BD: '880',
  LK: '94',
  NP: '977',
  AF: '93',
  CN: '86',
  HK: '852',
  JP: '81',
  KR: '82',
  SG: '65',
  MY: '60',
  ID: '62',
  TH: '66',
  VN: '84',
  PH: '63',
  AU: '61',
  NZ: '64',
  GB: '44',
  IE: '353',
  FR: '33',
  DE: '49',
  ES: '34',
  PT: '351',
  NL: '31',
  BE: '32',
  CH: '41',
  AT: '43',
  SE: '46',
  NO: '47',
  DK: '45',
  FI: '358',
  PL: '48',
  GR: '30',
  UA: '380',
  ZA: '27',
  NG: '234',
  KE: '254',
  ET: '251',
  TZ: '255',
  UG: '256',
  GH: '233',
  MA: '212',
  DZ: '213',
  TN: '216',
  LY: '218',
  SD: '249',
};

/**
 * The phone number on a record as full international digits, or null.
 *
 * `+971 50 123 4567` and `00971501234567` say their own country. A number
 * without either is read in `country` (the customer's, else the business's):
 * `050 123 4567` in the UAE is 971501234567. With no country it is not read
 * at all, because guessing one could match a stranger abroad who happens to
 * hold the same national number.
 */
export function phoneOnRecord(
  raw: string | null | undefined,
  country: string | null | undefined,
): string | null {
  const value = String(raw ?? '').trim();
  // Anything but one number: "050 111 2222 / 04 333 4444", "ext 12".
  if (!value || /[^\d+\s().-]/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  const plus = value.startsWith('+');
  if (value.indexOf('+', 1) !== -1) return null;

  let international: string;
  if (plus) international = digits;
  else if (digits.startsWith('00')) international = digits.slice(2);
  else {
    const code = country ? CALLING_CODES[country.toUpperCase()] : undefined;
    if (!code) return null;
    const national = digits.replace(/^0/, '');
    if (digits.startsWith(code) && digits.length >= code.length + 8) {
      // Already written out in full, only without the plus.
      international = digits;
    } else if (national.length >= 7) {
      international = code + national;
    } else return null;
  }
  return isPhoneLength(international) ? international : null;
}

/** The email address on a record, if it is exactly one plain address. */
export function emailOnRecord(raw: string | null | undefined): string | null {
  const lower = String(raw ?? '')
    .trim()
    .toLowerCase();
  return PLAIN_EMAIL.test(lower) ? lower : null;
}
