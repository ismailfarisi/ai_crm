import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';
import { SavedView } from './entities/saved-view.entity';
import type { CreateSavedViewPayload, UpdateSavedViewPayload } from '@saas/shared';

const isUniqueViolation = (error: unknown): boolean => {
  const e = error as { code?: string; driverError?: { code?: string } } | null;
  return e?.code === '23505' || e?.driverError?.code === '23505';
};

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
    return this.repo.manager.transaction(async (manager) => {
      if (payload.isDefault) {
        await this.clearOtherDefaults(manager, tenantId, userId, payload.entityType);
      }
      const repo = manager.getRepository(SavedView);
      const view = repo.create({
        tenantId,
        userId,
        ...payload,
      });
      return this.saveView(repo, view);
    });
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
    return this.repo.manager.transaction(async (manager) => {
      Object.assign(view, payload);
      if (view.isDefault) {
        // The default belongs to the view's owner, not whoever is editing it.
        await this.clearOtherDefaults(manager, tenantId, view.userId, view.entityType, view.id);
      }
      return this.saveView(manager.getRepository(SavedView), view);
    });
  }

  async delete(tenantId: string, userId: string, id: string, isAdmin = false): Promise<void> {
    const view = await this.findById(tenantId, id);
    if (view.userId !== userId && !isAdmin) {
      throw new ForbiddenException('Cannot delete another user’s view');
    }
    await this.repo.softRemove(view);
  }

  /**
   * At most one default per (tenant, user, entity), backed by the partial
   * unique index `uq_saved_views_one_default`. The advisory lock serialises
   * two "make default" requests for the same slot so the second clears the
   * first's default instead of tripping the index.
   */
  private async clearOtherDefaults(
    manager: EntityManager,
    tenantId: string,
    userId: string,
    entityType: string,
    exceptId?: string,
  ): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `saved_view_default:${tenantId}:${userId}:${entityType}`,
    ]);
    await manager.getRepository(SavedView).update(
      {
        tenantId,
        userId,
        entityType,
        isDefault: true,
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
      { isDefault: false },
    );
  }

  private async saveView(repo: Repository<SavedView>, view: SavedView): Promise<SavedView> {
    try {
      return await repo.save(view);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Another default view already exists for this list');
      }
      throw error;
    }
  }
}
