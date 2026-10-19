import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import {
  isUaeVatMode,
  isValidTrn,
  nextPeriodStart,
  type UaeVatStatusDto,
  type VatSettingsDto,
  type VatSettingsPayload,
} from '@saas/shared';
import { Branch } from '../organizations/entities/branch.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { VatSettings } from './entities/vat-settings.entity';
import {
  seedUaeStarterCodes,
  uaeBaseCurrencyProblem,
} from './uae-starter-codes';

const DUBAI_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in the UAE as 'YYYY-MM-DD' — the calendar the FTA files by. */
export function todayInDubai(now: Date = new Date()): string {
  return DUBAI_DATE.format(now);
}

/**
 * A `date` column as 'YYYY-MM-DD'. TypeORM already hands these back as
 * strings; a `Date` (from a driver that parses them) is read in local time,
 * which is how such a driver builds it, so the calendar day survives.
 */
function isoDate(value: string | Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

const toVatSettingsDto = (row: VatSettings): VatSettingsDto => ({
  id: row.id,
  periodFrequency: row.periodFrequency,
  firstPeriodStart: isoDate(row.firstPeriodStart),
  registrationDate: isoDate(row.registrationDate),
  vatStartDate: isoDate(row.vatStartDate),
  taxAgentName: row.taxAgentName ?? null,
  taxAgencyName: row.taxAgencyName ?? null,
  tan: row.tan ?? null,
  taan: row.taan ?? null,
});

/**
 * Whether a tenant is in UAE VAT mode, what stands in the way if not, and its
 * VAT registration settings.
 *
 * Reads the organization and its branches through its own repositories: the
 * organizations module calls into tax (to seed starter codes), so tax must
 * not depend on it back.
 */
@Injectable()
export class UaeVatService {
  constructor(
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    @InjectRepository(VatSettings)
    private readonly settings: Repository<VatSettings>,
  ) {}

  async isEnabled(tenantId: string): Promise<boolean> {
    return isUaeVatMode(await this.organization(tenantId));
  }

  async status(tenantId: string): Promise<UaeVatStatusDto> {
    const [organization, branches, settings] = await Promise.all([
      this.organization(tenantId),
      this.branches.find({
        where: { tenantId, isActive: true },
        order: { isHeadOffice: 'DESC', name: 'ASC' },
      }),
      this.settings.findOne({ where: { tenantId } }),
    ]);

    const problems = this.organizationProblems(organization);
    for (const branch of branches) {
      if (!branch.emirate) problems.push(`${branch.name} has no emirate`);
    }
    if (!settings) problems.push('Set your VAT periods and start date');

    const dto = settings ? toVatSettingsDto(settings) : null;
    return {
      enabled: isUaeVatMode(organization),
      problems,
      settings: dto,
      suggestedVatStartDate: dto
        ? nextPeriodStart(
            dto.firstPeriodStart,
            dto.periodFrequency,
            todayInDubai(),
          )
        : null,
    };
  }

  async getSettings(tenantId: string): Promise<VatSettingsDto | null> {
    const row = await this.settings.findOne({ where: { tenantId } });
    return row ? toVatSettingsDto(row) : null;
  }

  async saveSettings(
    tenantId: string,
    input: VatSettingsPayload,
  ): Promise<VatSettingsDto> {
    const organization = await this.organization(tenantId);
    if (!isUaeVatMode(organization)) {
      throw new BadRequestException(this.organizationProblems(organization)[0]);
    }
    const existing = await this.settings.findOne({ where: { tenantId } });
    const row = existing
      ? Object.assign(existing, input)
      : this.settings.create({ tenantId, ...input });
    return toVatSettingsDto(await this.settings.save(row));
  }

  async seedStarterCodes(
    tenantId: string,
    manager: EntityManager = this.settings.manager,
  ): Promise<void> {
    await seedUaeStarterCodes(manager, tenantId);
  }

  /** In order: country, TRN, currency — whichever keep UAE VAT mode off. */
  private organizationProblems(organization: Organization): string[] {
    const problems: string[] = [];
    if (organization.country !== 'AE') {
      problems.push('Set the country to United Arab Emirates');
    }
    if (!isValidTrn(organization.taxId)) problems.push('Add your 15-digit TRN');
    if (organization.baseCurrency !== 'AED') {
      problems.push(uaeBaseCurrencyProblem(organization.baseCurrency));
    }
    return problems;
  }

  private async organization(tenantId: string): Promise<Organization> {
    const organization = await this.organizations.findOne({
      where: { id: tenantId },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }
}
