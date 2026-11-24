import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { ExpenseClaim } from './entities/expense-claim.entity';
import { FinanceAccount } from './entities/finance-account.entity';
import { CategoryBudget } from './entities/category-budget.entity';
import {
  JOURNAL_SINGLE_POSTING_INDEX,
  JournalEntry,
} from './entities/journal-entry.entity';
import { LedgerService } from './ledger.service';
import { BooksService } from './books.service';
import { baseCurrencyFor, cashAccountAmount, fxRateFor } from './fx';
import { TemporalService } from '../temporal/temporal.service';
import { AiService } from '../ai/ai.service';
import {
  AiNotConfiguredException,
  AiContentBlock,
  AiDocumentContent,
  AiImageContent,
} from '../ai/interfaces/ai-provider.interface';
import { expenseApprovalWorkflow } from './workflows/expense-approval.workflow';
import {
  approveExpenseSignal,
  rejectExpenseSignal,
  reimburseExpenseSignal,
} from './workflows/interfaces';
import {
  CreateExpenseClaimDto,
  UpdateExpenseClaimDto,
  SignalExpenseDto,
  ScanReceiptDto,
  ScannedReceiptResult,
  scannedReceiptResultSchema,
  scannedReceiptJsonSchema,
} from './dto';
import {
  EXPENSE_NOTES_MAX_LENGTH,
  LEDGER_ROLES,
  expenseCategoryRole,
  expenseClaimPostingLines,
  expenseClaimTax,
  expenseClaimTaxProblem,
  isUaeVatMode,
  isValidTrn,
  normaliseTrn,
  suggestExpenseTaxCode,
  type ExpenseClaimTax,
  type ExpenseStatus,
  type ExpenseTaxOptionsDto,
} from '@saas/shared';
import { TaxCode } from '../tax/entities/tax.entity';
import { Organization } from '../organizations/entities/organization.entity';
import {
  allocateNextSequenceValue,
  formatTenantSequenceNumber,
} from '../../database/tenant-sequence.util';
import { ShopEventsService } from '@/common/events';

const POSTGRES_UNIQUE_VIOLATION = '23505';

/** Trimmed, blank as null, and refused when it is longer than a paragraph. */
function cleanNotes(notes: string | null | undefined): string | null {
  const trimmed = typeof notes === 'string' ? notes.trim() : '';
  if (trimmed.length > EXPENSE_NOTES_MAX_LENGTH) {
    throw new BadRequestException(
      `Notes can be at most ${EXPENSE_NOTES_MAX_LENGTH} characters.`,
    );
  }
  return trimmed || null;
}

/** The supplier's tax number as stored: digits only when it is a TRN. */
function cleanTaxId(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  if (isValidTrn(trimmed)) return normaliseTrn(trimmed);
  if (trimmed.length > 32) {
    throw new BadRequestException(
      'The supplier tax number can be at most 32 characters.',
    );
  }
  return trimmed;
}

