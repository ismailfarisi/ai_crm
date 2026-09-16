import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { updateOrganizationSchema } from '@saas/shared';
import { OrganizationsService } from './organizations.service';
import { Organization } from './entities/organization.entity';

describe('OrganizationsService', () => {
  const tenantId = 'org-1';
  let repo: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let service: OrganizationsService;

  function organizationFixture(overrides: Partial<Organization> = {}): Organization {
    return {
      id: tenantId,
      name: 'Meridian Packaging Co',
      slug: 'meridian-packaging-co',
      baseCurrency: 'USD',
      legalName: null,
      taxId: null,
      registrationNumber: null,
      email: null,
      phone: null,
      website: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      postalCode: null,
      country: null,
      documentFooter: null,
      ...overrides,
    } as Organization;
  }

  beforeEach(() => {
    repo = {
      findOne: jest.fn().mockResolvedValue(organizationFixture()),
      save: jest.fn().mockImplementation(async (o) => o),
    };
    service = new OrganizationsService(
      repo as unknown as Repository<Organization>,
    );
  });

  it('returns the tenant record without its relations', async () => {
    const dto = await service.get(tenantId);

    expect(dto).toMatchObject({
      id: tenantId,
      name: 'Meridian Packaging Co',
      baseCurrency: 'USD',
      taxId: null,
    });
    expect(dto).not.toHaveProperty('users');
  });

  it('refuses when the organization is missing', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.get(tenantId)).rejects.toThrow(NotFoundException);
  });

  it('saves the details that print on a document', async () => {
    const dto = updateOrganizationSchema.parse({
      taxId: 'US-884120993',
      addressLine1: '1400 Cannery Row',
      city: 'Oakland',
      postalCode: '94607',
      country: 'us',
    });

    const result = await service.update(tenantId, dto);

    expect(result.taxId).toBe('US-884120993');
    expect(result.addressLine1).toBe('1400 Cannery Row');
    // Tax rules match an exact country code, so it is stored upper-cased.
    expect(result.country).toBe('US');
  });

  it('treats a blank as clearing the field', async () => {
    repo.findOne.mockResolvedValue(organizationFixture({ taxId: 'OLD-123' }));

    const dto = updateOrganizationSchema.parse({ taxId: '' });
    const result = await service.update(tenantId, dto);

    expect(result.taxId).toBeNull();
  });

  // The trading name is what every other screen calls the tenant, so a patch
  // must not be able to leave it empty.
  it('keeps the existing name when a patch omits it', async () => {
    const dto = updateOrganizationSchema.parse({ city: 'Oakland' });
    const result = await service.update(tenantId, dto);

    expect(result.name).toBe('Meridian Packaging Co');
  });

  it('rejects a country that is not a two-letter code', () => {
    expect(() => updateOrganizationSchema.parse({ country: 'United States' })).toThrow(
      /two-letter code/i,
    );
  });
});
