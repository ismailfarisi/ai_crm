import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { OrganizationProfileDto, UpdateOrganizationPayload } from '@saas/shared';
import { Organization } from './entities/organization.entity';

/**
 * Reads and edits the tenant's own record.
 *
 * There was no service here at all: the entity existed, `org:read` and
 * `org:update` were granted to every owner, and nothing implemented them.
 */
@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
  ) {}

  async findById(tenantId: string): Promise<Organization> {
    const organization = await this.organizations.findOne({
      where: { id: tenantId },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
    return organization;
  }

  async get(tenantId: string): Promise<OrganizationProfileDto> {
    return OrganizationsService.toDto(await this.findById(tenantId));
  }

  async update(
    tenantId: string,
    dto: UpdateOrganizationPayload,
  ): Promise<OrganizationProfileDto> {
    const organization = await this.findById(tenantId);

    // The schema has already normalised blanks to null and upper-cased the
    // country, so an explicit key here is a deliberate clear. `name` is the
    // one field that cannot be cleared, and the schema keeps it optional
    // rather than nullable so a patch that omits it leaves it alone.
    for (const [key, value] of Object.entries(dto)) {
      if (key === 'name' && (value == null || value === '')) continue;
      (organization as unknown as Record<string, unknown>)[key] = value;
    }

    return OrganizationsService.toDto(await this.organizations.save(organization));
  }

  /** Relations are never wanted here; the tenant record is what is asked for. */
  private static toDto(organization: Organization): OrganizationProfileDto {
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      baseCurrency: organization.baseCurrency,
      legalName: organization.legalName ?? null,
      taxId: organization.taxId ?? null,
      registrationNumber: organization.registrationNumber ?? null,
      email: organization.email ?? null,
      phone: organization.phone ?? null,
      website: organization.website ?? null,
      addressLine1: organization.addressLine1 ?? null,
      addressLine2: organization.addressLine2 ?? null,
      city: organization.city ?? null,
      region: organization.region ?? null,
      postalCode: organization.postalCode ?? null,
      country: organization.country ?? null,
      documentFooter: organization.documentFooter ?? null,
    };
  }
}
