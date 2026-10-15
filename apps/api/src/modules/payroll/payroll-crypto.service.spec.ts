import { PayrollCryptoService } from './payroll-crypto.service';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('PayrollCryptoService', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const s = new PayrollCryptoService({ PAYROLL_DATA_KEY: KEY, NODE_ENV: 'test' } as any);
    const a = s.encrypt('AE070331234567890123456');
    const b = s.encrypt('AE070331234567890123456');
    expect(a).not.toBe(b);
    expect(s.decrypt(a)).toBe('AE070331234567890123456');
  });

  it('rejects tampered ciphertext', () => {
    const s = new PayrollCryptoService({ PAYROLL_DATA_KEY: KEY, NODE_ENV: 'test' } as any);
    const c = Buffer.from(s.encrypt('AE07'), 'base64');
    c[c.length - 1] ^= 1;
    expect(() => s.decrypt(c.toString('base64'))).toThrow();
  });

  it('refuses to start in production without a valid key', () => {
    expect(() => new PayrollCryptoService({ NODE_ENV: 'production' } as any)).toThrow(/PAYROLL_DATA_KEY/);
    expect(() => new PayrollCryptoService({ NODE_ENV: 'production', PAYROLL_DATA_KEY: 'short' } as any)).toThrow(/32 bytes/);
  });

  it('uses a dev key outside production', () => {
    expect(() => new PayrollCryptoService({ NODE_ENV: 'development' } as any)).not.toThrow();
  });
});
