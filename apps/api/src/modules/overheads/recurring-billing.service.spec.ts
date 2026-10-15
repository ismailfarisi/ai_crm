import { PERMISSIONS } from '@saas/shared';
import { RecurringBillingService } from './recurring-billing.service';

const tenantId = '11111111-1111-1111-1111-111111111111';

function setup(over: Partial<any> = {}) {
  const claimed = new Set<string>();
  const occurrences: any[] = [];
  const row = {
    id: 'rec-1', tenantId, supplierId: 'sup-1', vendorName: 'Landlord', category: 'Rent & premises',
    amount: 10000, billingInterval: 'MONTHLY', startDate: '2026-07-01', endDate: null, taxCodeId: null,
    autoApprove: false, autoApproveById: null, spreadOverPeriod: false, createdById: 'u1',
    status: 'ACTIVE', nextBillingDate: new Date('2026-07-01T00:00:00Z'),
    ...over,
  };
  const occurrenceRepo = {
    // Emulates INSERT … ON CONFLICT DO NOTHING RETURNING
    claim: jest.fn(async (o: any) => {
      const key = `${o.recurringExpenseId}:${o.periodStart}`;
      if (claimed.has(key)) return null;
      claimed.add(key);
      const saved = { id: `occ-${occurrences.length + 1}`, attempts: 0, status: 'FAILED', error: 'in progress', ...o };
      occurrences.push(saved);
      return saved;
    }),
    reclaimFailed: jest.fn(async (): Promise<any> => null),
    findByPeriod: jest.fn(async (recurringExpenseId: string, periodStart: string) =>
      occurrences.find((x) => x.recurringExpenseId === recurringExpenseId && x.periodStart === periodStart) ?? null),
    update: jest.fn(async (id: string, patch: any) => Object.assign(occurrences.find((x) => x.id === id), patch)),
  };
  const payables = {
    create: jest.fn(async (_t: string, _a: string | null, input: any) => ({ id: `bill-${input.supplierInvoiceNumber}`, billNumber: 'BILL-1', ...input })),
    approve: jest.fn(async () => ({})),
  };
  const rbac = { resolveAccess: jest.fn(async (): Promise<any> => ({ permissions: [PERMISSIONS.BILL_APPROVE] })) };
  const notifications = { notifyHolders: jest.fn(async () => 1) };
  const audit = { record: jest.fn(async () => undefined) };
  const recurring = { update: jest.fn(async () => ({ affected: 1 })), find: jest.fn(async () => [row]) };
  const tenantContext = { runAsSystem: (fn: any) => fn(), runWithTenant: (_t: string, fn: any) => fn() };
  const service = new RecurringBillingService(
    recurring as any, occurrenceRepo as any, payables as any, rbac as any,
    notifications as any, audit as any, tenantContext as any,
  );
  return { service, row, occurrences, payables, rbac, notifications, audit, recurring, occurrenceRepo, tenantContext };
}

