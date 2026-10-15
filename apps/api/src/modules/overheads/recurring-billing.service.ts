import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, LessThanOrEqual, Not, Repository } from 'typeorm';
import {
  dueOccurrences,
  occurrenceDate,
  periodFor,
  PERMISSIONS,
  utcToday,
} from '@saas/shared';
import { RecurringExpense } from '../finance/entities/recurring-expense.entity';
import { PayablesService } from '../payables/payables.service';
import type { SupplierBill } from '../payables/entities/supplier-bill.entity';
import { RbacService } from '../rbac/rbac.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { OccurrenceStore } from './occurrence.store';

/**
 * Turns recurring expenses into supplier bills when they fall due.
 *
 * Runs in the API process (the Temporal worker has no ScheduleModule). Each
 * period is claimed by inserting its occurrence row first, so replicas and
 * re-runs cannot bill a period twice; a missed day catches up oldest first,
 * and stops at the first period that fails or that another run still holds,
 * so bills are always generated in order.
 */
@Injectable()
export class RecurringBillingService {
  private readonly logger = new Logger(RecurringBillingService.name);

  constructor(
    @InjectRepository(RecurringExpense)
    private readonly recurring: Repository<RecurringExpense>,
    private readonly occurrences: OccurrenceStore,
    private readonly payables: PayablesService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cron(): Promise<void> {
    await this.run();
  }

  async run(today: string = utcToday()): Promise<void> {
    const due = await this.tenantContext.runAsSystem(() =>
      this.recurring.find({
        where: {
          status: 'ACTIVE',
          supplierId: Not(IsNull()),
          nextBillingDate: LessThanOrEqual(new Date(`${today}T23:59:59.999Z`)),
        },
      }),
    );
    for (const row of due) {
      try {
        await this.tenantContext.runWithTenant(row.tenantId, () =>
          this.generateFor(row, today),
        );
      } catch (err) {
        this.logger.warn(
          `Recurring expense ${row.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  async generateFor(row: RecurringExpense, today: string): Promise<void> {
    const fromIndex = this.indexOf(row);
    const due = dueOccurrences({
      startDate: row.startDate,
      endDate: row.endDate,
      interval: row.billingInterval,
      fromIndex,
      today,
    });
    for (const n of due) {
      const period = periodFor(row.startDate, n, row.billingInterval);
      const claim =
        (await this.occurrences.claim({
          tenantId: row.tenantId,
          recurringExpenseId: row.id,
          occurrenceIndex: n,
          periodStart: period.start,
          periodEnd: period.end,
          amount: row.amount,
        })) ?? (await this.occurrences.reclaimFailed(row.id, period.start));

      if (!claim) {
        const existing = await this.occurrences.findByPeriod(
          row.id,
          period.start,
        );
        if (existing?.status === 'GENERATED') {
          // Another run billed it: move past it.
          await this.advance(row, n + 1);
          continue;
        }
        // Another run holds it (or crashed holding it). Later periods wait.
        return;
      }

      const attempts = claim.attempts + 1;
      let bill: SupplierBill;
      try {
        bill = await this.payables.create(row.tenantId, row.createdById, {
          supplierId: row.supplierId!,
          purchaseOrderId: null,
          // Stable per period: PayablesService rejects a duplicate supplier
          // invoice number, a second guard against billing a period twice.
          supplierInvoiceNumber: `REC-${row.id}-${period.start}`,
          billDate: new Date(`${period.start}T00:00:00Z`),
          dueDate: null,
          taxAmount: 0,
          taxCodeId: row.taxCodeId,
          notes: `Generated from recurring expense "${row.vendorName}" for ${period.start} – ${period.end}`,
          lines: [
            {
              purchaseOrderLineId: null,
              description:
                `${row.vendorName} — ${row.category} (${period.start} – ${period.end})`.slice(
                  0,
                  255,
                ),
              qty: 1,
              unitCost: row.amount,
              category: row.category,
              servicePeriodStart: row.spreadOverPeriod ? period.start : null,
              servicePeriodEnd: row.spreadOverPeriod ? period.end : null,
            },
          ],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.occurrences.update(claim.id, {
          status: 'FAILED',
          error: message.slice(0, 1000),
          attempts,
        });
        if (attempts === 1) {
          await this.notifications.notifyHolders(
            row.tenantId,
            PERMISSIONS.FINANCE_MANAGE,
            {
              type: 'RECURRING_EXPENSE_FAILED',
              title: `Could not create the ${row.vendorName} bill for ${period.start}`,
              body: message,
              link: '/finance/subscriptions',
              entityType: 'RECURRING_EXPENSE',
              entityId: row.id,
            },
          );
        }
        // Later periods wait for this one: bills stay in order.
        return;
      }

      // The bill exists from here on. Anything that throws now leaves the
      // claim "in progress" — stuck, but never billed twice.
      await this.occurrences.update(claim.id, {
        status: 'GENERATED',
        billId: bill.id,
        error: null,
        attempts,
      });
      await this.advance(row, n + 1);

      await this.audit.record({
        tenantId: row.tenantId,
        action: 'recurring_expense.generate',
        subjectType: 'RECURRING_EXPENSE',
        subjectId: row.id,
        actorId: null,
        actorName: 'Recurring billing',
        channel: 'SYSTEM',
        summary: `${bill.billNumber} for ${row.vendorName}, ${period.start} – ${period.end}`,
        after: {
          billId: bill.id,
          periodStart: period.start,
          periodEnd: period.end,
          amount: row.amount,
        },
      });

      if (row.autoApprove)
        await this.autoApprove(row, bill.id, bill.billNumber);
    }
  }

  /**
   * Moves the schedule to occurrence `n`. Only the date column, and only
   * forwards: a whole-row save would revert an edit made since the row was
   * read, and a slower replica must not drag the date back.
   */
  private async advance(row: RecurringExpense, n: number): Promise<void> {
    const next = new Date(
      `${occurrenceDate(row.startDate, n, row.billingInterval)}T00:00:00Z`,
    );
    row.nextBillingDate = next;
    await this.recurring.update(
      { id: row.id, tenantId: row.tenantId, nextBillingDate: LessThan(next) },
      { nextBillingDate: next },
    );
  }

  private indexOf(row: RecurringExpense): number {
    // nextBillingDate is always an occurrence date; find its index from the anchor.
    const target = row.nextBillingDate.toISOString().slice(0, 10);
    let n = 0;
    while (
      n < 1200 &&
      occurrenceDate(row.startDate, n, row.billingInterval) < target
    )
      n++;
    return n;
  }

  private async autoApprove(
    row: RecurringExpense,
    billId: string,
    billNumber: string,
  ): Promise<void> {
    const approverId = row.autoApproveById;
    const access = approverId
      ? await this.rbac
          .resolveAccess(approverId, row.tenantId)
          .catch(() => null)
      : null;
    const link = `/purchasing/bills/${billId}`;
    if (
      !approverId ||
      !access?.permissions.includes(PERMISSIONS.BILL_APPROVE)
    ) {
      await this.notifications.notifyHolders(
        row.tenantId,
        PERMISSIONS.FINANCE_MANAGE,
        {
          type: 'RECURRING_EXPENSE_FAILED',
          title: `${billNumber} was left as a draft: auto-approve is set up by someone who can no longer approve bills`,
          link,
          entityType: 'BILL',
          entityId: billId,
        },
      );
      return;
    }
    try {
      await this.payables.approve(row.tenantId, billId, {
        userId: approverId,
        permissions: access.permissions,
      });
    } catch (err) {
      await this.notifications.notifyHolders(
        row.tenantId,
        PERMISSIONS.FINANCE_MANAGE,
        {
          type: 'RECURRING_EXPENSE_FAILED',
          title: `${billNumber} could not be auto-approved`,
          body: err instanceof Error ? err.message : String(err),
          link,
          entityType: 'BILL',
          entityId: billId,
        },
      );
    }
  }
}
