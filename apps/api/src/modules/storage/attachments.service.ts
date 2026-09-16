import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type ObjectLiteral } from 'typeorm';
import {
  ATTACHMENT_MAX_BYTES,
  formatBytes,
  isAllowedAttachmentType,
  safeFilename,
  type AttachmentDto,
  type AttachmentLinkDto,
  type AttachmentOwnerType,
} from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { User } from '../users/entities/user.entity';
import { ATTACHMENT_OWNERS } from './attachment-owners';
import { Attachment } from './entities/attachment.entity';
import { StorageService } from './storage.service';
import type { UploadedFileLike } from './storage.types';

@Injectable()
export class AttachmentsService {
  constructor(
    @InjectRepository(Attachment)
    private readonly attachments: Repository<Attachment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The gate every route goes through.
   *
   * Two checks, both necessary: the caller holds the owner record's own
   * permission, and the record exists *in their tenant*. Checking only the
   * permission would let someone with `quote:read` fetch another tenant's
   * artwork by guessing an id.
   */
  private async assertOwner(
    user: AuthenticatedUser,
    ownerType: AttachmentOwnerType,
    ownerId: string,
    mode: 'read' | 'write',
  ): Promise<void> {
    const owner = ATTACHMENT_OWNERS[ownerType];
    if (!owner) throw new BadRequestException('Unknown attachment owner type');
    const needed = mode === 'read' ? owner.read : owner.write;
    if (!user.permissions.includes(needed)) {
      throw new ForbiddenException(
        mode === 'read'
          ? `You do not have permission to see this ${owner.label}.`
          : `You do not have permission to change this ${owner.label}.`,
      );
    }
    const repo = this.dataSource.getRepository(owner.entity);
    const tenantColumn = repo.metadata.columns.some(
      (c) => c.propertyName === 'organizationId',
    )
      ? 'organizationId'
      : 'tenantId';
    const exists = await repo.exists({
      where: {
        id: ownerId,
        [tenantColumn]: user.organizationId,
      } as ObjectLiteral,
    });
    if (!exists)
      throw new NotFoundException(`That ${owner.label} was not found`);
  }

  async list(
    user: AuthenticatedUser,
    ownerType: AttachmentOwnerType,
    ownerId: string,
  ): Promise<AttachmentDto[]> {
    await this.assertOwner(user, ownerType, ownerId, 'read');
    const rows = await this.attachments.find({
      where: { tenantId: user.organizationId, ownerType, ownerId },
      order: { createdAt: 'DESC' },
    });
    return this.toDtos(rows);
  }

  async upload(
    user: AuthenticatedUser,
    ownerType: AttachmentOwnerType,
    ownerId: string,
    file: UploadedFileLike | undefined,
  ): Promise<AttachmentDto> {
    if (!file?.buffer?.length)
      throw new BadRequestException('No file uploaded');
    await this.assertOwner(user, ownerType, ownerId, 'write');
    if (file.size > ATTACHMENT_MAX_BYTES) {
      throw new BadRequestException(
        `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(ATTACHMENT_MAX_BYTES)}.`,
      );
    }
    const contentType = file.mimetype.split(';')[0].trim().toLowerCase();
    if (!isAllowedAttachmentType(contentType)) {
      throw new BadRequestException(
        `${contentType} files cannot be attached. Use a PDF, an image, or an office document.`,
      );
    }

    const key = this.storage.keyFor(user.organizationId, ownerType, ownerId);
    await this.storage.put(key, file.buffer, contentType);
    // The row is written after the object: a row pointing at bytes that were
    // never stored would show the user a file that 404s.
    const row = await this.attachments.save(
      this.attachments.create({
        tenantId: user.organizationId,
        ownerType,
        ownerId,
        filename: safeFilename(file.originalname),
        contentType,
        sizeBytes: file.size,
        storageKey: key,
        checksum: createHash('sha256').update(file.buffer).digest('hex'),
        uploadedById: user.id,
      }),
    );
    const [dto] = await this.toDtos([row]);
    return dto;
  }

  /** A short-lived URL, after re-checking the owner's read permission. */
  async link(user: AuthenticatedUser, id: string): Promise<AttachmentLinkDto> {
    const row = await this.find(user.organizationId, id);
    await this.assertOwner(user, row.ownerType, row.ownerId, 'read');
    const { url, expiresAt } = await this.storage.linkFor(
      row.id,
      row.storageKey,
      row.filename,
    );
    return { url, expiresAt: expiresAt.toISOString(), filename: row.filename };
  }

  /**
   * Serves the bytes for a signed link. No session: the signature is the
   * authority, which is what lets an <img> tag or a download manager fetch it.
   */
  async download(
    id: string,
    expires: number,
    token: string,
  ): Promise<{ filename: string; contentType: string; body: Buffer }> {
    const row = await this.attachments.findOne({ where: { id } });
    if (!row) throw new NotFoundException('File not found');
    this.storage.verifyLink(id, expires, token);
    const object = await this.storage.get(row.storageKey);
    return {
      filename: row.filename,
      contentType: row.contentType,
      body: object.body,
    };
  }

  async remove(user: AuthenticatedUser, id: string): Promise<void> {
    const row = await this.find(user.organizationId, id);
    await this.assertOwner(user, row.ownerType, row.ownerId, 'write');
    await this.attachments.softDelete({ id: row.id });
    await this.storage.delete(row.storageKey);
  }

  private async find(tenantId: string, id: string): Promise<Attachment> {
    const row = await this.attachments.findOne({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('File not found');
    return row;
  }

  private async toDtos(rows: Attachment[]): Promise<AttachmentDto[]> {
    const ids = [...new Set(rows.map((r) => r.uploadedById).filter(Boolean))];
    const users = ids.length
      ? await this.users.find({
          where: ids.map((id) => ({ id: id as string })),
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : [];
    return rows.map((row) => {
      const uploader = users.find((u) => u.id === row.uploadedById);
      return {
        id: row.id,
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        filename: row.filename,
        contentType: row.contentType,
        sizeBytes: row.sizeBytes,
        uploadedById: row.uploadedById,
        uploadedByName: uploader
          ? [uploader.firstName, uploader.lastName].filter(Boolean).join(' ') ||
            uploader.email
          : null,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
