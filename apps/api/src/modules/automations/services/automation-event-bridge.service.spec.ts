import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AutomationEventBridgeService } from './automation-event-bridge.service';
import { AutomationWorkflow } from '../entities/automation-workflow.entity';
import { AutomationsService } from '../automations.service';
import { CrmEventBusService } from '@/common/events';
import type { CrmDomainEvent } from '@saas/shared';

describe('AutomationEventBridgeService', () => {
  let service: AutomationEventBridgeService;
  let workflowRepo: any;
  let automationsService: any;
  let crmEventBusService: CrmEventBusService;

  beforeEach(async () => {
    workflowRepo = {
      find: jest.fn(),
    };

    automationsService = {
      triggerExecution: jest.fn(),
    };

    crmEventBusService = new CrmEventBusService();

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
        {
          provide: CrmEventBusService,
          useValue: crmEventBusService,
        },
      ],
    }).compile();

    service = module.get<AutomationEventBridgeService>(
      AutomationEventBridgeService,
    );
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('Legacy handleCrmEvent', () => {
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

  describe('handleDomainEvent', () => {
    const baseEvent: CrmDomainEvent = {
      tenantId: 'tenant-1',
      eventType: 'record.updated',
      entityType: 'core',
      entityName: 'contact',
      entityId: 'contact-100',
      actorUserId: 'user-1',
      timestamp: '2026-10-08T12:00:00.000Z',
      snapshot: {
        before: { id: 'contact-100', status: 'LEAD', email: 'old@example.com' },
        after: { id: 'contact-100', status: 'CUSTOMER', email: 'new@example.com' },
        changedFields: ['email', 'status'],
      },
    };

    it('triggers workflow on matching eventType and matching entityName', async () => {
      const mockWorkflow = {
        id: 'wf-domain-1',
        name: 'Contact Updated Flow',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: {
          event: 'record.updated',
          entityName: 'contact',
        },
      };

      workflowRepo.find.mockResolvedValue([mockWorkflow]);
      automationsService.triggerExecution.mockResolvedValue({
        id: 'exec-domain-1',
        status: 'RUNNING',
      });

      const executions = await service.handleDomainEvent(baseEvent);

      expect(executions).toHaveLength(1);
      expect(workflowRepo.find).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          status: 'ACTIVE',
          triggerType: 'CRM_EVENT',
        },
      });
      expect(automationsService.triggerExecution).toHaveBeenCalledWith(
        'tenant-1',
        'wf-domain-1',
        expect.objectContaining({
          eventType: 'record.updated',
          entityId: 'contact-100',
          timestamp: '2026-10-08T12:00:00.000Z',
          payload: { id: 'contact-100', status: 'CUSTOMER', email: 'new@example.com' },
          snapshot: baseEvent.snapshot,
          event: baseEvent,
        }),
      );
    });

    it('triggers workflow when changedFields contains configured fields', async () => {
      const mockWorkflow = {
        id: 'wf-fields-match',
        name: 'Contact Email Changed Flow',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: {
          event: 'record.updated',
          entityName: 'contact',
          fields: ['email', 'phone'],
        },
      };

      workflowRepo.find.mockResolvedValue([mockWorkflow]);
      automationsService.triggerExecution.mockResolvedValue({
        id: 'exec-fields-1',
        status: 'RUNNING',
      });

      const executions = await service.handleDomainEvent(baseEvent);

      expect(executions).toHaveLength(1);
      expect(automationsService.triggerExecution).toHaveBeenCalledWith(
        'tenant-1',
        'wf-fields-match',
        expect.anything(),
      );
    });

    it('ignores workflow when changedFields does not contain any configured fields', async () => {
      const mockWorkflow = {
        id: 'wf-fields-no-match',
        name: 'Contact Phone Changed Flow',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: {
          event: 'record.updated',
          entityName: 'contact',
          fields: ['phone', 'mobile'], // changedFields is ['email', 'status']
        },
      };

      workflowRepo.find.mockResolvedValue([mockWorkflow]);

      const executions = await service.handleDomainEvent(baseEvent);

      expect(executions).toHaveLength(0);
      expect(automationsService.triggerExecution).not.toHaveBeenCalled();
    });

    it('triggers workflow matching changedFields configured via triggerConfig.changedFields', async () => {
      const mockWorkflow = {
        id: 'wf-changed-fields-alias',
        name: 'Contact Status Changed Flow',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: {
          event: 'record.updated',
          entityName: 'contact',
          changedFields: ['status'],
        },
      };

      workflowRepo.find.mockResolvedValue([mockWorkflow]);
      automationsService.triggerExecution.mockResolvedValue({
        id: 'exec-alias-1',
        status: 'RUNNING',
      });

      const executions = await service.handleDomainEvent(baseEvent);

      expect(executions).toHaveLength(1);
      expect(automationsService.triggerExecution).toHaveBeenCalled();
    });

    it('triggers workflow matching attribute conditions against snapshot after state', async () => {
      const matchingWorkflow = {
        id: 'wf-cond-match',
        name: 'Customer Won Flow',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: {
          event: 'record.updated',
          conditions: { status: 'CUSTOMER' },
        },
      };

      const nonMatchingWorkflow = {
        id: 'wf-cond-mismatch',
        name: 'Churned Flow',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: {
          event: 'record.updated',
          conditions: { status: 'CHURNED' },
        },
      };

      workflowRepo.find.mockResolvedValue([matchingWorkflow, nonMatchingWorkflow]);
      automationsService.triggerExecution.mockResolvedValue({
        id: 'exec-cond-1',
        status: 'RUNNING',
      });

      const executions = await service.handleDomainEvent(baseEvent);

      expect(executions).toHaveLength(1);
      expect(automationsService.triggerExecution).toHaveBeenCalledTimes(1);
      expect(automationsService.triggerExecution).toHaveBeenCalledWith(
        'tenant-1',
        'wf-cond-match',
        expect.anything(),
      );
    });

    it('matches wildcard event type "*"', async () => {
      const mockWorkflow = {
        id: 'wf-wildcard',
        name: 'Global Auditor',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: {
          event: '*',
        },
      };

      workflowRepo.find.mockResolvedValue([mockWorkflow]);
      automationsService.triggerExecution.mockResolvedValue({
        id: 'exec-wc',
        status: 'RUNNING',
      });

      const executions = await service.handleDomainEvent(baseEvent);

      expect(executions).toHaveLength(1);
      expect(automationsService.triggerExecution).toHaveBeenCalled();
    });

    it('matches legacy/action event syntax like "contact.updated" or "CONTACT_UPDATED"', async () => {
      const mockWorkflow = {
        id: 'wf-action-syntax',
        name: 'Contact Dot Action Flow',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: {
          event: 'contact.updated',
        },
      };

      workflowRepo.find.mockResolvedValue([mockWorkflow]);
      automationsService.triggerExecution.mockResolvedValue({
        id: 'exec-action',
        status: 'RUNNING',
      });

      const executions = await service.handleDomainEvent(baseEvent);

      expect(executions).toHaveLength(1);
      expect(automationsService.triggerExecution).toHaveBeenCalled();
    });

    it('ignores workflows with non-matching entityName or entityType', async () => {
      const mockWorkflowWrongEntity = {
        id: 'wf-wrong-entity',
        name: 'Quote Flow',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: {
          event: 'record.updated',
          entityName: 'quote',
        },
      };

      const mockWorkflowWrongType = {
        id: 'wf-wrong-type',
        name: 'Custom Object Flow',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: {
          event: 'record.updated',
          entityType: 'custom_object',
        },
      };

      workflowRepo.find.mockResolvedValue([
        mockWorkflowWrongEntity,
        mockWorkflowWrongType,
      ]);

      const executions = await service.handleDomainEvent(baseEvent);

      expect(executions).toHaveLength(0);
      expect(automationsService.triggerExecution).not.toHaveBeenCalled();
    });

    it('enforces strict tenant isolation by scoping repository find to event.tenantId', async () => {
      workflowRepo.find.mockResolvedValue([]);

      await service.handleDomainEvent({
        ...baseEvent,
        tenantId: 'isolated-tenant-999',
      });

      expect(workflowRepo.find).toHaveBeenCalledWith({
        where: {
          tenantId: 'isolated-tenant-999',
          status: 'ACTIVE',
          triggerType: 'CRM_EVENT',
        },
      });
    });

    it('shields errors so failure in one workflow trigger does not abort others', async () => {
      const wf1 = {
        id: 'wf-fail',
        name: 'Failing Workflow',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: { event: '*' },
      };
      const wf2 = {
        id: 'wf-success',
        name: 'Succeeding Workflow',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: { event: '*' },
      };

      workflowRepo.find.mockResolvedValue([wf1, wf2]);
      automationsService.triggerExecution
        .mockRejectedValueOnce(new Error('Temporal engine unavailable'))
        .mockResolvedValueOnce({ id: 'exec-ok', status: 'RUNNING' });

      const executions = await service.handleDomainEvent(baseEvent);

      expect(executions).toHaveLength(1);
      expect(executions[0].id).toBe('exec-ok');
    });
  });

  describe('CrmEventBusService Subscription', () => {
    it('automatically invokes handleDomainEvent when domain events are published on CrmEventBusService', async () => {
      const mockWorkflow = {
        id: 'wf-bus-listener',
        name: 'Event Bus Listener Flow',
        tenantId: 'tenant-bus-1',
        status: 'ACTIVE',
        triggerType: 'CRM_EVENT',
        triggerConfig: {
          event: 'record.created',
          entityName: 'quote',
        },
      };

      workflowRepo.find.mockResolvedValue([mockWorkflow]);
      automationsService.triggerExecution.mockResolvedValue({
        id: 'exec-bus-1',
        status: 'RUNNING',
      });

      const event: CrmDomainEvent = {
        tenantId: 'tenant-bus-1',
        eventType: 'record.created',
        entityType: 'core',
        entityName: 'quote',
        entityId: 'quote-999',
        timestamp: '2026-10-08T12:30:00.000Z',
        snapshot: {
          before: null,
          after: { id: 'quote-999', total: 5000 },
          changedFields: ['id', 'total'],
        },
      };

      await crmEventBusService.publish(event);

      expect(workflowRepo.find).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-bus-1',
          status: 'ACTIVE',
          triggerType: 'CRM_EVENT',
        },
      });
      expect(automationsService.triggerExecution).toHaveBeenCalledWith(
        'tenant-bus-1',
        'wf-bus-listener',
        expect.objectContaining({
          eventType: 'record.created',
          entityId: 'quote-999',
        }),
      );
    });

    it('unsubscribes from CrmEventBusService when onModuleDestroy is called', async () => {
      service.onModuleDestroy();

      const event: CrmDomainEvent = {
        tenantId: 'tenant-bus-1',
        eventType: 'record.created',
        entityType: 'core',
        entityName: 'quote',
        entityId: 'quote-999',
        timestamp: '2026-10-08T12:30:00.000Z',
        snapshot: {
          before: null,
          after: {},
          changedFields: [],
        },
      };

      await crmEventBusService.publish(event);

      expect(workflowRepo.find).not.toHaveBeenCalled();
      expect(automationsService.triggerExecution).not.toHaveBeenCalled();
    });
  });
});
