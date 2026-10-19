import { AuthService } from './auth.service';

describe('AuthService starter tax codes', () => {
  it('gives a new tenant zero-rated ZERO codes, so UAE VAT mode can keep them', async () => {
    const none = {} as any;
    const service = new AuthService(none, none, none, none, none, none, none, none, none, none);
    const manager = { query: jest.fn(async () => []) };

    await (service as any).provisionStarterTaxCodes('t1', manager);

    const [sql, params] = manager.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('"treatment"');
    expect(sql).toContain(`($1, 'ZERO', 'No tax (0%)', 0, 'SALES', false, true, 'ZERO_RATED')`);
    expect(sql).toContain(`($1, 'ZERO', 'No tax (0%)', 0, 'PURCHASE', false, true, 'ZERO_RATED')`);
    expect(params).toEqual(['t1']);
  });
});
