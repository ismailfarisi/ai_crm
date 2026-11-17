import { approvalRecipients, itemStillPending } from './approval-recipients';

describe('approvalRecipients', () => {
  const manager = (ids: string[]) => ({
    query: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))),
  });

  it('asks for active holders of every permission in this tenant only', async () => {
    const m = manager(['a', 'b']);
    await approvalRecipients(m, 'tenant-1', [
      'quote:approve',
      'quote:approve_below_margin',
    ]);
    const [sql, params] = m.query.mock.calls[0];
    expect(params).toEqual([
      'tenant-1',
      ['quote:approve', 'quote:approve_below_margin'],
    ]);
    expect(sql).toContain('u."tenant_id" = $1');
    expect(sql).toContain('u."isActive"');
    expect(sql).toContain('cardinality($2::text[])');
    expect(sql).toContain('bool_or(r."grantsAllPermissions")');
  });

  it('leaves out the requester', async () => {
    const m = manager(['requester', 'approver']);
    expect(
      await approvalRecipients(m, 't', ['quote:approve'], 'requester'),
    ).toEqual(['approver']);
  });

  it('asks nobody when no permission is named', async () => {
    const m = manager(['a']);
    expect(await approvalRecipients(m, 't', [])).toEqual([]);
    expect(m.query).not.toHaveBeenCalled();
  });
});

describe('itemStillPending', () => {
  it('checks the item in its own tenant', async () => {
    const m = { query: jest.fn().mockResolvedValue([{}]) };
    expect(await itemStillPending(m, 't1', 'AUTOMATION_APPROVAL', 'a1')).toBe(
      true,
    );
    expect(m.query.mock.calls[0][1]).toEqual(['a1', 't1']);
    expect(m.query.mock.calls[0][0]).toContain(`"expiresAt" > now()`);
  });

  it('is false for an unknown item type', async () => {
    const m = { query: jest.fn() };
    expect(await itemStillPending(m, 't1', 'NOPE', 'x')).toBe(false);
  });
});
