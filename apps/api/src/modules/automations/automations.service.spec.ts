import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { TemporalService } from '../temporal/temporal.service';
import { approveNodeSignal, rejectNodeSignal } from './workflows/interfaces';

describe('AutomationsService', () => {
  let service: AutomationsService;
  let workflowRepo: any;
  let executionRepo: any;
  let temporalService: any;
  let mockTemporalClient: any;
  let mockWorkflowHandle: any;

  const mockTenantId = 'tenant-uuid-1';
  const mockWorkflow: AutomationWorkflow = {
    id: 'wf-uuid-1',
    tenantId: mockTenantId,
    name: 'Sample Workflow',
    description: 'A test workflow',
    status: 'DRAFT',
    triggerType: 'MANUAL',
    triggerConfig: {},
    nodes: [
      {
        id: 'node-1',
        type: 'manualTrigger',
        position: { x: 0, y: 0 },
        data: { label: 'Manual Trigger', config: {} },
      },
    ],
    edges: [],
    webhookSlug: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockExecution: AutomationExecution = {
    id: 'exec-uuid-1',
    tenantId: mockTenantId,
    workflowId: mockWorkflow.id,
    temporalWorkflowId: 'automation-exec-exec-uuid-1',
    status: 'RUNNING',
    triggerPayload: { key: 'value' },
    nodeResults: {},
    startedAt: new Date(),
    finishedAt: null,
    errorMessage: null,
  };

  beforeEach(async () => {
    mockWorkflowHandle = {
      signal: jest.fn().mockResolvedValue(undefined),
    };

    mockTemporalClient = {
      workflow: {
        start: jest.fn().mockResolvedValue({ workflowId: 'automation-exec-exec-uuid-1' }),
        getHandle: jest.fn().mockReturnValue(mockWorkflowHandle),
      },
    };

    workflowRepo = {
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'wf-uuid-1', version: 1 })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ ...entity, id: entity.id || 'wf-uuid-1' })),
      find: jest.fn().mockResolvedValue([mockWorkflow]),
      findOne: jest.fn().mockResolvedValue(mockWorkflow),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      remove: jest.fn().mockResolvedValue(mockWorkflow),
    };

    executionRepo = {
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'exec-uuid-1' })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ ...entity, id: entity.id || 'exec-uuid-1' })),
      find: jest.fn().mockResolvedValue([mockExecution]),
      findOne: jest.fn().mockResolvedValue(mockExecution),
    };

    temporalService = {
      getClient: jest.fn().mockReturnValue(mockTemporalClient),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationsService,
        {
          provide: getRepositoryToken(AutomationWorkflow),
          useValue: workflowRepo,
        },
        {
          provide: getRepositoryToken(AutomationExecution),
          useValue: executionRepo,
        },
        {
          provide: TemporalService,
          useValue: temporalService,
        },
      ],
    }).compile();

    service = module.get<AutomationsService>(AutomationsService);
  });

  describe('createWorkflow', () => {
    it('creates manual workflow without webhook slug', async () => {
      const result = await service.createWorkflow(mockTenantId, {
        name: 'Manual Flow',
        triggerType: 'MANUAL',
        nodes: [],
        edges: [],
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('Manual Flow');
      expect(result.webhookSlug).toBeNull();
      expect(workflowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: mockTenantId,
          name: 'Manual Flow',
          triggerType: 'MANUAL',
          webhookSlug: null,
          status: 'DRAFT',
        }),
      );
      expect(workflowRepo.save).toHaveBeenCalled();
    });

    it('creates webhook workflow with auto-generated unique slug', async () => {
      const result = await service.createWorkflow(mockTenantId, {
        name: 'Webhook Flow',
        triggerType: 'WEBHOOK',
        nodes: [],
        edges: [],
      });

      expect(result).toBeDefined();
      expect(workflowRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: mockTenantId,
          triggerType: 'WEBHOOK',
          webhookSlug: expect.stringMatching(/^wh_\d+_[a-z0-9]+$/),
        }),
      );
    });
  });

  describe('findAllWorkflows', () => {
    it('returns all workflows for tenant ordered by updatedAt DESC', async () => {
      const result = await service.findAllWorkflows(mockTenantId);
      expect(result).toEqual([mockWorkflow]);
      expect(workflowRepo.find).toHaveBeenCalledWith({
        where: { tenantId: mockTenantId },
        order: { updatedAt: 'DESC' },
      });
    });
  });

  describe('findWorkflowById', () => {
    it('returns workflow when found for tenant', async () => {
      const result = await service.findWorkflowById(mockTenantId, 'wf-uuid-1');
      expect(result).toEqual(mockWorkflow);
      expect(workflowRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'wf-uuid-1', tenantId: mockTenantId },
      });
    });

    it('throws NotFoundException when workflow does not exist', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findWorkflowById(mockTenantId, 'wf-missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateWorkflow', () => {
    it('updates workflow properties and increments version', async () => {
      const existing = { ...mockWorkflow, version: 1 };
      workflowRepo.findOne.mockResolvedValueOnce(existing);

      const result = await service.updateWorkflow(mockTenantId, 'wf-uuid-1', {
        name: 'Updated Name',
        description: 'New Description',
        status: 'ACTIVE',
      });

      expect(result.name).toBe('Updated Name');
      expect(result.description).toBe('New Description');
      expect(result.status).toBe('ACTIVE');
      expect(result.version).toBe(2);
      expect(workflowRepo.save).toHaveBeenCalled();
    });

    it('generates webhookSlug if updated to WEBHOOK and slug was missing', async () => {
      const existing = { ...mockWorkflow, webhookSlug: null, triggerType: 'MANUAL' as const };
      workflowRepo.findOne.mockResolvedValueOnce(existing);

      const result = await service.updateWorkflow(mockTenantId, 'wf-uuid-1', {
        triggerType: 'WEBHOOK',
      });

      expect(result.webhookSlug).toMatch(/^wh_\d+_[a-z0-9]+$/);
    });

    it('throws NotFoundException if workflow does not exist', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.updateWorkflow(mockTenantId, 'non-existent', { name: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteWorkflow', () => {
    it('deletes workflow if found', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(mockWorkflow);
      await service.deleteWorkflow(mockTenantId, 'wf-uuid-1');
      expect(workflowRepo.remove).toHaveBeenCalledWith(mockWorkflow);
    });

    it('throws NotFoundException if workflow not found', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.deleteWorkflow(mockTenantId, 'wf-missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('triggerExecution', () => {
    it('creates execution record and starts temporal workflow', async () => {
      const payload = { amount: 500, customer: 'Acme' };
      const exec = await service.triggerExecution(mockTenantId, 'wf-uuid-1', payload);

      expect(exec).toBeDefined();
      expect(executionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: mockTenantId,
          workflowId: mockWorkflow.id,
          status: 'RUNNING',
          triggerPayload: payload,
        }),
      );
      expect(mockTemporalClient.workflow.start).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          taskQueue: 'automations-queue',
          workflowId: `automation-exec-exec-uuid-1`,
          args: [
            expect.objectContaining({
              executionId: 'exec-uuid-1',
              workflowId: mockWorkflow.id,
              tenantId: mockTenantId,
              triggerPayload: payload,
            }),
          ],
        }),
      );
    });

    it('handles temporal offline gracefully without throwing', async () => {
      temporalService.getClient.mockImplementationOnce(() => {
        throw new Error('Temporal offline');
      });

      const exec = await service.triggerExecution(mockTenantId, 'wf-uuid-1', {});
      expect(exec).toBeDefined();
      expect(exec.id).toBe('exec-uuid-1');
    });
  });

  describe('triggerWebhook', () => {
    it('finds workflow by slug and triggers execution', async () => {
      const webhookWf = { ...mockWorkflow, webhookSlug: 'wh_test_slug', status: 'ACTIVE' as const };
      workflowRepo.findOne.mockResolvedValueOnce(webhookWf);

      const exec = await service.triggerWebhook('wh_test_slug', { event: 'user_created' });
      expect(exec).toBeDefined();
      expect(workflowRepo.findOne).toHaveBeenCalledWith({
        where: { webhookSlug: 'wh_test_slug' },
      });
      expect(mockTemporalClient.workflow.start).toHaveBeenCalled();
    });

    it('throws NotFoundException if webhook slug does not exist', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.triggerWebhook('wh_unknown', {})).rejects.toThrow(NotFoundException);
    });
  });

  describe('findExecutionsByWorkflow', () => {
    it('returns executions list for workflow', async () => {
      const execs = await service.findExecutionsByWorkflow(mockTenantId, 'wf-uuid-1');
      expect(execs).toEqual([mockExecution]);
      expect(executionRepo.find).toHaveBeenCalledWith({
        where: { tenantId: mockTenantId, workflowId: 'wf-uuid-1' },
        order: { startedAt: 'DESC' },
      });
    });

    it('throws NotFoundException if workflow does not exist', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findExecutionsByWorkflow(mockTenantId, 'wf-unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findExecutionById', () => {
    it('returns execution when found', async () => {
      const result = await service.findExecutionById(mockTenantId, 'exec-uuid-1');
      expect(result).toEqual(mockExecution);
      expect(executionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'exec-uuid-1', tenantId: mockTenantId },
      });
    });

    it('throws NotFoundException when execution does not exist', async () => {
      executionRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findExecutionById(mockTenantId, 'exec-missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('signalExecution', () => {
    it('signals APPROVE to temporal workflow', async () => {
      const result = await service.signalExecution(mockTenantId, 'exec-uuid-1', {
        action: 'APPROVE',
        nodeId: 'approval-node-1',
        comment: 'Approved by manager',
      });

      expect(result).toEqual(mockExecution);
      expect(mockTemporalClient.workflow.getHandle).toHaveBeenCalledWith(
        mockExecution.temporalWorkflowId,
      );
      expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
        approveNodeSignal,
        expect.objectContaining({
          nodeId: 'approval-node-1',
          comment: 'Approved by manager',
        }),
      );
    });

    it('signals REJECT to temporal workflow', async () => {
      const result = await service.signalExecution(mockTenantId, 'exec-uuid-1', {
        action: 'REJECT',
        nodeId: 'approval-node-1',
        reason: 'Budget exceeded',
      });

      expect(result).toEqual(mockExecution);
      expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
        rejectNodeSignal,
        expect.objectContaining({
          nodeId: 'approval-node-1',
          reason: 'Budget exceeded',
        }),
      );
    });

    it('handles temporal offline during signal gracefully', async () => {
      mockWorkflowHandle.signal.mockRejectedValueOnce(new Error('Connection lost'));

      const result = await service.signalExecution(mockTenantId, 'exec-uuid-1', {
        action: 'APPROVE',
        nodeId: 'node-1',
      });
      expect(result).toEqual(mockExecution);
    });

    it('throws NotFoundException if execution not found', async () => {
      executionRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.signalExecution(mockTenantId, 'exec-missing', {
          action: 'APPROVE',
          nodeId: 'node-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
