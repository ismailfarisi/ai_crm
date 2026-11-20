import { BadRequestException, ConflictException } from '@nestjs/common';
import { ChannelAgentService } from './channel-agent.service';

function setup(existing: Record<string, unknown> | null = null) {
  const repo = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn((value) => value),
    save: jest.fn((value) => Promise.resolve(value)),
    remove: jest.fn(),
  };
  const registry = {
    all: () => [
      { name: 'quote.create', description: 'Create a quote' },
      { name: 'work_order.query', description: 'Look up a job', isMutating: false },
      { name: 'assistant.only', description: 'x', surfaces: ['assistant'] },
    ],
  };
  const service = new ChannelAgentService(repo as never, registry as never);
  return { repo, service };
}

const payload = {
  name: 'Purchasing',
  description: 'Buying materials',
  instructions: 'Use approved suppliers.',
  kind: 'STAFF' as const,
  model: null,
  provider: null,
  skills: ['quote.create'],
  channels: ['SLACK' as const],
  isEnabled: true,
};

describe('ChannelAgentService', () => {
  it('offers staff agents the chat skills and customer agents their own short list', () => {
    const { service } = setup();
    expect(service.toolOptions('STAFF')).toEqual([
      { name: 'quote.create', description: 'Create a quote', isMutating: true },
      { name: 'work_order.query', description: 'Look up a job', isMutating: false },
    ]);
    expect(service.toolOptions('CUSTOMER').map((tool) => tool.name)).toEqual([
      'draft_quote',
    ]);
  });

  it('refuses a tool that is not for that kind of agent', async () => {
    const { service } = setup();
    await expect(
      service.create('org', { ...payload, kind: 'CUSTOMER' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create('org', { ...payload, skills: ['draft_quote'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a second agent with the same name', async () => {
    const { service } = setup({ id: 'other', name: 'Purchasing' });
    await expect(service.create('org', payload)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('changes only what an update names, and clears the model on null', async () => {
    const stored = { id: 'a1', organizationId: 'org', ...payload, model: 'big' };
    const { service, repo } = setup(stored);

    await service.update('org', 'a1', { description: 'Buying board', model: null });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Buying board',
        model: null,
        skills: ['quote.create'],
        channels: ['SLACK'],
        isEnabled: true,
      }),
    );
  });

  it('lists only enabled agents that answer on the channel', async () => {
    const { service, repo } = setup();
    repo.find.mockResolvedValue([
      { name: 'A', channels: ['SLACK'] },
      { name: 'B', channels: ['TELEGRAM'] },
    ]);
    const found = await service.findEnabled('org', 'STAFF', 'SLACK');
    expect(found.map((agent) => agent.name)).toEqual(['A']);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org', kind: 'STAFF', isEnabled: true },
      }),
    );
  });
});
