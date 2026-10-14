import { Repository } from 'typeorm';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { AutomationEventBridgeService } from '../automations/services/automation-event-bridge.service';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { InvoiceOverdueService } from './invoice-overdue.service';

describe('InvoiceOverdueService', () => {
  it('discovers invoices as system and processes each invoice in its tenant', async () => {
    const invoice = {
      id: 'invoice-id',
      tenantId: 'tenant-id',
      invoiceNumber: 'INV-1',
      customerId: 'customer-id',
      customerEmail: 'customer@example.com',
      amount: '100.00',
      paidAmount: '0.00',
      dueDate: new Date('2026-01-01'),
      status: InvoiceStatus.ISSUED,
    } as Invoice;
    const invoiceRepository = {
      find: jest.fn().mockResolvedValue([invoice]),
      save: jest.fn().mockResolvedValue(invoice),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {
          update: () => qb,
          set: () => qb,
          where: () => qb,
          andWhere: () => qb,
          returning: () => qb,
          execute: jest.fn().mockResolvedValue({
            affected: 1,
            raw: [{ id: invoice.id, paid_amount: '0.00', status: 'ISSUED' }],
          }),
        };
        return qb;
      }),
    } as unknown as Repository<Invoice>;
    const automationEventBridgeService = {
      handleCrmEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as AutomationEventBridgeService;
    const tenantContext = {
      runAsSystem: jest.fn(async <T>(callback: () => Promise<T>) => callback()),
      runWithTenant: jest.fn(
        async <T>(_tenantId: string, callback: () => Promise<T>) => callback(),
      ),
    } as unknown as TenantContextService;
    const service = new InvoiceOverdueService(
      invoiceRepository,
      automationEventBridgeService,
      tenantContext,
    );

    await service.detectOverdueInvoices();

    expect(tenantContext.runAsSystem).toHaveBeenCalledTimes(1);
    expect(tenantContext.runWithTenant).toHaveBeenCalledWith(
      'tenant-id',
      expect.any(Function),
    );
    expect(
      automationEventBridgeService.handleCrmEvent,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-id', eventType: 'invoice.overdue' }),
    );
    expect(invoiceRepository.save).not.toHaveBeenCalled();
  });
});

describe('InvoiceOverdueService — claiming each invoice', () => {
  const invoice = {
    id: 'invoice-id',
    tenantId: 'tenant-id',
    invoiceNumber: 'INV-1',
    amount: '100.00',
    paidAmount: '0.00',
    dueDate: new Date('2026-01-01'),
    status: InvoiceStatus.ISSUED,
    overdueNotifiedAt: null,
  } as unknown as Invoice;

  const build = (claimed: boolean) => {
    const qb: any = {
      update: jest.fn(() => qb),
      set: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      returning: jest.fn(() => qb),
      execute: jest.fn().mockResolvedValue({
        affected: claimed ? 1 : 0,
        raw: claimed
          ? [{ id: invoice.id, paid_amount: '40.00', status: 'PARTIALLY_PAID' }]
          : [],
      }),
    };
    const invoiceRepository = {
      find: jest.fn().mockResolvedValue([{ ...invoice }]),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qb),
    } as unknown as Repository<Invoice>;
    const events = {
      handleCrmEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as AutomationEventBridgeService;
    const tenantContext = {
      runAsSystem: jest.fn(async <T>(cb: () => Promise<T>) => cb()),
      runWithTenant: jest.fn(async <T>(_t: string, cb: () => Promise<T>) =>
        cb(),
      ),
    } as unknown as TenantContextService;
    return {
      qb,
      invoiceRepository,
      events,
      service: new InvoiceOverdueService(
        invoiceRepository,
        events,
        tenantContext,
      ),
    };
  };

  it('claims with a conditional update so a paid or already-notified invoice is skipped', async () => {
    const { qb, invoiceRepository, service } = build(true);

    await service.detectOverdueInvoices();

    expect(invoiceRepository.save).not.toHaveBeenCalled();
    const conditions = qb.andWhere.mock.calls.map((c: unknown[]) => c[0]);
    expect(conditions).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/overdue_notified_at IS NULL/),
        expect.stringMatching(/status IN/),
      ]),
    );
  });

  it('emits the event with the row as it is now, not as the sweep found it', async () => {
    const { events, service } = build(true);

    await service.detectOverdueInvoices();

    expect(events.handleCrmEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'invoice.overdue',
        data: expect.objectContaining({ paidAmount: 40 }),
      }),
    );
  });

  it('emits nothing when another replica (or a payment) got there first', async () => {
    const { events, service } = build(false);

    await service.detectOverdueInvoices();

    expect(events.handleCrmEvent).not.toHaveBeenCalled();
  });

  it('releases the claim when the event fails, so tomorrow retries it', async () => {
    const { events, invoiceRepository, service } = build(true);
    (events.handleCrmEvent as jest.Mock).mockRejectedValue(new Error('down'));

    await service.detectOverdueInvoices();

    expect(invoiceRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: invoice.id }),
      { overdueNotifiedAt: null },
    );
  });
});