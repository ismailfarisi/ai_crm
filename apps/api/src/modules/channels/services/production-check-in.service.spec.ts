import { ProductionCheckInService } from './production-check-in.service';
import { ProductionService } from '../../production/production.service';
import { ChannelsService } from '../channels.service';
import { StaffChannelIdentity } from '../entities/staff-channel-identity.entity';
import { ChannelConfig, ChannelProviderType } from '../entities/channel-config.entity';
import type { Repository } from 'typeorm';

describe('ProductionCheckInService', () => {
  let service: ProductionCheckInService;
  let production: Partial<ProductionService>;
  let channels: Partial<ChannelsService>;
  let identityRepo: Partial<Repository<StaffChannelIdentity>>;
  let configRepo: Partial<Repository<ChannelConfig>>;

  beforeEach(() => {
    production = {
      list: jest.fn(),
    };
    channels = {
      sendMessage: jest.fn(),
    };
    identityRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    };
    configRepo = {
      find: jest.fn(),
    };
    service = new ProductionCheckInService(
      production as ProductionService,
      channels as ChannelsService,
      identityRepo as Repository<StaffChannelIdentity>,
      configRepo as Repository<ChannelConfig>,
    );
  });

  it('detects operations running longer than estimated time and sends check-in', async () => {
    (configRepo.find as jest.Mock).mockResolvedValue([
      { organizationId: 'org-1', provider: ChannelProviderType.TELEGRAM, isEnabled: true },
    ]);
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0003',
        description: 'Rigid gift box',
        status: 'IN_PROGRESS',
        operations: [
          {
            id: 'op-1',
            label: 'Die cutting',
            status: 'RUNNING',
            runningSince: new Date(Date.now() - 100 * 60000).toISOString(), // 100 mins
            estimatedSetupMinutes: 10,
            estimatedRunMinutes: 30, // total est 40 mins
            actualMinutes: 0,
            operatorId: 'user-1',
          },
        ],
      },
    ]);
    (identityRepo.findOne as jest.Mock).mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      provider: ChannelProviderType.TELEGRAM,
      identifier: '12345678',
    });

    const pings = await service.checkAndNotifyOrg('org-1');
    expect(pings).toBe(1);
    expect(channels.sendMessage).toHaveBeenCalledWith('org-1', 'user-1', expect.objectContaining({
      provider: ChannelProviderType.TELEGRAM,
      recipient: '12345678',
      body: expect.stringContaining('WO-2026-0003'),
    }));
  });

  it('respects 2-hour cooldown and does not ping again within cooldown window', async () => {
    (configRepo.find as jest.Mock).mockResolvedValue([
      { organizationId: 'org-1', provider: ChannelProviderType.TELEGRAM, isEnabled: true },
    ]);
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-1',
        woNumber: 'WO-2026-0003',
        description: 'Rigid gift box',
        status: 'IN_PROGRESS',
        operations: [
          {
            id: 'op-1',
            label: 'Die cutting',
            status: 'RUNNING',
            runningSince: new Date(Date.now() - 100 * 60000).toISOString(),
            estimatedSetupMinutes: 10,
            estimatedRunMinutes: 30,
            actualMinutes: 0,
            operatorId: 'user-1',
          },
        ],
      },
    ]);
    (identityRepo.findOne as jest.Mock).mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-1',
      provider: ChannelProviderType.TELEGRAM,
      identifier: '12345678',
    });

    await service.checkAndNotifyOrg('org-1');
    expect(channels.sendMessage).toHaveBeenCalledTimes(1);

    // Second run should be skipped due to cooldown
    const secondPings = await service.checkAndNotifyOrg('org-1');
    expect(secondPings).toBe(0);
    expect(channels.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('detects overdue work orders and dispatches overdue alert', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    (production.list as jest.Mock).mockResolvedValue([
      {
        id: 'wo-2',
        woNumber: 'WO-2026-0004',
        description: 'Folding carton',
        status: 'PLANNED',
        dueDate: yesterday,
        operations: [],
      },
    ]);
    (identityRepo.findOne as jest.Mock).mockResolvedValue({
      organizationId: 'org-1',
      userId: 'manager-1',
      provider: ChannelProviderType.TELEGRAM,
      identifier: '87654321',
    });

    const pings = await service.checkAndNotifyOrg('org-1');
    expect(pings).toBe(1);
    expect(channels.sendMessage).toHaveBeenCalledWith('org-1', 'manager-1', expect.objectContaining({
      provider: ChannelProviderType.TELEGRAM,
      recipient: '87654321',
      body: expect.stringContaining('Overdue Job Notice'),
    }));
  });

  it('runs handleScheduledCheckIns across distinct orgs with active configs', async () => {
    (configRepo.find as jest.Mock).mockResolvedValue([
      { organizationId: 'org-1', provider: ChannelProviderType.TELEGRAM, isEnabled: true },
      { organizationId: 'org-1', provider: ChannelProviderType.WHATSAPP_META, isEnabled: true },
      { organizationId: 'org-2', provider: ChannelProviderType.TELEGRAM, isEnabled: true },
    ]);
    jest.spyOn(service, 'checkAndNotifyOrg').mockResolvedValue(1);

    await service.handleScheduledCheckIns();

    expect(service.checkAndNotifyOrg).toHaveBeenCalledTimes(2);
    expect(service.checkAndNotifyOrg).toHaveBeenCalledWith('org-1');
    expect(service.checkAndNotifyOrg).toHaveBeenCalledWith('org-2');
  });
});
