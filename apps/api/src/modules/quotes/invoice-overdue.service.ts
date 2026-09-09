import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { AutomationEventBridgeService } from '../automations/services/automation-event-bridge.service';

/**
 * Daily sweep that fires an `invoice.overdue` automation event exactly once
 * per invoice, the moment its due date passes while unpaid or partially
 * paid. Reminder emails are then just an automation workflow built in the
 * existing studio — no bespoke email-sending code needed here.
 */
@Injectable()
export class InvoiceOverdueService {
  private readonly logger = new Logger(InvoiceOverdueService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly automationEventBridgeService: AutomationEventBridgeService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async detectOverdueInvoices(): Promise<void> {
    const overdue = await this.invoiceRepository.find({
      where: {
        status: In([InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID]),
        dueDate: LessThan(new Date()),
        overdueNotifiedAt: IsNull(),
      },
    });

    for (const invoice of overdue) {
      try {
        await this.automationEventBridgeService.handleCrmEvent({
          tenantId: invoice.tenantId,
          eventType: 'invoice.overdue',
          entityId: invoice.id,
          data: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            customerId: invoice.customerId,
            customerEmail: invoice.customerEmail,
            amount: invoice.amount,
            paidAmount: invoice.paidAmount,
            dueDate: invoice.dueDate,
          },
        });
        invoice.overdueNotifiedAt = new Date();
        await this.invoiceRepository.save(invoice);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Left un-marked so it retries on tomorrow's run.
        this.logger.warn(
          `Failed to emit invoice.overdue for ${invoice.id}: ${msg}`,
        );
      }
    }
  }
}
