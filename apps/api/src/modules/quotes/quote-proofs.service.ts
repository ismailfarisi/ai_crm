import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  isAllowedProofType,
  type PublicQuoteProofDto,
  type QuoteProofDto,
  type QuoteProofsSummaryDto,
  type WorkOrderProofDto,
} from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { Organization } from '../organizations/entities/organization.entity';
import { SalesOrder } from '../orders/entities/sales-order.entity';
import { WorkOrder } from '../production/entities/work-order.entity';
import { Attachment } from '../storage/entities/attachment.entity';
import { AttachmentsService } from '../storage/attachments.service';
import { StorageService } from '../storage/storage.service';
import type { UploadedFileLike } from '../storage/storage.types';
import { User } from '../users/entities/user.entity';
import { QuoteProof } from './entities/quote-proof.entity';
import { Quote, QuoteStatus } from './entities/quote.entity';

/**
 * Copies a quote's proofs onto its revision, verdicts included.
 *
 * A revision usually changes the price, not the artwork; making the customer
 * approve the same file again because the quantity moved would be the
 * WhatsApp thread all over again. The rows point at the same attachments.
 */
export async function carryProofsOver(
  manager: EntityManager,
  tenantId: string,
  fromQuoteId: string,
  toQuoteId: string,
): Promise<void> {
  await manager.query(
    `INSERT INTO "quote_proofs" ("tenant_id", "quote_id", "attachment_id", "version", "status", "staff_note", "uploaded_by_id", "responded_at", "responded_by_name", "response_comment", "responded_ip", "superseded_at", "createdAt")
     SELECT "tenant_id", $3, "attachment_id", "version", "status", "staff_note", "uploaded_by_id", "responded_at", "responded_by_name", "response_comment", "responded_ip", "superseded_at", "createdAt"
     FROM "quote_proofs" WHERE "tenant_id" = $1 AND "quote_id" = $2`,
    [tenantId, fromQuoteId, toQuoteId],
  );
}

/**
 * Artwork proofs: versioned quote attachments the customer approves.
 *
 * The bytes go through the attachments module, so they inherit the quote's
 * permissions and are served by its signed links. This service adds the
 * version, the verdict and the supersession, and is the only place that
 * decides which files the public link may show: proof files, and nothing
 * else hanging off the quote.
 */
@Injectable()
export class QuoteProofsService {
  constructor(
    @InjectRepository(QuoteProof)
    private readonly proofs: Repository<QuoteProof>,
    @InjectRepository(Quote) private readonly quotes: Repository<Quote>,
    @InjectRepository(Attachment)
    private readonly attachments: Repository<Attachment>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(WorkOrder)
    private readonly workOrders: Repository<WorkOrder>,
    @InjectRepository(SalesOrder)
    private readonly salesOrders: Repository<SalesOrder>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly attachmentsService: AttachmentsService,
    private readonly storage: StorageService,
  ) {}

  async list(tenantId: string, quoteId: string): Promise<QuoteProofsSummaryDto> {
    const quote = await this.findQuote(tenantId, quoteId);
    const rows = await this.proofs.find({
      where: { tenantId, quoteId },
      order: { version: 'DESC' },
    });
    return {
      proofRequired: await this.isRequired(quote),
      proofRequiredFromDefault: quote.proofRequired === null || quote.proofRequired === undefined,
      customerResponse: quote.customerResponse
        ? {
            kind: quote.customerResponse,
            note: quote.customerResponseNote ?? null,
            at: quote.customerRespondedAt?.toISOString() ?? null,
            byName: quote.customerRespondedByName ?? null,
          }
        : null,
      proofs: await this.toDtos(rows),
    };
  }

