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
  isUaeVatMode,
  type BranchDto,
  type BranchPayload,
} from '@saas/shared';
import { Branch } from './entities/branch.entity';
import { Organization } from './entities/organization.entity';

const POSTGRES_UNIQUE_VIOLATION = '23505';
const HEAD_OFFICE_INDEX = 'uq_branches_tenant_head_office';

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
        name: org.name,
        addressLine1: org.addressLine1,
        addressLine2: org.addressLine2,
        city: org.city,
        emirate: null,
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
    if (isUaeVatMode(org) && !input.emirate) {
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
