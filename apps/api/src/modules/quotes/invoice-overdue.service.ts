import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { AutomationEventBridgeService } from '../automations/services/automation-event-bridge.service';
import { TenantContextService } from '@/common/context/tenant-context.service';

const OVERDUE_STATUSES = [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID];

/** The columns of an `UPDATE … RETURNING *` row this sweep reads. */
interface ClaimedRow {
  id: string;
  tenant_id: string;
  invoice_number: string;
  customer_id: string | null;
  customer_email: string | null;
  amount: string | number;
  paid_amount: string | number | null;
  due_date: Date | null;
  status: InvoiceStatus;
}

/**
 * Daily sweep that fires an `invoice.overdue` automation event exactly once
 * per invoice, the moment its due date passes while unpaid or partially
 * paid. Reminder emails are then just an automation workflow built in the
 * existing studio — no bespoke email-sending code needed here.
 *
 * Each invoice is *claimed* with a conditional UPDATE before its event fires:
 * the WHERE re-checks status, due date and `overdue_notified_at` against the
 * row as it is now, and only writes that one column. So a payment recorded
 * since the sweep's SELECT is neither reverted (the old whole-entity save did
 * that) nor nagged about, and a second replica running the same cron finds
 * nothing left to claim.
 */
@Injectable()
export class InvoiceOverdueService {
  private readonly logger = new Logger(InvoiceOverdueService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly automationEventBridgeService: AutomationEventBridgeService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async detectOverdueInvoices(): Promise<void> {
    const overdue = await this.tenantContext.runAsSystem(() =>
      this.invoiceRepository.find({
        where: {
          status: In(OVERDUE_STATUSES),
          dueDate: LessThan(new Date()),
          overdueNotifiedAt: IsNull(),
        },
      }),
    );

    for (const candidate of overdue) {
      try {
        await this.tenantContext.runWithTenant(candidate.tenantId, () =>
          this.notifyOnce(candidate),
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Failed to emit invoice.overdue for ${candidate.id}: ${msg}`,
        );
      }
    }
  }

  private async notifyOnce(candidate: Invoice): Promise<void> {
    const now = new Date();
    const claim = await this.invoiceRepository
      .createQueryBuilder()
      .update(Invoice)
      .set({ overdueNotifiedAt: now })
      .where('id = :id', { id: candidate.id })
      .andWhere('tenant_id = :tenantId', { tenantId: candidate.tenantId })
      .andWhere('status IN (:...statuses)', { statuses: OVERDUE_STATUSES })
      .andWhere('due_date < :now', { now })
      .andWhere('overdue_notified_at IS NULL')
      .returning('*')
      .execute();

    const row = (claim.raw as ClaimedRow[] | undefined)?.[0];
    // Paid since the SELECT, or another replica claimed it first.
    if (!claim.affected || !row) return;

    try {
      await this.automationEventBridgeService.handleCrmEvent({
        tenantId: candidate.tenantId,
        eventType: 'invoice.overdue',
        entityId: candidate.id,
        data: {
          invoiceId: candidate.id,
          invoiceNumber: row.invoice_number ?? candidate.invoiceNumber,
          customerId: row.customer_id ?? candidate.customerId,
          customerEmail: row.customer_email ?? candidate.customerEmail,
          amount: Number(row.amount ?? candidate.amount),
          paidAmount: Number(row.paid_amount ?? 0),
          dueDate: row.due_date ?? candidate.dueDate,
        },
      });
    } catch (err) {
      // Release only our own claim, so tomorrow's run retries it.
      await this.invoiceRepository.update(
        { id: candidate.id, tenantId: candidate.tenantId, overdueNotifiedAt: now },
        { overdueNotifiedAt: null },
      );
      throw err;
    }
  }
}
