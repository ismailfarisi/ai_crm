import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AutomationEventBridgeService } from './automation-event-bridge.service';
import { AutomationWorkflow } from '../entities/automation-workflow.entity';
import { AutomationsService } from '../automations.service';

describe('AutomationEventBridgeService', () => {
  let service: AutomationEventBridgeService;
  let workflowRepo: any;
  let automationsService: any;

  beforeEach(async () => {
    workflowRepo = {
      find: jest.fn(),
    };

    automationsService = {
      triggerExecution: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationEventBridgeService,
        {
          provide: getRepositoryToken(AutomationWorkflow),
          useValue: workflowRepo,
        },
        {
          provide: AutomationsService,
          useValue: automationsService,
        },
      ],
    }).compile();

    service = module.get<AutomationEventBridgeService>(
      AutomationEventBridgeService,
    );
  });

  it('triggers matching workflows on CRM event', async () => {
    const mockWorkflow = {
      id: 'wf-1',
      name: 'Quote Approval Flow',
      tenantId: 'tenant-1',
      status: 'ACTIVE',
      triggerType: 'CRM_EVENT',
      triggerConfig: { event: 'QUOTE_CREATED' },
    };

    workflowRepo.find.mockResolvedValue([mockWorkflow]);
    automationsService.triggerExecution.mockResolvedValue({
      id: 'exec-1',
      status: 'RUNNING',
    });

    const result = await service.handleCrmEvent({
      tenantId: 'tenant-1',
      eventType: 'QUOTE_CREATED',
      entityId: 'quote-101',
      data: { totalAmount: 15000, customerName: 'Acme Corp' },
    });

    expect(result).toHaveLength(1);
    expect(automationsService.triggerExecution).toHaveBeenCalledWith(
      'tenant-1',
      'wf-1',
      expect.objectContaining({
        eventType: 'QUOTE_CREATED',
        entityId: 'quote-101',
        payload: { totalAmount: 15000, customerName: 'Acme Corp' },
      }),
    );
  });

  it('ignores workflows with non-matching event types', async () => {
    const mockWorkflow = {
      id: 'wf-2',
      name: 'Deal Won Flow',
      tenantId: 'tenant-1',
      status: 'ACTIVE',
      triggerType: 'CRM_EVENT',
      triggerConfig: { event: 'DEAL_WON' },
    };

    workflowRepo.find.mockResolvedValue([mockWorkflow]);

    const result = await service.handleCrmEvent({
      tenantId: 'tenant-1',
      eventType: 'QUOTE_CREATED',
      entityId: 'quote-101',
      data: {},
    });

    expect(result).toHaveLength(0);
    expect(automationsService.triggerExecution).not.toHaveBeenCalled();
  });
});
