import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import {
  LEDGER_ROLES,
  PERMISSIONS,
  round2,
  type JournalLineInput,
  type PensionPeriodDto,
  type PensionRemittanceDto,
  type RemitPensionPayload,
} from '@saas/shared';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { LedgerService } from '../finance/ledger.service';
import { baseCurrencyFor } from '../finance/fx';
import { PayrollRun, PayrollRunLine } from './entities/payroll-run.entity';
import { PensionRemittance } from './entities/pension-remittance.entity';
import { POSTED_RUN_STATUSES } from './advances.service';
import { lockGratuityOpening } from './gratuity.service';
import { periodLabel } from './payroll-runs.service';
import type { PayrollActor } from './payroll-posting.service';

const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const todayUtc = () => dayToDate(new Date().toISOString().slice(0, 10));

/** Month-by-month payment of withheld and employer pension to the fund. */
@Injectable()
export class PensionRemittanceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
  ) {}

  async period(tenantId: string, period: string): Promise<PensionPeriodDto> {
    const manager = this.dataSource.manager;
    const run = await this.postedRun(manager, tenantId, period);
    const lines = run
      ? (
          await manager
            .getRepository(PayrollRunLine)
            .find({ where: { tenantId, runId: run.id } })
        ).filter((l) => (l.pensionEmployee ?? 0) + (l.pensionEmployer ?? 0) > 0)
      : [];
    const live = await this.liveRemittance(manager, tenantId, period);
    const employeeTotal = round2(
      lines.reduce((s, l) => s + (l.pensionEmployee ?? 0), 0),
    );
    const employerTotal = round2(
      lines.reduce((s, l) => s + (l.pensionEmployer ?? 0), 0),
    );
    return {
      period,
      employeeTotal,
      employerTotal,
      due: live ? 0 : round2(employeeTotal + employerTotal),
      lines: lines.map((l) => ({
        employeeId: l.employeeId,
        employeeName: l.employeeName,
        schemeName: l.pensionSchemeName ?? null,
        base: l.pensionBase ?? 0,
        employee: l.pensionEmployee ?? 0,
        employer: l.pensionEmployer ?? 0,
      })),
      remittance: live ? this.toDto(live) : null,
    };
  }

  async remit(
    tenantId: string,
    period: string,
    actor: PayrollActor,
    input: RemitPensionPayload,
  ): Promise<PensionRemittanceDto> {
    this.assertCanPay(actor);
    const label = periodLabel(period);

    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        // Serialises with run approvals and voids, whose guards read these rows.
        await lockGratuityOpening(manager, tenantId);

        const run = await this.postedRun(manager, tenantId, period);
        if (!run) {
          throw new ConflictException(`Approve payroll for ${label} first`);
        }
        if (await this.liveRemittance(manager, tenantId, period)) {
          throw new ConflictException(`Pension for ${label} is already remitted`);
        }
        const lines = await manager
          .getRepository(PayrollRunLine)
          .find({ where: { tenantId, runId: run.id } });
        const amount = round2(
          lines.reduce(
            (s, l) => s + (l.pensionEmployee ?? 0) + (l.pensionEmployer ?? 0),
            0,
          ),
        );
        if (amount <= 0) {
          throw new ConflictException(`No pension is due for ${label}`);
        }

        const account = await manager
          .getRepository(FinanceAccount)
          .findOne({ where: { id: input.financeAccountId, tenantId } });
        if (!account) throw new NotFoundException('Account not found');
        const base = await baseCurrencyFor(manager, tenantId);
        if ((account.currency ?? '').trim().toUpperCase() !== base) {
          throw new BadRequestException(`Pay pension from a ${base} account`);
        }

        const paidAt = input.paidAt ?? new Date();
        const description = `Pension remittance (${label})`;
        const resolved = await this.ledger.resolveLines(
          tenantId,
          [
            {
              role: LEDGER_ROLES.PENSION_PAYABLE,
              accountName: 'Pension contributions payable',
              debit: amount,
              credit: 0,
              description,
            },
            {
              financeAccountId: account.id,
              accountName: account.name,
              debit: 0,
              credit: amount,
              description,
            },
          ],
          manager,
        );

        const remittanceId = randomUUID();
        const entries = manager.getRepository(JournalEntry);
        const entry = await entries.save(
          entries.create({
            tenantId,
            entryNumber: `JE-PENSION-${period}`,
            referenceType: 'PENSION_REMITTANCE',
            referenceId: remittanceId,
            entryDate: paidAt,
            totalAmount: amount,
            currency: base,
            fxRate: 1,
            lines: resolved,
          }),
        );
        // The partial unique index rejects a racing second remittance here.
        const remittances = manager.getRepository(PensionRemittance);
        const row = await remittances.save(
          remittances.create({
            id: remittanceId,
            tenantId,
            period,
            amount,
            financeAccountId: account.id,
            paidAt,
            journalEntryId: entry.id,
            voidJournalEntryId: null,
            voidedAt: null,
            createdById: actor.userId,
          }),
        );
        await manager.query(
          `UPDATE "finance_accounts" SET "balance" = "balance" - $1, "updatedAt" = now()
           WHERE "id" = $2 AND "tenantId" = $3`,
          [amount, account.id, tenantId],
        );
        return row;
      });
      return this.toDto(saved);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string })?.code === '23505'
      ) {
        throw new ConflictException(`Pension for ${label} is already remitted`);
      }
      throw err;
    }
  }

  async void(
    tenantId: string,
    period: string,
    actor: PayrollActor,
  ): Promise<PensionRemittanceDto> {
    this.assertCanPay(actor);

    const voided = await this.dataSource.transaction(async (manager) => {
      await lockGratuityOpening(manager, tenantId);

      const live = await this.liveRemittance(manager, tenantId, period);
      if (!live) {
        throw new NotFoundException(
          `No pension remittance for ${periodLabel(period)}`,
        );
      }
      const entries = manager.getRepository(JournalEntry);
      const original = await entries.findOne({
        where: { id: live.journalEntryId, tenantId },
      });
      if (!original) {
        throw new NotFoundException('Journal entry for the remittance not found');
      }
      const description = `Void of pension remittance (${periodLabel(period)})`;
      const resolved = await this.ledger.resolveLines(
        tenantId,
        original.lines.map((l): JournalLineInput => ({
          ledgerAccountId: l.ledgerAccountId,
          accountName: l.accountName,
          debit: l.credit,
          credit: l.debit,
          description,
        })),
        manager,
      );
      const reversal = await entries.save(
        entries.create({
          tenantId,
          entryNumber: `JE-PENSION-${period}-VOID`,
          referenceType: 'PENSION_REMITTANCE',
          referenceId: live.id,
          // Never before the entry it reverses.
          entryDate: new Date(
            Math.max(
              todayUtc().getTime(),
              new Date(original.entryDate).getTime(),
            ),
          ),
          totalAmount: original.totalAmount,
          currency: original.currency,
          fxRate: 1,
          lines: resolved,
        }),
      );

      await manager.query(
        `UPDATE "finance_accounts" SET "balance" = "balance" + $1, "updatedAt" = now()
         WHERE "id" = $2 AND "tenantId" = $3`,
        [live.amount, live.financeAccountId, tenantId],
      );

      const voidedAt = new Date();
      await manager
        .getRepository(PensionRemittance)
        .update(
          { id: live.id, tenantId },
          { voidedAt, voidJournalEntryId: reversal.id },
        );
      live.voidedAt = voidedAt;
      live.voidJournalEntryId = reversal.id;
      return live;
    });
    return this.toDto(voided);
  }

  private async postedRun(
    manager: EntityManager,
    tenantId: string,
    period: string,
  ): Promise<PayrollRun | null> {
    const runs = await manager
      .getRepository(PayrollRun)
      .find({ where: { tenantId, period } });
    return runs.find((r) => POSTED_RUN_STATUSES.includes(r.status)) ?? null;
  }

  private async liveRemittance(
    manager: EntityManager,
    tenantId: string,
    period: string,
  ): Promise<PensionRemittance | null> {
    const rows = await manager
      .getRepository(PensionRemittance)
      .find({ where: { tenantId, period } });
    return rows.find((r) => !r.voidedAt) ?? null;
  }

  private assertCanPay(actor: PayrollActor): void {
    if (!actor.permissions.includes(PERMISSIONS.PAYROLL_PAY)) {
      throw new ForbiddenException('You do not have permission to remit pension.');
    }
  }

  private toDto(r: PensionRemittance): PensionRemittanceDto {
    return {
      id: r.id,
      period: r.period,
      amount: r.amount,
      financeAccountId: r.financeAccountId,
      paidAt: new Date(r.paidAt).toISOString(),
      voidedAt: r.voidedAt ? new Date(r.voidedAt).toISOString() : null,
      createdAt: new Date(r.createdAt ?? Date.now()).toISOString(),
    };
  }
}
