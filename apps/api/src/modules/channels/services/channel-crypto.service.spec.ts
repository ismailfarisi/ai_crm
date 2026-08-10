import { ChannelCryptoService } from './channel-crypto.service';

describe('ChannelCryptoService', () => {
  let service: ChannelCryptoService;

  beforeEach(() => {
    service = new ChannelCryptoService('secret-key-32-characters-length!!');
  });

  it('should encrypt and decrypt credentials JSON cleanly', () => {
    const payload = { botToken: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11' };
    const encrypted = service.encrypt(payload);
    expect(encrypted).not.toContain('123456:ABC-DEF');

    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toEqual(payload);
  });
});