  /** Adds the next version. The one before it is superseded, whatever its verdict. */
  async upload(
    user: AuthenticatedUser,
    quoteId: string,
    file: UploadedFileLike | undefined,
    note: string | null,
  ): Promise<QuoteProofsSummaryDto> {
    const tenantId = user.organizationId;
    const quote = await this.findQuote(tenantId, quoteId);
    if (quote.supersededAt) {
      throw new BadRequestException(
        'This quote has been replaced by a newer revision. Add the proof to the latest version.',
      );
    }
    if (quote.status === QuoteStatus.REJECTED) {
      throw new BadRequestException('A rejected quote cannot take a proof');
    }
    if (file?.mimetype && !isAllowedProofType(file.mimetype)) {
      throw new BadRequestException(
        'A proof must be a PDF or an image (PNG, JPEG or WebP).',
      );
    }

    const attachment = await this.attachmentsService.upload(
      user,
      'QUOTE',
      quoteId,
      file,
    );

    await this.proofs.manager.transaction(async (manager) => {
      // The quote row is the lock: two uploads at once still get v2 and v3.
      await manager.query(
        `SELECT 1 FROM "quotes" WHERE "id" = $1 AND "tenant_id" = $2 FOR UPDATE`,
        [quoteId, tenantId],
      );
      const repo = manager.getRepository(QuoteProof);
      const last = await repo.findOne({
        where: { tenantId, quoteId },
        order: { version: 'DESC' },
      });
      const now = new Date();
      await manager.query(
        `UPDATE "quote_proofs" SET "superseded_at" = $3, "updatedAt" = now()
         WHERE "tenant_id" = $1 AND "quote_id" = $2 AND "superseded_at" IS NULL`,
        [tenantId, quoteId, now],
      );
      await repo.save(
        repo.create({
          tenantId,
          quoteId,
          attachmentId: attachment.id,
          version: (last?.version ?? 0) + 1,
          status: 'PENDING',
          staffNote: note,
          uploadedById: user.id,
        }),
      );
    });
    return this.list(tenantId, quoteId);
  }

  async setRequirement(
    tenantId: string,
    quoteId: string,
    required: boolean,
  ): Promise<{ proofRequired: boolean }> {
    const quote = await this.findQuote(tenantId, quoteId);
    if (quote.acceptedAt) {
      throw new BadRequestException(
        'The customer already accepted this quote, so the proof rule no longer applies.',
      );
    }
    await this.quotes.update({ id: quoteId, tenantId }, { proofRequired: required });
    return { proofRequired: required };
  }

  /** The quote's own setting, or the organisation's default while it has none. */
  async isRequired(quote: Quote): Promise<boolean> {
    if (quote.proofRequired !== null && quote.proofRequired !== undefined) {
      return quote.proofRequired;
    }
    const organization = await this.organizations.findOne({
      where: { id: quote.tenantId },
      select: { id: true, quoteProofRequiredDefault: true },
    });
    return organization?.quoteProofRequiredDefault ?? false;
  }

  /** The latest live version, which is the only one a customer can answer. */
  async latestFor(tenantId: string, quoteId: string): Promise<QuoteProof | null> {
    const rows = await this.proofs.find({
      where: { tenantId, quoteId },
      order: { version: 'DESC' },
    });
    return rows.find((r) => !r.supersededAt) ?? null;
  }

  /** Whether the proof rule stops this quote being accepted right now. */
  async blocksAcceptance(quote: Quote): Promise<boolean> {
    if (!(await this.isRequired(quote))) return false;
    const latest = await this.latestFor(quote.tenantId, quote.id);
    return latest?.status !== 'APPROVED';
  }

  /**
   * The proofs a customer may see, each with a short-lived signed link.
   *
   * Links are minted only here, only for attachments a proof row names, and
   * only for a caller that already resolved the quote from its token.
   */
  async forPublic(quote: Quote): Promise<PublicQuoteProofDto[]> {
    const rows = await this.proofs.find({
      where: { tenantId: quote.tenantId, quoteId: quote.id },
      order: { version: 'DESC' },
    });
    const files = await this.filesFor(rows);
    return Promise.all(
      rows.map(async (row) => {
        const file = files.get(row.attachmentId);
        const link = file
          ? await this.storage.linkFor(file.id, file.storageKey, file.filename)
          : null;
        return {
          id: row.id,
          version: row.version,
          status: row.status,
          filename: file?.filename ?? 'File removed',
          contentType: file?.contentType ?? 'application/octet-stream',
          url: link?.url ?? null,
          urlExpiresAt: link?.expiresAt.toISOString() ?? null,
          staffNote: row.staffNote,
          respondedAt: row.respondedAt?.toISOString() ?? null,
          respondedByName: row.respondedByName,
          responseComment: row.responseComment,
          superseded: Boolean(row.supersededAt),
          createdAt: row.createdAt.toISOString(),
        };
      }),
    );
  }