describe('RecurringBillingService', () => {
  it('catches up every missed period with one draft bill each, oldest first', async () => {
    const { service, row, payables } = setup();
    await service.generateFor(row as any, '2026-10-16');
    expect(payables.create).toHaveBeenCalledTimes(4);
    expect(payables.create.mock.calls.map((c) => c[2].billDate.toISOString().slice(0, 10)))
      .toEqual(['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']);
    expect(row.nextBillingDate.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(payables.approve).not.toHaveBeenCalled();
  });

  it('two concurrent runs produce one bill per period', async () => {
    const { service, row, payables } = setup();
    await Promise.all([service.generateFor({ ...row } as any, '2026-07-02'), service.generateFor({ ...row } as any, '2026-07-02')]);
    expect(payables.create).toHaveBeenCalledTimes(1);
  });

  it('builds the bill line with category, period and a stable invoice number', async () => {
    const { service, row, payables } = setup({ billingInterval: 'ANNUAL', spreadOverPeriod: true, amount: 120000, startDate: '2026-01-01', nextBillingDate: new Date('2026-01-01T00:00:00Z') });
    await service.generateFor(row as any, '2026-01-01');
    const input = payables.create.mock.calls[0][2];
    expect(input.supplierInvoiceNumber).toBe('REC-rec-1-2026-01-01');
    expect(input.lines).toEqual([expect.objectContaining({ qty: 1, unitCost: 120000, category: 'Rent & premises', servicePeriodStart: '2026-01-01', servicePeriodEnd: '2026-12-31' })]);
  });

  it('approves as the user who switched auto-approve on, with their current permissions', async () => {
    const { service, row, payables, rbac } = setup({ autoApprove: true, autoApproveById: 'u-boss' });
    await service.generateFor(row as any, '2026-07-01');
    expect(rbac.resolveAccess).toHaveBeenCalledWith('u-boss', tenantId);
    expect(payables.approve).toHaveBeenCalledWith(tenantId, expect.any(String), { userId: 'u-boss', permissions: [PERMISSIONS.BILL_APPROVE] });
  });

  it('leaves the bill as a draft and notifies when the approver lost bill:approve', async () => {
    const { service, row, payables, rbac, notifications } = setup({ autoApprove: true, autoApproveById: 'u-boss' });
    rbac.resolveAccess.mockResolvedValue({ permissions: [] });
    await service.generateFor(row as any, '2026-07-01');
    expect(payables.approve).not.toHaveBeenCalled();
    expect(notifications.notifyHolders).toHaveBeenCalledWith(tenantId, PERMISSIONS.FINANCE_MANAGE, expect.objectContaining({ title: expect.stringContaining('auto-approve') }));
  });

  it('marks a failed period FAILED, keeps the next date, notifies once', async () => {
    const { service, row, payables, occurrences, notifications } = setup();
    payables.create.mockRejectedValueOnce(new Error('Supplier not found'));
    await service.generateFor(row as any, '2026-07-01');
    expect(occurrences[0]).toMatchObject({ status: 'FAILED', error: 'Supplier not found', attempts: 1 });
    expect(row.nextBillingDate.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(notifications.notifyHolders).toHaveBeenCalledTimes(1);
  });

  it('stops at the first failed period so later bills wait (ordered catch-up)', async () => {
    const { service, row, payables } = setup();
    payables.create.mockRejectedValueOnce(new Error('Supplier not found'));
    await service.generateFor(row as any, '2026-10-16');
    expect(payables.create).toHaveBeenCalledTimes(1);
  });

  it('retries a FAILED period it reclaims, without notifying again', async () => {
    const { service, row, payables, occurrenceRepo, notifications, occurrences } = setup();
    payables.create.mockRejectedValueOnce(new Error('Supplier not found'));
    await service.generateFor(row as any, '2026-07-01');
    occurrenceRepo.reclaimFailed.mockImplementationOnce(async () => ({ ...occurrences[0], error: 'in progress' }));
    await service.generateFor(row as any, '2026-07-01');
    expect(payables.create).toHaveBeenCalledTimes(2);
    expect(occurrences[0]).toMatchObject({ status: 'GENERATED', attempts: 2 });
    expect(notifications.notifyHolders).toHaveBeenCalledTimes(1);
    expect(row.nextBillingDate.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('skips past a period another run already generated', async () => {
    const { service, row, payables, occurrences, occurrenceRepo } = setup();
    occurrenceRepo.claim.mockResolvedValueOnce(null);
    occurrences.push({ id: 'occ-x', recurringExpenseId: 'rec-1', periodStart: '2026-07-01', status: 'GENERATED', error: null, attempts: 1 });
    await service.generateFor(row as any, '2026-08-01');
    expect(payables.create).toHaveBeenCalledTimes(1);
    expect(payables.create.mock.calls[0][2].billDate.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('does not move past a period another run still holds, and stays quiet while it is fresh', async () => {
    const { service, row, payables, occurrenceRepo, recurring, notifications } = setup();
    const error = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    occurrenceRepo.claim.mockResolvedValueOnce(null);
    occurrenceRepo.findByPeriod.mockResolvedValueOnce({ status: 'FAILED', error: 'in progress', updatedAt: new Date(Date.now() - 59 * 60 * 1000) });
    await service.generateFor(row as any, '2026-08-01');
    expect(payables.create).not.toHaveBeenCalled();
    expect(recurring.update).not.toHaveBeenCalled();
    expect(notifications.notifyHolders).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('reports a period stuck in progress for over an hour, without billing it', async () => {
    const { service, row, payables, occurrenceRepo, recurring, notifications } = setup();
    const error = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    occurrenceRepo.claim.mockResolvedValueOnce(null);
    occurrenceRepo.findByPeriod.mockResolvedValueOnce({ status: 'FAILED', error: 'in progress', updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
    await service.generateFor(row as any, '2026-08-01');
    expect(payables.create).not.toHaveBeenCalled();
    expect(recurring.update).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/tenant 1111.*schedule rec-1.*period 2026-07-01/));
    expect(notifications.notifyHolders).toHaveBeenCalledTimes(1);
    expect(notifications.notifyHolders).toHaveBeenCalledWith(tenantId, PERMISSIONS.FINANCE_MANAGE, expect.objectContaining({
      type: 'RECURRING_EXPENSE_FAILED', link: '/finance/subscriptions', entityType: 'RECURRING_EXPENSE', entityId: 'rec-1',
      title: expect.stringMatching(/Landlord.*2026-07-01.*stuck/),
    }));
  });

  it('reports an error after the bill was created, keeps the claim and stops catch-up', async () => {
    const { service, row, occurrences, occurrenceRepo, payables, notifications } = setup();
    const error = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    occurrenceRepo.update.mockRejectedValueOnce(new Error('connection lost'));
    await service.generateFor(row as any, '2026-10-16');
    expect(payables.create).toHaveBeenCalledTimes(1);
    // Stays claimed ("in progress"), so no run can bill it a second time.
    expect(occurrences[0]).toMatchObject({ status: 'FAILED', error: 'in progress', attempts: 0 });
    expect(row.nextBillingDate.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
    expect(notifications.notifyHolders).toHaveBeenCalledTimes(1);
    expect(notifications.notifyHolders).toHaveBeenCalledWith(tenantId, PERMISSIONS.FINANCE_MANAGE, expect.objectContaining({
      type: 'RECURRING_EXPENSE_FAILED', entityId: 'rec-1', title: expect.stringContaining('stuck'), body: expect.stringContaining('BILL-1'),
    }));
  });

  it('stops at the end date', async () => {
    const { service, row, payables } = setup({ endDate: '2026-09-01' });
    await service.generateFor(row as any, '2026-10-16');
    expect(payables.create).toHaveBeenCalledTimes(2);
  });

  it('uses the amount at generation time (edits apply to future periods only)', async () => {
    const { service, row, payables } = setup();
    await service.generateFor(row as any, '2026-07-01');
    row.amount = 10500;
    await service.generateFor(row as any, '2026-08-01');
    expect(payables.create.mock.calls.map((c) => c[2].lines[0].unitCost)).toEqual([10000, 10500]);
  });

  it('records an audit row per generated bill', async () => {
    const { service, row, audit } = setup();
    await service.generateFor(row as any, '2026-07-01');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId, subjectType: 'RECURRING_EXPENSE', subjectId: 'rec-1', channel: 'SYSTEM' }));
  });

  it('run() bills each due row inside its tenant and survives one row failing', async () => {
    const { service, recurring, row, payables, tenantContext } = setup();
    const broken = { ...row, id: 'rec-2', tenantId: 'other' };
    tenantContext.runWithTenant = (t: string, fn: any) => (t === 'other' ? Promise.reject(new Error('boom')) : fn());
    recurring.find.mockResolvedValueOnce([broken, row]);
    await service.run('2026-07-01');
    expect(payables.create).toHaveBeenCalledTimes(1);
  });
});
