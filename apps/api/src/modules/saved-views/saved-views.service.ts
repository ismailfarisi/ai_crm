import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedView } from './entities/saved-view.entity';
import type { CreateSavedViewPayload, UpdateSavedViewPayload } from '@saas/shared';

@Injectable()
export class SavedViewsService {
  constructor(
    @InjectRepository(SavedView)
    private readonly repo: Repository<SavedView>,
  ) {}

  async findAccessible(tenantId: string, userId: string, entityType: string): Promise<SavedView[]> {
    return this.repo.find({
      where: [
        { tenantId, entityType, userId },
        { tenantId, entityType, isShared: true },
      ],
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<SavedView> {
    const view = await this.repo.findOne({ where: { id, tenantId } });
    if (!view) throw new NotFoundException('Saved view not found');
    return view;
  }

  async create(tenantId: string, userId: string, payload: CreateSavedViewPayload): Promise<SavedView> {
    const view = this.repo.create({
      tenantId,
      userId,
      ...payload,
    });
    return this.repo.save(view);
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    payload: UpdateSavedViewPayload,
    isAdmin = false,
  ): Promise<SavedView> {
    const view = await this.findById(tenantId, id);
    if (view.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Cannot edit another user’s view');
    }
    Object.assign(view, payload);
    return this.repo.save(view);
  }

  async delete(tenantId: string, userId: string, id: string, isAdmin = false): Promise<void> {
    const view = await this.findById(tenantId, id);
    if (view.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Cannot delete another user’s view');
    }
    await this.repo.softRemove(view);
  }
}
