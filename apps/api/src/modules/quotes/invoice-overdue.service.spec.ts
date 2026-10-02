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
    expect(invoiceRepository.save).toHaveBeenCalledWith(invoice);
  });
});