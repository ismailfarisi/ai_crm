import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  isReceiptContentType,
  receiptAttachmentId,
  receiptAttachmentRef,
} from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { AttachmentsService } from '../storage/attachments.service';
import { Attachment } from '../storage/entities/attachment.entity';
import type { UploadedFileLike } from '../storage/storage.types';
import { ExpenseClaim } from './entities/expense-claim.entity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An expense claim's receipt, stored as an attachment on the claim.
 *
 * The claim used to carry the file itself, as a data URL in `receiptUrl`.
 * That sent the whole file through the JSON body (refused above 100 KB) and
 * stored it in the row. Now the file is an attachment, and `receiptUrl`
 * points at it, so the receipt is served the way every stored file is: by a
 * short-lived signed link, to someone who may read the claim.
 */
@Injectable()
export class ExpenseReceiptsService {
  constructor(
    @InjectRepository(ExpenseClaim)
    private readonly claims: Repository<ExpenseClaim>,
    @InjectRepository(Attachment)
    private readonly attachments: Repository<Attachment>,
    private readonly files: AttachmentsService,
  ) {}

  /** Stores the file on the claim and makes it the claim's receipt. */
  async attach(
    user: AuthenticatedUser,
    claimId: string,
    file: UploadedFileLike | undefined,
  ): Promise<ExpenseClaim> {
    const claim = await this.claims.findOne({
      where: { id: claimId, tenantId: user.organizationId },
    });
    if (!claim) {
      throw new NotFoundException(`Expense claim with ID ${claimId} not found`);
    }
    const type = file?.mimetype.split(';')[0].trim().toLowerCase() ?? '';
    if (file && !isReceiptContentType(type)) {
      throw new BadRequestException(
        'Attach the receipt as a PDF or an image (JPEG, PNG, WebP or SVG).',
      );
    }
    // The ordinary attachment route's checks: the claim's update permission,
    // the size limit and the type allowlist.
    const stored = await this.files.upload(
      user,
      'EXPENSE_CLAIM',
      claim.id,
      file,
    );
    claim.receiptUrl = receiptAttachmentRef(stored.id);
    return this.claims.save(claim);
  }

  /**
   * Refuses a `receiptUrl` a claim should not be given: a data URL (the file
   * belongs in an attachment), or a reference to a file that is not attached
   * to this claim — which would show someone else's document as the receipt.
   */
  async assertReceiptUrl(
    tenantId: string,
    claimId: string | null,
    receiptUrl: string | null | undefined,
  ): Promise<void> {
    if (!receiptUrl) return;
    if (receiptUrl.startsWith('data:')) {
      throw new BadRequestException(
        'Upload the receipt as a file to POST /finance/expenses/:id/receipt rather than inline.',
      );
    }
    const attachmentId = receiptAttachmentId(receiptUrl);
    if (attachmentId) {
      const attached =
        claimId &&
        UUID.test(attachmentId) &&
        (await this.attachments.findOne({
          where: {
            id: attachmentId,
            tenantId,
            ownerType: 'EXPENSE_CLAIM',
            ownerId: claimId,
            deletedAt: IsNull(),
          },
        }));
      if (!attached) {
        throw new BadRequestException(
          'That file is not attached to this claim.',
        );
      }
      return;
    }
    if (!/^https?:\/\//i.test(receiptUrl)) {
      throw new BadRequestException('A receipt link must be an http(s) URL.');
    }
  }
}