/** A second posting for a reference the database allows only one of. */
function isDuplicatePosting(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = (err.driverError ?? {}) as {
    code?: string;
    constraint?: string;
  };
  return (
    driverError.code === POSTGRES_UNIQUE_VIOLATION &&
    driverError.constraint === JOURNAL_SINGLE_POSTING_INDEX
  );
}

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    @InjectRepository(ExpenseClaim)
    private readonly expenseRepository: Repository<ExpenseClaim>,
    @InjectRepository(FinanceAccount)
    private readonly accountRepository: Repository<FinanceAccount>,
    @InjectRepository(CategoryBudget)
    private readonly budgetRepository: Repository<CategoryBudget>,
    @InjectRepository(JournalEntry)
    private readonly journalRepository: Repository<JournalEntry>,
    private readonly temporalService: TemporalService,
    private readonly aiService: AiService,
    private readonly ledger: LedgerService,
    @Optional()
    private readonly shopEvents?: ShopEventsService,
  ) {}

  async generateNextClaimNumber(tenantId: string): Promise<string> {
    const value = await allocateNextSequenceValue(
      this.expenseRepository.manager,
      tenantId,
      'claim_number',
    );
    return formatTenantSequenceNumber(
      this.expenseRepository.manager,
      tenantId,
      'claim_number',
      'EXP',
      value,
    );
  }

  async findAll(tenantId: string): Promise<ExpenseClaim[]> {
    return this.expenseRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<ExpenseClaim> {
    const claim = await this.expenseRepository.findOne({
      where: { id, tenantId },
    });

    if (!claim) {
      throw new NotFoundException(`Expense claim with ID ${id} not found`);
    }

    return claim;
  }

  async create(
    tenantId: string,
    dto: CreateExpenseClaimDto,
    currentUser?: { id?: string; name?: string; email?: string },
  ): Promise<ExpenseClaim> {
    const claimNumber =
      dto.claimNumber || (await this.generateNextClaimNumber(tenantId));
    const employeeId = dto.employeeId || currentUser?.id || 'employee-unknown';
    const employeeName =
      dto.employeeName || currentUser?.name || currentUser?.email || 'Employee';
    const items = dto.items || [];
    const status: ExpenseStatus = dto.status || 'SUBMITTED';
    const tax = await this.claimTaxFields(tenantId, {
      amount: dto.amount,
      taxCodeId: dto.taxCodeId,
      taxAmount: dto.taxAmount,
      supplierTaxId: dto.supplierTaxId,
    });

    const claim = this.expenseRepository.create({
      tenantId,
      claimNumber,
      employeeId,
      employeeName,
      category: dto.category || 'General Expense',
      amount: dto.amount,
      // Base currency when unstated: the claim posts converted into it, and a
      // made-up 'USD' would demand a rate for money nobody spent in dollars.
      currency:
        dto.currency ||
        (await baseCurrencyFor(this.expenseRepository.manager, tenantId)),
      status,
      merchantName: dto.merchantName || null,
      expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : new Date(),
      receiptUrl: dto.receiptUrl || null,
      notes: cleanNotes(dto.notes),
      items,
      ...tax,
    });

    const savedClaim = await this.expenseRepository.save(claim);
    const workflowId = `expense-${savedClaim.id}`;

    if (status === 'SUBMITTED') {
      try {
        const client = await this.temporalService.getClient();
        const handle = await client.workflow.start(expenseApprovalWorkflow, {
          taskQueue: 'finance-queue',
          workflowId,
          args: [
            {
              expenseId: savedClaim.id,
              tenantId,
              employeeId: savedClaim.employeeId,
              employeeName: savedClaim.employeeName,
              category: savedClaim.category,
              amount: Number(savedClaim.amount),
              currency: savedClaim.currency,
              items: savedClaim.items,
              merchantName: savedClaim.merchantName ?? undefined,
            },
          ],
        });
        savedClaim.temporalWorkflowId = handle.workflowId;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Temporal workflow start deferred/failed: ${msg}`);
        savedClaim.temporalWorkflowId = workflowId;
      }
      const submitted = await this.expenseRepository.save(savedClaim);
      await this.shopEvents?.emit('expense.submitted', tenantId, submitted.id);
      return submitted;
    }

    return savedClaim;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateExpenseClaimDto,
  ): Promise<ExpenseClaim> {
    const claim = await this.findById(tenantId, id);
    await this.assertNotPosted(tenantId, claim, dto);

    if (
      dto.amount !== undefined ||
      dto.taxCodeId !== undefined ||
      dto.taxAmount !== undefined ||
      dto.supplierTaxId !== undefined
    ) {
      // Choosing a different VAT type starts the VAT again from its rate
      // unless the amount is given with it.
      const sameCode =
        dto.taxCodeId === undefined || dto.taxCodeId === claim.taxCodeId;
      Object.assign(
        claim,
        await this.claimTaxFields(tenantId, {
          amount: dto.amount ?? claim.amount,
          taxCodeId:
            dto.taxCodeId === undefined ? claim.taxCodeId : dto.taxCodeId,
          taxAmount:
            dto.taxAmount !== undefined
              ? dto.taxAmount
              : sameCode && dto.amount === undefined
                ? claim.taxAmount
                : null,
          supplierTaxId:
            dto.supplierTaxId === undefined
              ? claim.supplierTaxId
              : dto.supplierTaxId,
        }),
      );
    }

    if (dto.category !== undefined) claim.category = dto.category;
    if (dto.amount !== undefined) claim.amount = dto.amount;
    if (dto.currency !== undefined) claim.currency = dto.currency;
    if (dto.merchantName !== undefined) claim.merchantName = dto.merchantName;
    if (dto.expenseDate !== undefined) {
      claim.expenseDate = dto.expenseDate
        ? new Date(dto.expenseDate)
        : new Date();
    }
    if (dto.receiptUrl !== undefined) claim.receiptUrl = dto.receiptUrl;
    if (dto.notes !== undefined) claim.notes = cleanNotes(dto.notes);
    if (dto.rejectionReason !== undefined) {
      claim.rejectionReason = dto.rejectionReason;
    }
    if (dto.items !== undefined) claim.items = dto.items;
    if (dto.status !== undefined) claim.status = dto.status;
    if (dto.employeeId !== undefined) claim.employeeId = dto.employeeId;
    if (dto.employeeName !== undefined) claim.employeeName = dto.employeeName;

    return this.expenseRepository.save(claim);
  }

  async sendSignal(
    tenantId: string,
    id: string,
    dto: SignalExpenseDto,
  ): Promise<ExpenseClaim> {
    if (
      dto.action !== 'APPROVE' &&
      dto.action !== 'REJECT' &&
      dto.action !== 'REIMBURSE'
    ) {
      throw new BadRequestException(`Invalid signal action: ${dto.action}`);
    }
    // The claimant is told why, so a rejection has to say.
    if (
      dto.action === 'REJECT' &&
      (typeof dto.reason !== 'string' || !dto.reason.trim())
    ) {
      throw new BadRequestException('Give a reason for rejecting the claim.');
    }

    /*
     * The status change, the journal entries and the account deduction
     * commit together or not at all. The claim row is locked first and its
     * status read under that lock, so two reimbursements of the same claim
     * queue rather than both passing the "already posted" check — the second
     * finds it PAID and is refused.
     *
     * Posting happens here, not in the workflow. The workflow's
     * `postJournalEntryActivity` only ever logged and returned a synthetic id,
     * so an approved claim never reached the ledger whether Temporal was
     * healthy or not. Doing it on the same path as every other posting site
     * keeps the books right regardless of whether the workflow ran, and both
     * entries are idempotent on `referenceId` — enforced by the partial unique
     * index `uq_journal_entries_single_posting` — so a retry or a later
     * workflow replay cannot double them.
     */
    let claim: ExpenseClaim;
    try {
      claim = await this.expenseRepository.manager.transaction(
        async (manager) => {
          const claims = manager.getRepository(ExpenseClaim);
          const locked = await claims.findOne({
            where: { id, tenantId },
            lock: { mode: 'pessimistic_write' },
          });
          if (!locked) {
            throw new NotFoundException(
              `Expense claim with ID ${id} not found`,
            );
          }

          if (ExpensesService.FINAL_STATUSES.includes(locked.status)) {
            throw new ConflictException(
              `Expense claim ${locked.claimNumber || locked.id} is already ${locked.status.toLowerCase()} and cannot be ${ExpensesService.ACTION_PAST[dto.action]}`,
            );
          }

          this.applyTransition(locked, dto);

          if (locked.status === 'REJECTED') {
            // An approved claim that is then rejected was already in the
            // books: take it, and its VAT, back out.
            await this.reverseExpenseAccrual(tenantId, locked, manager);
          } else if (locked.status === 'APPROVED') {
            await this.postExpenseAccrual(tenantId, locked, manager);
          } else if (locked.status === 'PAID') {
            // A claim can be reimbursed straight from submitted, so make sure
            // the cost is accrued before it is settled.
            await this.postExpenseAccrual(tenantId, locked, manager);
            await this.postExpenseReimbursement(
              tenantId,
              locked,
              dto.accountId,
              manager,
            );
          }

          const saved = await claims.save(locked);
          if (saved.status === 'APPROVED' || saved.status === 'REJECTED') {
            await this.shopEvents?.emit(
              saved.status === 'APPROVED'
                ? 'expense.approved'
                : 'expense.rejected',
              tenantId,
              saved.id,
              { manager },
            );
          }
          return saved;
        },
      );
    } catch (err: unknown) {
      if (isDuplicatePosting(err)) {
        throw new ConflictException(
          'This expense claim has already been posted to the ledger',
        );
      }
      throw err;
    }

    // Only once the books have committed: a signal is not transactional, and
    // a workflow told "reimbursed" for a payment that then rolled back would
    // carry on as if it had happened.
    await this.signalWorkflow(claim, dto);

    return claim;
  }

  /** Once paid or rejected, a claim takes no further signals. */
  private static readonly FINAL_STATUSES: readonly ExpenseStatus[] = [
    'PAID',
    'REJECTED',
  ];

  private static readonly ACTION_PAST: Record<
    SignalExpenseDto['action'],
    string
  > = {
    APPROVE: 'approved',
    REJECT: 'rejected',
    REIMBURSE: 'reimbursed',
  };

  private applyTransition(claim: ExpenseClaim, dto: SignalExpenseDto): void {
    switch (dto.action) {
      case 'APPROVE':
        claim.status = 'APPROVED';
        claim.approvedById = dto.approvedBy || 'manager';
        claim.approvedAt = new Date();
        break;
      case 'REJECT':
        claim.status = 'REJECTED';
        claim.rejectionReason = dto.reason?.trim() || null;
        break;
      case 'REIMBURSE':
        claim.status = 'PAID';
        claim.reimbursedAt = new Date();
        break;
    }
  }

  /**
   * Tells the approval workflow what happened. Best effort: the claim and the
   * books are already committed and are the record, so a Temporal outage is
   * logged rather than failing a request whose effects have already landed.
   */
  private async signalWorkflow(
    claim: ExpenseClaim,
    dto: SignalExpenseDto,
  ): Promise<void> {
    const workflowId = claim.temporalWorkflowId || `expense-${claim.id}`;
    try {
      const client = await this.temporalService.getClient();
      const handle = client.workflow.getHandle(workflowId);

      switch (dto.action) {
        case 'APPROVE':
          await handle.signal(approveExpenseSignal, {
            approvedBy: dto.approvedBy,
            notes: dto.notes,
          });
          break;
        case 'REJECT':
          await handle.signal(rejectExpenseSignal, {
            rejectedBy: dto.rejectedBy,
            reason: dto.reason,
          });
          break;
        case 'REIMBURSE':
          await handle.signal(reimburseExpenseSignal, {
            accountId: dto.accountId,
            reimbursedBy: dto.reimbursedBy,
            notes: dto.notes,
          });
          break;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Temporal signal deferred/failed: ${msg}`);
    }
  }

  /**
   * Recognises the cost when the claim is approved: the company owes the
   * employee from that moment, whether or not it has paid them yet.
   *
   * The category picks the account (`expenseCategoryRole`): cost-of-sales
   * categories land in COGS, overheads in their own account under 6000, and
   * anything else in 6000.
   */
  private async postExpenseAccrual(
    tenantId: string,
    claim: ExpenseClaim,
    manager: EntityManager = this.journalRepository.manager,
  ): Promise<void> {
    const amount = Number(claim.amount) || 0;
    if (amount <= 0) return;

    const journal = manager.getRepository(JournalEntry);
    const referenceId = claim.id;
    const already = await journal.findOne({
      where: { tenantId, referenceType: 'EXPENSE', referenceId },
    });
    if (already) return;

    const label = claim.claimNumber || claim.id;
    const spent = claim.expenseDate ? new Date(claim.expenseDate) : new Date();
    // Converted at the rate on the day the money was spent, like any
    // document. A claim approved after its month was closed is booked on the
    // first open day: the approver did not choose the date and cannot move it.
    const rate = await fxRateFor(manager, tenantId, claim.currency, spent);

    // The VAT is split out here, at approval, from the code as it stands now:
    // recoverable VAT to the tax account like a bill's input tax, the rest to
    // the cost. The employee is owed the gross either way.
    const { split, problem } = await this.claimTax(manager, tenantId, claim);
    if (problem) {
      throw new BadRequestException(
        `${label} cannot be approved yet. ${problem}`,
      );
    }

    const entry = journal.create({
      tenantId,
      entryNumber: `JE-EXP-${label}`,
      referenceType: 'EXPENSE',
      referenceId,
      entryDate: await BooksService.openPostingDate(manager, tenantId, spent),
      totalAmount: amount,
      currency: claim.currency || null,
      fxRate: rate,
      lines: await this.ledger.resolveLines(
        tenantId,
        expenseClaimPostingLines(
          {
            label,
            category: claim.category,
            expenseRole: expenseCategoryRole(claim.category),
          },
          split,
        ),
        manager,
        rate,
      ),
    });

    await journal.save(entry);

    // What reached the tax account, kept on the claim for the tax report.
    claim.taxAmount = split.tax;
    claim.recoverableTax = split.recoverable;
    claim.reverseChargeTax = split.selfAssessed;
    claim.fxRate = rate;
    claim.taxPostedAt = new Date();
    claim.taxReversedAt = null;
  }

  /**
   * Takes an approved claim back out of the books when it is rejected.
   *
   * The accrual is never edited: its mirror image is posted, dated today (or
   * the first open day), so the expense, the payable and any VAT all return
   * to zero. The tax report shows the VAT leaving in the period of the
   * rejection, the way a credit note reduces the period it is issued in. A
   * claim that never reached the ledger has nothing to reverse.
   */
  private async reverseExpenseAccrual(
    tenantId: string,
    claim: ExpenseClaim,
    manager: EntityManager,
  ): Promise<void> {
    const journal = manager.getRepository(JournalEntry);
    const accrual = await journal.findOne({
      where: { tenantId, referenceType: 'EXPENSE', referenceId: claim.id },
    });
    if (!accrual) return;
    const reversed = await journal.findOne({
      where: { tenantId, reversesEntryId: accrual.id },
    });
    if (reversed) return;

    const label = claim.claimNumber || claim.id;
    const now = new Date();
    await journal.save(
      journal.create({
        tenantId,
        entryNumber: `JE-EXPREV-${label}`,
        referenceType: 'EXPENSE',
        referenceId: `${claim.id}:reversal`,
        reversesEntryId: accrual.id,
        entryDate: await BooksService.openPostingDate(manager, tenantId, now),
        totalAmount: accrual.totalAmount,
        currency: accrual.currency,
        fxRate: accrual.fxRate,
        // Stored lines are already in base currency, so the mirror is exact.
        lines: await this.ledger.resolveLines(
          tenantId,
          (accrual.lines ?? []).map((line) => ({
            ledgerAccountId: line.ledgerAccountId,
            accountName: line.accountName,
            debit: Number(line.credit) || 0,
            credit: Number(line.debit) || 0,
            description: `Rejected: ${line.description}`,
          })),
          manager,
        ),
      }),
    );
    if (claim.taxPostedAt) claim.taxReversedAt = now;
  }

  /* ------------------------------------------------------------------ *
   * VAT
   * ------------------------------------------------------------------ */

  /**
   * The VAT fields of a claim as they should be stored, checked against the
   * organisation's purchase tax codes.
   *
   * No code means no VAT, and the claim is the claim it always was. With a
   * code, the VAT is the amount given or, left out, worked out from the rate.
   */
  private async claimTaxFields(
    tenantId: string,
    input: {
      amount: number;
      taxCodeId?: string | null;
      taxAmount?: number | null;
      supplierTaxId?: string | null;
    },
  ): Promise<Pick<ExpenseClaim, 'taxCodeId' | 'taxAmount' | 'supplierTaxId'>> {
    const supplierTaxId = cleanTaxId(input.supplierTaxId);
    if (!input.taxCodeId) {
      return { taxCodeId: null, taxAmount: 0, supplierTaxId };
    }
    const manager = this.expenseRepository.manager;
    const code = await manager.getRepository(TaxCode).findOne({
      where: { id: input.taxCodeId, tenantId, kind: 'PURCHASE' },
    });
    if (!code || !code.isActive) {
      throw new BadRequestException(
        'That VAT type is not available. Choose one from the list, or "No VAT".',
      );
    }
    const problem = expenseClaimTaxProblem(
      input.amount,
      input.taxAmount,
      code,
      { uae: await this.inUaeVatMode(manager, tenantId), supplierTaxId },
    );
    if (problem) throw new BadRequestException(problem);
    return {
      taxCodeId: code.id,
      taxAmount: expenseClaimTax(input.amount, input.taxAmount, code).tax,
      supplierTaxId,
    };
  }

  /**
   * The VAT types a claim can be filed under: the organisation's purchase tax
   * codes. Read by anyone who can submit a claim, who need not be able to see
   * the tax settings. An organisation with no codes gets an empty list and
   * its claim form shows no VAT question at all.
   */
  async taxOptions(tenantId: string): Promise<ExpenseTaxOptionsDto> {
    const manager = this.expenseRepository.manager;
    const codes = await manager.getRepository(TaxCode).find({
      where: { tenantId, kind: 'PURCHASE' },
      order: { code: 'ASC' },
    });
    return {
      codes: codes.map((code) => ({
        id: code.id,
        code: code.code,
        name: code.name,
        rate: Number(code.rate),
        isReverseCharge: code.isReverseCharge,
        treatment: code.treatment ?? null,
        isActive: code.isActive,
      })),
      supplierTaxIdRequired: await this.inUaeVatMode(manager, tenantId),
    };
  }

  /**
   * What would happen to the VAT on a claim with these details, without
   * saving anything: for a surface (the chat receipt skill) that has to say
   * it in words before the claim exists.
   */
  async previewTax(
    tenantId: string,
    input: {
      amount: number;
      taxCodeId?: string | null;
      taxAmount?: number | null;
      supplierTaxId?: string | null;
    },
  ): Promise<{ split: ExpenseClaimTax; problem: string | null }> {
    return this.claimTax(this.expenseRepository.manager, tenantId, {
      amount: input.amount,
      taxCodeId: input.taxCodeId ?? null,
      taxAmount: input.taxAmount as number,
      supplierTaxId: input.supplierTaxId ?? null,
    });
  }

  /** How a claim's amount splits into cost and VAT under its code today. */
  private async claimTax(
    manager: EntityManager,
    tenantId: string,
    claim: Pick<
      ExpenseClaim,
      'amount' | 'taxCodeId' | 'taxAmount' | 'supplierTaxId'
    >,
  ): Promise<{ split: ExpenseClaimTax; problem: string | null }> {
    const amount = Number(claim.amount) || 0;
    if (!claim.taxCodeId) {
      return { split: expenseClaimTax(amount, 0, null), problem: null };
    }
    const code = await manager.getRepository(TaxCode).findOne({
      where: { id: claim.taxCodeId, tenantId, kind: 'PURCHASE' },
    });
    if (!code) {
      return {
        split: expenseClaimTax(amount, 0, null),
        problem:
          'Its VAT type no longer exists. Edit the claim and choose one from the list, or "No VAT".',
      };
    }
    return {
      split: expenseClaimTax(amount, claim.taxAmount, code),
      problem: expenseClaimTaxProblem(amount, claim.taxAmount, code, {
        uae: await this.inUaeVatMode(manager, tenantId),
        supplierTaxId: claim.supplierTaxId,
      }),
    };
  }

  private async inUaeVatMode(
    manager: EntityManager,
    tenantId: string,
  ): Promise<boolean> {
    const organization = await manager
      .getRepository(Organization)
      .findOne({ where: { id: tenantId } });
    return Boolean(organization && isUaeVatMode(organization));
  }

  /**
   * A claim that is in the ledger keeps the figures it was posted with.
   *
   * Changing its amount, category, date or VAT afterwards would leave the
   * claim saying one thing and the books another, and moving its status by
   * hand would let it be approved a second time with nothing posted. Reject
   * it instead, which reverses the posting, and submit a corrected claim.
   */
  private async assertNotPosted(
    tenantId: string,
    claim: ExpenseClaim,
    dto: UpdateExpenseClaimDto,
  ): Promise<void> {
    const sameDay = (a: string | Date, b: Date) =>
      new Date(a).getTime() === new Date(b).getTime();
    const changes =
      (dto.amount !== undefined &&
        Number(dto.amount) !== Number(claim.amount)) ||
      (dto.currency !== undefined && dto.currency !== claim.currency) ||
      (dto.category !== undefined && dto.category !== claim.category) ||
      (dto.status !== undefined && dto.status !== claim.status) ||
      (dto.expenseDate !== undefined &&
        !(dto.expenseDate && sameDay(dto.expenseDate, claim.expenseDate))) ||
      (dto.taxCodeId !== undefined &&
        (dto.taxCodeId || null) !== claim.taxCodeId) ||
      (dto.taxAmount != null &&
        Number(dto.taxAmount) !== Number(claim.taxAmount)) ||
      (dto.supplierTaxId !== undefined &&
        cleanTaxId(dto.supplierTaxId) !== claim.supplierTaxId);
    if (!changes) return;
    const posted = await this.journalRepository.findOne({
      where: { tenantId, referenceType: 'EXPENSE', referenceId: claim.id },
    });
    if (!posted) return;
    throw new ConflictException(
      `${claim.claimNumber || 'This claim'} is already in the books, so its amount, category, date, VAT and status can no longer be changed. To correct it, reject it and submit a new claim.`,
    );
  }

  /**
   * Settles the payable and takes the money out of a real account.
   *
   * The caller may name the account; otherwise the organisation's default is
   * used, falling back to its only account when exactly one exists. With no
   * account at all this refuses rather than marking a claim paid out of
   * nowhere — the treasury balance and the ledger have to move together.
   */
  private async postExpenseReimbursement(
    tenantId: string,
    claim: ExpenseClaim,
    accountId: string | undefined,
    manager: EntityManager = this.journalRepository.manager,
  ): Promise<void> {
    const amount = Number(claim.amount) || 0;
    if (amount <= 0) return;

    const journal = manager.getRepository(JournalEntry);
    const referenceId = `${claim.id}:reimbursement`;
    const already = await journal.findOne({
      where: { tenantId, referenceType: 'EXPENSE', referenceId },
    });
    if (already) return;

    const account = await this.resolveReimbursementAccount(
      tenantId,
      accountId,
      manager,
    );
    const label = claim.claimNumber || claim.id;

    // The payable clears at the rate it was accrued at; the cash leaves at
    // today's, and the difference is an exchange gain or loss. An accrual from
    // before conversion existed was booked at face value, so its settlement is
    // too — converting only one side would invent a difference.
    const accrual = await journal.findOne({
      where: { tenantId, referenceType: 'EXPENSE', referenceId: claim.id },
    });
    const legacy = accrual != null && !accrual.currency;
    const accruedRate = legacy ? 1 : Number(accrual?.fxRate ?? 1) || 1;
    const now = new Date();
    const payRate = legacy
      ? 1
      : await fxRateFor(manager, tenantId, claim.currency, now);
    const leaving = legacy
      ? amount
      : await cashAccountAmount(manager, tenantId, account, {
          amount,
          currency: claim.currency,
          rate: payRate,
        });

    const entry = journal.create({
      tenantId,
      entryNumber: `JE-EXPPAY-${label}`,
      referenceType: 'EXPENSE',
      referenceId,
      entryDate: now,
      totalAmount: amount,
      currency: legacy ? null : claim.currency || null,
      fxRate: payRate,
      lines: await this.ledger.resolveLines(
        tenantId,
        [
          {
            role: LEDGER_ROLES.ACCOUNTS_PAYABLE,
            accountName: 'Accounts payable',
            debit: amount,
            credit: 0,
            fxRate: accruedRate,
            description: `Settlement of expense claim ${label}`,
          },
          {
            financeAccountId: account.id,
            accountName: account.name,
            debit: 0,
            credit: amount,
            fxRate: payRate,
            description: `Reimbursement of expense claim ${label}`,
          },
        ],
        manager,
        payRate,
      ),
    });

    await journal.save(entry);

    // Relative, never read-modify-write: a payment landing in the same
    // account meanwhile would otherwise be lost from the balance. In the
    // account's own currency, which is not always the claim's.
    await manager.query(
      `UPDATE "finance_accounts" SET "balance" = "balance" - $1, "updatedAt" = now()
       WHERE "id" = $2 AND "tenantId" = $3`,
      [leaving, account.id, tenantId],
    );
  }

  private async resolveReimbursementAccount(
    tenantId: string,
    accountId: string | undefined,
    manager: EntityManager,
  ): Promise<FinanceAccount> {
    const repo = manager.getRepository(FinanceAccount);
    if (accountId) {
      const named = await repo.findOne({
        where: { id: accountId, tenantId },
      });
      if (!named) {
        throw new NotFoundException(`Account ${accountId} not found`);
      }
      return named;
    }

    const accounts = await repo.find({
      where: { tenantId },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });

    if (accounts.length === 0) {
      throw new BadRequestException(
        'There is no bank or cash account to reimburse from. Add one under Finance → Bank & Cash Accounts first.',
      );
    }

    return accounts[0];
  }

  private static readonly DEGRADED_RESULT: Omit<
    ScannedReceiptResult,
    'rawText'
  > = {
    merchantName: '',
    amount: 0,
    currency: 'USD',
    expenseDate: new Date().toISOString().split('T')[0],
    category: 'General Expense',
    confidence: 0,
    items: [],
  };

  async scanReceipt(
    dto: ScanReceiptDto,
    actor: { organizationId: string; userId: string },
  ): Promise<ScannedReceiptResult> {
    const rawText = dto.rawText?.trim() || '';
    const file = this.receiptBlock(dto);

    if (!rawText && !file) {
      return { ...ExpensesService.DEGRADED_RESULT, currency: 'USD' };
    }

    const instruction =
      'Extract structured expense data from this receipt. Categorize into one of: ' +
      'Meals & Entertainment, Travel, Software & Subscriptions, Office Supplies, General Expense. ' +
      'If a field is unclear or missing, make your best estimate and lower the confidence score accordingly. ' +
      'The amount is the total paid, VAT included. If the receipt prints a VAT or tax amount, return it as taxAmount. ' +
      "If it prints the seller's tax registration number (TRN, VAT No, Tax Reg No), return it as supplierTaxId exactly as printed. " +
      'Leave both out when the receipt does not show them; never guess either.';

    const content: AiContentBlock[] = [];
    if (file) {
      content.push(file);
      content.push({ type: 'text', text: instruction });
    } else {
      content.push({
        type: 'text',
        text: `${instruction}\n\nReceipt text:\n${rawText}`,
      });
    }

    try {
      const result = await this.aiService.generateStructured<unknown>(
        'expense.scan_receipt',
        {
          messages: [{ role: 'user', content }],
          jsonSchema: scannedReceiptJsonSchema,
          schemaName: 'extract_receipt',
        },
        actor,
      );

      const parsed = scannedReceiptResultSchema.safeParse(result.data);
      if (!parsed.success) {
        this.logger.warn(
          `AI receipt extraction returned malformed data: ${parsed.error.message}`,
        );
        throw new BadRequestException(
          'AI could not confidently extract receipt data — please enter details manually',
        );
      }

      return {
        ...parsed.data,
        ...(await this.suggestReceiptTax(actor.organizationId, parsed.data)),
        rawText: rawText || undefined,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;

      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof AiNotConfiguredException) {
        this.logger.warn('AI receipt scan skipped: provider not configured');
      } else {
        this.logger.warn(`AI receipt scan failed, degrading: ${msg}`);
      }
      return {
        ...ExpensesService.DEGRADED_RESULT,
        rawText: rawText || undefined,
      };
    }
  }

  /**
   * The VAT type a scanned receipt should start on: one that lets the VAT be
   * claimed back when the receipt shows both the VAT and the supplier's tax
   * number, the blocked one for entertainment, otherwise none. A suggestion
   * only — the claimant sees it on the form and can change it — so a failure
   * to work one out never fails the scan.
   */
  private async suggestReceiptTax(
    tenantId: string,
    receipt: {
      amount: number;
      taxAmount?: number;
      supplierTaxId?: string;
      category: string;
    },
  ): Promise<{ taxCodeId?: string | null; supplierTaxId?: string | null }> {
    if (!(Number(receipt.taxAmount) > 0)) return {};
    try {
      const manager = this.expenseRepository.manager;
      const codes = await manager.getRepository(TaxCode).find({
        where: { tenantId, kind: 'PURCHASE', isActive: true },
      });
      const code = suggestExpenseTaxCode(
        codes,
        {
          amount: receipt.amount,
          taxAmount: receipt.taxAmount,
          supplierTaxId: receipt.supplierTaxId,
          category: receipt.category,
        },
        await this.inUaeVatMode(manager, tenantId),
      );
      return {
        taxCodeId: code?.id ?? null,
        supplierTaxId: isValidTrn(receipt.supplierTaxId)
          ? normaliseTrn(receipt.supplierTaxId)
          : (receipt.supplierTaxId ?? null),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not suggest a VAT type for the receipt: ${msg}`);
      return {};
    }
  }

  /**
   * The receipt file as the model should see it, or null when there is none
   * it can read.
   *
   * Browsers hand over a data URL, and older callers sent one in `imageUrl`
   * too; it is unpacked here, because a provider fetches a URL source itself
   * and cannot fetch `data:`. A link is used as a link only when it is one.
   */
  private receiptBlock(
    dto: ScanReceiptDto,
  ): AiImageContent | AiDocumentContent | null {
    const source = dto.base64 || dto.imageUrl || '';
    const dataUrl = /^data:([^;,]+)((?:;[^;,]+)*),(.*)$/s.exec(source);
    if (dataUrl) {
      // A text-encoded data URL (an SVG, say) is not a file a model reads.
      if (!/;base64/i.test(dataUrl[2])) return null;
      return this.fileBlock(dataUrl[1], dataUrl[3]);
    }
    if (dto.base64) return this.fileBlock(dto.mimeType, dto.base64);
    if (dto.imageUrl && /^https?:\/\//i.test(dto.imageUrl)) {
      return {
        type: 'image',
        mimeType: this.normalizeMimeType(dto.mimeType),
        url: dto.imageUrl,
      };
    }
    return null;
  }

  private fileBlock(
    mimeType: string | undefined,
    data: string,
  ): AiImageContent | AiDocumentContent {
    const type = (mimeType ?? '').split(';')[0].trim().toLowerCase();
    if (type === 'application/pdf') {
      return { type: 'document', mimeType: 'application/pdf', data };
    }
    return { type: 'image', mimeType: this.normalizeMimeType(type), data };
  }

  private normalizeMimeType(mimeType?: string): AiImageContent['mimeType'] {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ] as const;
    return (allowed as readonly string[]).includes(mimeType || '')
      ? (mimeType as AiImageContent['mimeType'])
      : 'image/jpeg';
  }
}
