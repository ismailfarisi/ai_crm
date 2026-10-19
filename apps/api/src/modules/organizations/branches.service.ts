import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  Not,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  emirateFromText,
  isUaeVatMode,
  type BranchDto,
  type Emirate,
  type BranchPayload,
} from '@saas/shared';
import { Branch } from './entities/branch.entity';
import { Organization } from './entities/organization.entity';

const POSTGRES_UNIQUE_VIOLATION = '23505';
const HEAD_OFFICE_INDEX = 'uq_branches_tenant_head_office';

type HeadOfficeAddress = Pick<
  Organization,
  'addressLine1' | 'addressLine2' | 'city'
>;

/**
 * The emirate an organization's own address names, if any: the region first
 * (where an emirate is usually typed), then the city ("Dubai").
 */
export const emirateOfOrganization = (
  org: Pick<Organization, 'region' | 'city'>,
): Emirate | null => emirateFromText(org.region) ?? emirateFromText(org.city);

/**
 * Keeps the head office in step with the company profile it was made from.
 *
 * The address follows the organization only while the branch still holds the
 * organization's previous address — once someone has given the head office
 * an address of its own, it is left alone. A missing emirate is filled from
 * the new address. Runs in the caller's transaction.
 */
export async function syncHeadOffice(
  manager: EntityManager,
  org: Organization,
  previous: HeadOfficeAddress,
): Promise<void> {
  const repo = manager.getRepository(Branch);
  const head = await repo.findOne({
    where: { tenantId: org.id, isHeadOffice: true },
  });
  if (!head) return;

  const blank = (v: string | null | undefined) => v || null;
  const fields = ['addressLine1', 'addressLine2', 'city'] as const;
  const followsOrganization = fields.every(
    (f) => blank(head[f]) === blank(previous[f]),
  );
  let changed = false;
  if (followsOrganization) {
    for (const f of fields) {
      if (blank(head[f]) !== blank(org[f])) {
        head[f] = blank(org[f]);
        changed = true;
      }
    }
  }
  if (head.emirate === null) {
    const emirate = emirateOfOrganization(org);
    if (emirate) {
      head.emirate = emirate;
      changed = true;
    }
  }
  if (changed) await repo.save(head);
}

const toDto = (b: Branch): BranchDto => ({
  id: b.id,
  name: b.name,
  addressLine1: b.addressLine1,
  addressLine2: b.addressLine2,
  city: b.city,
  emirate: b.emirate,
  isHeadOffice: b.isHeadOffice,
  invoicePrefix: b.invoicePrefix,
  isActive: b.isActive,
});

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Branch)
    private readonly branches: Repository<Branch>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    private readonly dataSource: DataSource,
  ) {}

  async list(tenantId: string): Promise<BranchDto[]> {
    const rows = await this.branches.find({
      where: { tenantId },
      order: { isHeadOffice: 'DESC', name: 'ASC' },
    });
    return rows.map(toDto);
  }

  async create(tenantId: string, input: BranchPayload): Promise<BranchDto> {
    return this.write(tenantId, input, async (manager) => {
      const repo = manager.getRepository(Branch);
      if (input.isHeadOffice) await this.unsetHeadOffice(repo, tenantId);
      return repo.save(repo.create({ ...this.fields(input), tenantId }));
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: BranchPayload,
  ): Promise<BranchDto> {
    // An unknown branch is a 404 before anything about the payload is judged.
    if (!(await this.branches.findOne({ where: { id, tenantId } }))) {
      throw new NotFoundException('Branch not found');
    }
    return this.write(tenantId, input, async (manager) => {
      const repo = manager.getRepository(Branch);
      const existing = await repo.findOne({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException('Branch not found');
      if (existing.isHeadOffice && !input.isHeadOffice) {
        throw new BadRequestException('There must be a head office');
      }
      if (input.isHeadOffice) await this.unsetHeadOffice(repo, tenantId, id);
      return repo.save(Object.assign(existing, this.fields(input)));
    });
  }

  async headOffice(
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Branch> {
    const repo = manager ? manager.getRepository(Branch) : this.branches;
    const head = await repo.findOne({
      where: { tenantId, isHeadOffice: true },
    });
    if (!head) {
      throw new NotFoundException('This organization has no head office');
    }
    return head;
  }

  /** Idempotent: creates the head office from the organization's address once. */
  async ensureHeadOffice(
    tenantId: string,
    manager: EntityManager,
  ): Promise<Branch> {
    const repo = manager.getRepository(Branch);
    const existing = await repo.findOne({
      where: { tenantId, isHeadOffice: true },
    });
    if (existing) return existing;
    const org = await manager
      .getRepository(Organization)
      .findOne({ where: { id: tenantId } });
    if (!org) throw new NotFoundException('Organization not found');
    return repo.save(
      repo.create({
        tenantId,
        name: 'Head office',
        addressLine1: org.addressLine1,
        addressLine2: org.addressLine2,
        city: org.city,
        emirate: emirateOfOrganization(org),
        isHeadOffice: true,
        invoicePrefix: null,
        isActive: true,
      }),
    );
  }

  async missingEmirates(tenantId: string): Promise<BranchDto[]> {
    const rows = await this.branches.find({
      where: { tenantId, isActive: true },
      order: { isHeadOffice: 'DESC', name: 'ASC' },
    });
    return rows.filter((b) => b.emirate === null).map(toDto);
  }

  /* ------------------------------------------------------------------ */

  private fields(input: BranchPayload) {
    return {
      name: input.name,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      emirate: input.emirate,
      isHeadOffice: input.isHeadOffice,
      invoicePrefix: input.invoicePrefix,
      isActive: input.isActive,
    };
  }

  /** Validates, then runs the write in one transaction so head-office moves are atomic. */
  private async write(
    tenantId: string,
    input: BranchPayload,
    run: (manager: EntityManager) => Promise<Branch>,
  ): Promise<BranchDto> {
    if (input.isHeadOffice && !input.isActive) {
      throw new BadRequestException('The head office cannot be deactivated');
    }
    const org = await this.organizations.findOne({ where: { id: tenantId } });
    if (!org) throw new NotFoundException('Organization not found');
    // Deactivating needs no emirate: a legacy branch without one must still
    // be retirable, and an inactive branch never issues a document.
    if (isUaeVatMode(org) && input.isActive !== false && !input.emirate) {
      throw new BadRequestException('Pick the emirate this branch is in');
    }
    try {
      return toDto(await this.dataSource.transaction(run));
    } catch (err) {
      throw this.duplicate(err, input.invoicePrefix);
    }
  }

  /** The partial unique index allows one head office, so clear the old one first. */
  private async unsetHeadOffice(
    repo: Repository<Branch>,
    tenantId: string,
    exceptId?: string,
  ): Promise<void> {
    await repo.update(
      exceptId
        ? { tenantId, isHeadOffice: true, id: Not(exceptId) }
        : { tenantId, isHeadOffice: true },
      { isHeadOffice: false },
    );
  }

  private duplicate(err: unknown, prefix: string | null): unknown {
    const e = err as { code?: string; constraint?: string };
    if (
      err instanceof QueryFailedError &&
      e.code === POSTGRES_UNIQUE_VIOLATION &&
      e.constraint !== HEAD_OFFICE_INDEX
    ) {
      return new ConflictException(
        `Another branch already uses the prefix ${prefix}`,
      );
    }
    return err;
  }
}
