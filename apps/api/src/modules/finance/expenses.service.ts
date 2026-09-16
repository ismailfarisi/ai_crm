import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExpenseClaim } from './entities/expense-claim.entity';
import { FinanceAccount } from './entities/finance-account.entity';
import { CategoryBudget } from './entities/category-budget.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { LedgerService } from './ledger.service';
import { TemporalService } from '../temporal/temporal.service';
import { AiService } from '../ai/ai.service';
import {
  AiNotConfiguredException,
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
import { LEDGER_ROLES, type ExpenseStatus } from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '../../database/tenant-sequence.util';

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
  ) {}

  async generateNextClaimNumber(tenantId: string): Promise<string> {
    const value = await allocateNextSequenceValue(
      this.expenseRepository.manager,
      tenantId,
      'claim_number',
    );
    return formatSequenceNumber('EXP', value);
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

    const claim = this.expenseRepository.create({
      tenantId,
      claimNumber,
      employeeId,
      employeeName,
      category: dto.category || 'General Expense',
      amount: dto.amount,
      currency: dto.currency || 'USD',
      status,
      merchantName: dto.merchantName || null,
      expenseDate: dto.expenseDate ? new Date(dto.expenseDate) : new Date(),
      receiptUrl: dto.receiptUrl || null,
      items,
    });

    const savedClaim = await this.expenseRepository.save(claim);
    const workflowId = `expense-${savedClaim.id}`;

    if (status === 'SUBMITTED') {
      try {
        const client = this.temporalService.getClient();
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
      return this.expenseRepository.save(savedClaim);
    }

    return savedClaim;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateExpenseClaimDto,
  ): Promise<ExpenseClaim> {
    const claim = await this.findById(tenantId, id);

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
    const claim = await this.findById(tenantId, id);
    const workflowId = claim.temporalWorkflowId || `expense-${claim.id}`;

    if (
      dto.action !== 'APPROVE' &&
      dto.action !== 'REJECT' &&
      dto.action !== 'REIMBURSE'
    ) {
      throw new BadRequestException(`Invalid signal action: ${dto.action}`);
    }

    try {
      const client = this.temporalService.getClient();
      const handle = client.workflow.getHandle(workflowId);

      switch (dto.action) {
        case 'APPROVE':
          await handle.signal(approveExpenseSignal, {
            approvedBy: dto.approvedBy,
            notes: dto.notes,
          });
          claim.status = 'APPROVED';
          claim.approvedById = dto.approvedBy || 'manager';
          claim.approvedAt = new Date();
          break;
        case 'REJECT':
          await handle.signal(rejectExpenseSignal, {
            rejectedBy: dto.rejectedBy,
            reason: dto.reason,
          });
          claim.status = 'REJECTED';
          claim.rejectionReason = dto.reason || 'Expense rejected';
          break;
        case 'REIMBURSE':
          await handle.signal(reimburseExpenseSignal, {
            accountId: dto.accountId,
            reimbursedBy: dto.reimbursedBy,
            notes: dto.notes,
          });
          claim.status = 'PAID';
          claim.reimbursedAt = new Date();
          break;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Temporal signal deferred/failed: ${msg}`);

      // Fallback state transition
      if (dto.action === 'APPROVE') {
        claim.status = 'APPROVED';
        claim.approvedById = dto.approvedBy || 'manager';
        claim.approvedAt = new Date();
      } else if (dto.action === 'REJECT') {
        claim.status = 'REJECTED';
        claim.rejectionReason = dto.reason || 'Expense rejected';
      } else if (dto.action === 'REIMBURSE') {
        claim.status = 'PAID';
        claim.reimbursedAt = new Date();
      }
    }

    // Posting happens here, not in the workflow. The workflow's
    // `postJournalEntryActivity` only ever logged and returned a synthetic id,
    // so an approved claim never reached the ledger whether Temporal was
    // healthy or not: the P&L showed no expense and the bank balance never
    // moved. Doing it on the same path as every other posting site — payables,
    // credit notes, inventory — keeps the books right regardless of whether
    // the workflow ran, and both entries are idempotent on `referenceId` so a
    // retry or a later workflow replay cannot double them.
    if (claim.status === 'APPROVED') {
      await this.postExpenseAccrual(tenantId, claim);
    } else if (claim.status === 'PAID') {
      // A claim can be reimbursed straight from submitted, so make sure the
      // cost is accrued before it is settled.
      await this.postExpenseAccrual(tenantId, claim);
      await this.postExpenseReimbursement(tenantId, claim, dto.accountId);
    }

    return this.expenseRepository.save(claim);
  }

  /**
   * Recognises the cost when the claim is approved: the company owes the
   * employee from that moment, whether or not it has paid them yet.
   *
   * A category ("Travel", "Software") is a label rather than an account, so
   * every claim lands in operating expense until categories are mapped to a
   * tenant's own accounts.
   */
  private async postExpenseAccrual(
    tenantId: string,
    claim: ExpenseClaim,
  ): Promise<void> {
    const amount = Number(claim.amount) || 0;
    if (amount <= 0) return;

    const referenceId = claim.id;
    const already = await this.journalRepository.findOne({
      where: { tenantId, referenceType: 'EXPENSE', referenceId },
    });
    if (already) return;

    const label = claim.claimNumber || claim.id;

    const entry = this.journalRepository.create({
      tenantId,
      entryNumber: `JE-EXP-${label}`,
      referenceType: 'EXPENSE',
      referenceId,
      entryDate: claim.expenseDate ? new Date(claim.expenseDate) : new Date(),
      totalAmount: amount,
      lines: await this.ledger.resolveLines(tenantId, [
        {
          role: LEDGER_ROLES.OPERATING_EXPENSE,
          accountName: claim.category || 'Operating expense',
          debit: amount,
          credit: 0,
          description: `Expense claim ${label} — ${claim.category ?? 'uncategorised'}`,
        },
        {
          role: LEDGER_ROLES.ACCOUNTS_PAYABLE,
          accountName: 'Accounts payable',
          debit: 0,
          credit: amount,
          description: `Payable for expense claim ${label}`,
        },
      ]),
    });

    await this.journalRepository.save(entry);
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
    accountId?: string,
  ): Promise<void> {
    const amount = Number(claim.amount) || 0;
    if (amount <= 0) return;

    const referenceId = `${claim.id}:reimbursement`;
    const already = await this.journalRepository.findOne({
      where: { tenantId, referenceType: 'EXPENSE', referenceId },
    });
    if (already) return;

    const account = await this.resolveReimbursementAccount(tenantId, accountId);
    const label = claim.claimNumber || claim.id;

    const entry = this.journalRepository.create({
      tenantId,
      entryNumber: `JE-EXPPAY-${label}`,
      referenceType: 'EXPENSE',
      referenceId,
      entryDate: new Date(),
      totalAmount: amount,
      lines: await this.ledger.resolveLines(tenantId, [
        {
          role: LEDGER_ROLES.ACCOUNTS_PAYABLE,
          accountName: 'Accounts payable',
          debit: amount,
          credit: 0,
          description: `Settlement of expense claim ${label}`,
        },
        {
          financeAccountId: account.id,
          accountName: account.name,
          debit: 0,
          credit: amount,
          description: `Reimbursement of expense claim ${label}`,
        },
      ]),
    });

    await this.journalRepository.save(entry);

    account.balance = Number(account.balance) - amount;
    await this.accountRepository.save(account);
  }

  private async resolveReimbursementAccount(
    tenantId: string,
    accountId?: string,
  ): Promise<FinanceAccount> {
    if (accountId) {
      const named = await this.accountRepository.findOne({
        where: { id: accountId, tenantId },
      });
      if (!named) {
        throw new NotFoundException(`Account ${accountId} not found`);
      }
      return named;
    }

    const accounts = await this.accountRepository.find({
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
    const hasImage = Boolean(dto.base64 || dto.imageUrl);

    if (!rawText && !hasImage) {
      return { ...ExpensesService.DEGRADED_RESULT, currency: 'USD' };
    }

    const instruction =
      'Extract structured expense data from this receipt. Categorize into one of: ' +
      'Meals & Entertainment, Travel, Software & Subscriptions, Office Supplies, General Expense. ' +
      'If a field is unclear or missing, make your best estimate and lower the confidence score accordingly.';

    const content: (AiImageContent | { type: 'text'; text: string })[] = [];
    if (hasImage) {
      content.push(
        dto.imageUrl
          ? {
              type: 'image',
              mimeType: this.normalizeMimeType(dto.mimeType),
              url: dto.imageUrl,
            }
          : {
              type: 'image',
              mimeType: this.normalizeMimeType(dto.mimeType),
              data: dto.base64,
            },
      );
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

      return { ...parsed.data, rawText: rawText || undefined };
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