  /**
   * The approved artwork behind a work order: work order, sales order, quote.
   *
   * The highest approved version wins even if a newer one has since been
   * uploaded, because that newer one has not been signed off; the floor is
   * told it exists rather than handed it.
   */
  async forWorkOrder(
    tenantId: string,
    workOrderId: string,
  ): Promise<WorkOrderProofDto | null> {
    const workOrder = await this.workOrders.findOne({
      where: { id: workOrderId, tenantId },
      select: { id: true, salesOrderId: true },
    });
    if (!workOrder) {
      throw new NotFoundException(`Work order with ID ${workOrderId} not found`);
    }
    if (!workOrder.salesOrderId) return null;
    const order = await this.salesOrders.findOne({
      where: { id: workOrder.salesOrderId, tenantId },
      select: { id: true, quoteId: true },
    });
    if (!order?.quoteId) return null;
    const quote = await this.quotes.findOne({
      where: { id: order.quoteId, tenantId },
      select: { id: true, quoteNumber: true },
    });
    const rows = await this.proofs.find({
      where: { tenantId, quoteId: order.quoteId },
      order: { version: 'DESC' },
    });
    if (!rows.length) return null;

    const approved = rows.find((r) => r.status === 'APPROVED') ?? null;
    const latest = rows.find((r) => !r.supersededAt) ?? rows[0];
    const files = await this.filesFor(approved ? [approved] : []);
    const file = approved ? files.get(approved.attachmentId) : undefined;
    const link = file
      ? await this.storage.linkFor(file.id, file.storageKey, file.filename)
      : null;
    return {
      quoteId: order.quoteId,
      quoteNumber: quote?.quoteNumber ?? null,
      proof: approved
        ? {
            id: approved.id,
            version: approved.version,
            filename: file?.filename ?? 'File removed',
            contentType: file?.contentType ?? 'application/octet-stream',
            approvedAt: approved.respondedAt?.toISOString() ?? null,
            approvedByName: approved.respondedByName,
            url: link?.url ?? null,
            urlExpiresAt: link?.expiresAt.toISOString() ?? null,
          }
        : null,
      newerVersion:
        !approved || latest.version > approved.version
          ? { version: latest.version, status: latest.status }
          : null,
    };
  }

  private async findQuote(tenantId: string, quoteId: string): Promise<Quote> {
    const quote = await this.quotes.findOne({ where: { id: quoteId, tenantId } });
    if (!quote) throw new NotFoundException(`Quote with ID ${quoteId} not found`);
    return quote;
  }

  /** Live attachments only: a file removed from the quote is not served. */
  private async filesFor(rows: QuoteProof[]): Promise<Map<string, Attachment>> {
    const ids = [...new Set(rows.map((r) => r.attachmentId))];
    if (!ids.length) return new Map();
    const files = await this.attachments.find({ where: { id: In(ids) } });
    return new Map(files.map((f) => [f.id, f]));
  }

  private async toDtos(rows: QuoteProof[]): Promise<QuoteProofDto[]> {
    const files = await this.filesFor(rows);
    const userIds = [
      ...new Set(rows.map((r) => r.uploadedById).filter((v): v is string => !!v)),
    ];
    const users = userIds.length
      ? await this.users.find({
          where: { id: In(userIds) },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    return rows.map((row) => {
      const file = files.get(row.attachmentId);
      const uploader = users.find((u) => u.id === row.uploadedById);
      return {
        id: row.id,
        quoteId: row.quoteId,
        version: row.version,
        status: row.status,
        attachmentId: row.attachmentId,
        filename: file?.filename ?? 'File removed',
        contentType: file?.contentType ?? 'application/octet-stream',
        fileAvailable: Boolean(file),
        staffNote: row.staffNote,
        uploadedByName: uploader
          ? `${uploader.firstName} ${uploader.lastName}`.trim() || uploader.email
          : null,
        respondedAt: row.respondedAt?.toISOString() ?? null,
        respondedByName: row.respondedByName,
        responseComment: row.responseComment,
        supersededAt: row.supersededAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
