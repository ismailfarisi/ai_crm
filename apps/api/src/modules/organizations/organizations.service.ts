import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LOGO_CONTENT_TYPES, LOGO_MAX_BYTES } from '@saas/shared';
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
      logoUrl: OrganizationsService.logoUrl(organization),
    };
  }

  /**
   * Where this organization's logo is served from, with a cache-buster.
   *
   * Relative, so it works on whatever host the API is reached at. `null` when
   * no logo has been uploaded, which is what every caller checks before
   * reserving space for one.
   */
  static logoUrl(organization: Organization): string | null {
    if (!organization.logoContentType) return null;
    const version = organization.logoUpdatedAt?.getTime() ?? 0;
    return `/organization/${organization.id}/logo?v=${version}`;
  }

  /**
   * Stores a new logo, replacing any previous one.
   *
   * The content type is taken from the allowlist rather than from the upload:
   * this file is served back inline, and a browser asked to render
   * `image/svg+xml` inline will run whatever script is inside it on the
   * origin that served it. Raster only, so there is nothing to run.
   */
  async setLogo(
    tenantId: string,
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ): Promise<OrganizationProfileDto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No image was uploaded');
    }
    if (!LOGO_CONTENT_TYPES.includes(file.mimetype as (typeof LOGO_CONTENT_TYPES)[number])) {
      throw new BadRequestException(
        `A logo must be a PNG, JPEG or WebP image. ${file.mimetype} cannot be used.`,
      );
    }
    if (file.size > LOGO_MAX_BYTES) {
      throw new BadRequestException(
        `A logo must be under ${Math.round(LOGO_MAX_BYTES / 1024 / 1024)} MB.`,
      );
    }

    const organization = await this.findById(tenantId);
    organization.logoData = file.buffer;
    organization.logoContentType = file.mimetype;
    organization.logoUpdatedAt = new Date();

    return OrganizationsService.toDto(await this.organizations.save(organization));
  }

  async clearLogo(tenantId: string): Promise<OrganizationProfileDto> {
    const organization = await this.findById(tenantId);
    organization.logoData = null;
    organization.logoContentType = null;
    organization.logoUpdatedAt = null;

    return OrganizationsService.toDto(await this.organizations.save(organization));
  }

  /**
   * The logo bytes, for the public route.
   *
   * Takes an id rather than reading the session, because the customer opening
   * a quote link has none. A logo is on every document the business sends, so
   * it is not a secret; the id in the URL is one the holder of the link
   * already has.
   */
  async logo(
    tenantId: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const organization = await this.organizations.findOne({
      where: { id: tenantId },
    });
    if (!organization?.logoData || !organization.logoContentType) {
      throw new NotFoundException('This organization has no logo');
    }
    return {
      body: organization.logoData,
      contentType: organization.logoContentType,
    };
  }
}
