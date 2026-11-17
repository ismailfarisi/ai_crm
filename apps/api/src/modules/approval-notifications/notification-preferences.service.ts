import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  PERMISSIONS,
  type NotificationPreferencesView,
  type OrgNotificationPreferencesPayload,
  type Permission,
  type UserNotificationPreferencesPayload,
} from '@saas/shared';
import { StaffChannelIdentity } from '../channels/entities/staff-channel-identity.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import {
  effectivePreferences,
  orgDefaultFrom,
  userPrefsFrom,
} from './approval-notice.logic';

@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly prefs: Repository<NotificationPreference>,
    @InjectRepository(StaffChannelIdentity)
    private readonly identities: Repository<StaffChannelIdentity>,
  ) {}

  async view(
    tenantId: string,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<NotificationPreferencesView> {
    const [own, org, linked] = await Promise.all([
      this.prefs.findOne({ where: { tenantId, userId } }),
      this.prefs.findOne({ where: { tenantId, userId: IsNull() } }),
      this.identities.find({
        where: { organizationId: tenantId, userId },
        select: { provider: true },
      }),
    ]);
    return {
      own: own ? userPrefsFrom(own) : null,
      orgDefault: orgDefaultFrom(org),
      effective: effectivePreferences(own, org),
      linkedChats: [...new Set(linked.map((i) => i.provider))],
      canEditOrgDefault: permissions.includes(PERMISSIONS.ORG_UPDATE),
    };
  }

  async saveOwn(
    tenantId: string,
    userId: string,
    input: UserNotificationPreferencesPayload,
    permissions: readonly Permission[],
  ): Promise<NotificationPreferencesView> {
    const existing = await this.prefs.findOne({ where: { tenantId, userId } });
    await this.prefs.save({ ...(existing ?? {}), tenantId, userId, ...input });
    return this.view(tenantId, userId, permissions);
  }

  /** Back to the organisation default. */
  async resetOwn(
    tenantId: string,
    userId: string,
    permissions: readonly Permission[],
  ): Promise<NotificationPreferencesView> {
    await this.prefs.delete({ tenantId, userId });
    return this.view(tenantId, userId, permissions);
  }

  async saveOrgDefault(
    tenantId: string,
    userId: string,
    input: OrgNotificationPreferencesPayload,
    permissions: readonly Permission[],
  ): Promise<NotificationPreferencesView> {
    const existing = await this.prefs.findOne({
      where: { tenantId, userId: IsNull() },
    });
    await this.prefs.save({
      ...(existing ?? {}),
      tenantId,
      userId: null,
      ...input,
    });
    return this.view(tenantId, userId, permissions);
  }
}
