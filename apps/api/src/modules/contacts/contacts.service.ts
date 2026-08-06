import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, type SelectQueryBuilder } from 'typeorm';
import {
  CONTACT_STATUSES,
  PERMISSIONS,
  type ContactDto,
  type ContactStatsDto,
  type ContactStatus,
  type CreateContactInput,
  type PaginatedResult,
  type UpdateContactInput,
} from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { Contact } from './entities/contact.entity';
import type { ContactQueryDto } from './dto/contact-query.dto';

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ContactQueryDto,
  ): Promise<PaginatedResult<ContactDto>> {
    const qb = this.scoped(actor).leftJoinAndSelect('contact.owner', 'owner');

    if (query.search) {
      const term = `%${query.search.toLowerCase()}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where('LOWER(contact.firstName) LIKE :term', { term })
            .orWhere('LOWER(contact.lastName) LIKE :term', { term })
            .orWhere('LOWER(contact.email) LIKE :term', { term })
            .orWhere('LOWER(contact.company) LIKE :term', { term })
            .orWhere(
              "LOWER(contact.firstName || ' ' || contact.lastName) LIKE :term",
              { term },
            );
        }),
      );
    }

    if (query.status) {
      qb.andWhere('contact.status = :status', { status: query.status });
    }
    if (query.source) {
      qb.andWhere('contact.source = :source', { source: query.source });
    }
    if (query.ownerId) {
      // Only org-wide readers and team leaders can filter by another member.
      // A plain member's scope pins ownerId to themselves, so this filter is
      // a no-op for them — but we still constrain team leaders to their team.
      if (this.canSeeEverything(actor)) {
        qb.andWhere('contact.ownerId = :ownerId', { ownerId: query.ownerId });
      } else if (this.canSeeTeam(actor)) {
        const teamMemberIds = await this.teamMemberIds(actor);
        if (!teamMemberIds.includes(query.ownerId)) {
          // Not visible to this leader — same 404 as any foreign contact.
          qb.andWhere('1 = 0');
        } else {
          qb.andWhere('contact.ownerId = :ownerId', { ownerId: query.ownerId });
        }
      }
      // else: scope already pins ownerId = actor, so the filter is redundant.
    }

    const [items, total] = await qb
      .orderBy(`contact.${query.sortBy}`, query.sortOrder)
      .addOrderBy('contact.id', 'ASC') // stable paging when sort keys tie
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    const totalPages = Math.max(1, Math.ceil(total / query.limit));

    return {
      items: items.map((contact) => this.toDto(contact)),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  }

  async findOne(actor: AuthenticatedUser, id: string): Promise<ContactDto> {
    return this.toDto(await this.findEntity(actor, id));
  }

  async create(
    actor: AuthenticatedUser,
    input: CreateContactInput,
  ): Promise<ContactDto> {
    const parsed = input as Required<CreateContactInput>;

    // Without `contact:read_all` a user can only ever create contacts for
    // themselves — otherwise they could create one they immediately can't see.
    // Team leaders may also assign to a member of their own team.
    let ownerId: string = actor.id;
    if (parsed.ownerId && this.canSeeEverything(actor)) {
      ownerId = parsed.ownerId;
    } else if (parsed.ownerId && this.canSeeTeam(actor)) {
      const memberIds = await this.teamMemberIds(actor);
      if (memberIds.includes(parsed.ownerId)) {
        ownerId = parsed.ownerId;
      }
    }

    const contact = this.contacts.create({
      ...(parsed as object),
      organizationId: actor.organizationId,
      ownerId,
    } as Partial<Contact>);

    const saved = await this.contacts.save(contact);
    return this.findOne(actor, saved.id);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateContactInput,
  ): Promise<ContactDto> {
    const contact = await this.findEntity(actor, id);

    if (input.ownerId !== undefined) {
      if (this.canSeeEverything(actor)) {
        // Org-wide readers may reassign to anyone, including unassigning.
      } else if (this.canSeeTeam(actor)) {
        const memberIds = await this.teamMemberIds(actor);
        const targetIsTeam =
          input.ownerId === null || memberIds.includes(input.ownerId);
        if (!targetIsTeam) {
          throw new ForbiddenException(
            'You cannot reassign contacts outside your team',
          );
        }
      } else if (input.ownerId !== actor.id) {
        throw new ForbiddenException('You cannot reassign contacts');
      }
    }

    Object.assign(contact, input);
    await this.contacts.save(contact);
    return this.findOne(actor, contact.id);
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    const contact = await this.findEntity(actor, id);
    await this.contacts.softRemove(contact);
  }

  async stats(actor: AuthenticatedUser): Promise<ContactStatsDto> {
    const rows = await this.scoped(actor)
      .select('contact.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('contact.status')
      .getRawMany<{ status: ContactStatus; count: string }>();

    const byStatus = Object.fromEntries(
      CONTACT_STATUSES.map((status) => [status, 0]),
    ) as Record<ContactStatus, number>;

    let total = 0;
    for (const row of rows) {
      const count = Number(row.count);
      byStatus[row.status] = count;
      total += count;
    }

    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const monthAgo = new Date(Date.now() - 30 * 86_400_000);

    const [createdThisWeek, createdThisMonth] = await Promise.all([
      this.scoped(actor)
        .andWhere('contact.createdAt >= :since', { since: weekAgo })
        .getCount(),
      this.scoped(actor)
        .andWhere('contact.createdAt >= :since', { since: monthAgo })
        .getCount(),
    ]);

    return { total, byStatus, createdThisWeek, createdThisMonth };
  }

  /**
   * Every query starts here: tenant filter first, ownership filter second.
   *
   * - Org-wide readers (`contact:read_all`) see everything in the org.
   * - Team leaders (`contact:read_team`) see their own contacts plus those
   *   owned by members of their team.
   * - Everyone else sees only their own contacts.
   */
  private scoped(actor: AuthenticatedUser): SelectQueryBuilder<Contact> {
    const qb = this.contacts
      .createQueryBuilder('contact')
      .where('contact.organizationId = :organizationId', {
        organizationId: actor.organizationId,
      });

    if (!this.canSeeEverything(actor)) {
      if (this.canSeeTeam(actor)) {
        qb.andWhere(
          new Brackets((w) => {
            w.where('contact.ownerId = :actorId', {
              actorId: actor.id,
            }).orWhere(
              'contact.ownerId IN (SELECT "id" FROM "users" WHERE "teamId" = :teamId)',
              { teamId: actor.teamId },
            );
          }),
        );
      } else {
        qb.andWhere('contact.ownerId = :actorId', { actorId: actor.id });
      }
    }

    return qb;
  }

  private canSeeEverything(actor: AuthenticatedUser): boolean {
    return actor.permissions.includes(PERMISSIONS.CONTACT_READ_ALL);
  }

  private canSeeTeam(actor: AuthenticatedUser): boolean {
    return (
      !this.canSeeEverything(actor) &&
      actor.permissions.includes(PERMISSIONS.CONTACT_READ_TEAM) &&
      actor.teamId !== null
    );
  }

  /**
   * Ids of everyone in the actor's team, including the actor themselves. Used
   * to build the team scope and to validate owner reassignment targets.
   */
  private async teamMemberIds(actor: AuthenticatedUser): Promise<string[]> {
    if (actor.teamId === null) return [actor.id];
    const rows = await this.contacts.manager
      .createQueryBuilder()
      .select('id')
      .from('users', 'user')
      .where('user.teamId = :teamId', { teamId: actor.teamId })
      .getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  private async findEntity(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<Contact> {
    const contact = await this.scoped(actor)
      .leftJoinAndSelect('contact.owner', 'owner')
      .andWhere('contact.id = :id', { id })
      .getOne();

    if (!contact) {
      // Deliberately the same 404 whether it doesn't exist or isn't visible to
      // this user — no probing for other reps' contacts.
      throw new NotFoundException('Contact not found');
    }
    return contact;
  }

  toDto(contact: Contact): ContactDto {
    return {
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: `${contact.firstName} ${contact.lastName}`.trim(),
      email: contact.email,
      phone: contact.phone,
      company: contact.company,
      jobTitle: contact.jobTitle,
      status: contact.status,
      source: contact.source,
      notes: contact.notes,
      owner: contact.owner
        ? {
            id: contact.owner.id,
            firstName: contact.owner.firstName,
            lastName: contact.owner.lastName,
            fullName:
              `${contact.owner.firstName} ${contact.owner.lastName}`.trim(),
            email: contact.owner.email,
          }
        : null,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    };
  }
}
