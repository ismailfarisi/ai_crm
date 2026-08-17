import { Test, TestingModule } from '@nestjs/testing';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';
import { SignalExecutionDto } from './dto/signal-execution.dto';

describe('AutomationsController', () => {
  let controller: AutomationsController;
  let service: AutomationsService;

  const mockUser: AuthenticatedUser = {
    userId: 'user-123',
    organizationId: 'org-tenant-123',
    role: 'ADMIN',
    permissions: ['automation:read', 'automation:create', 'automation:update', 'automation:delete', 'automation:execute', 'automation:approve'],
    roles: ['admin'],
  };

  const mockWorkflow: any = {
    id: 'wf-123',
    tenantId: 'org-tenant-123',
    name: 'Test Workflow',
    description: 'Testing',
    status: 'DRAFT',
    triggerType: 'MANUAL',
    triggerConfig: {},
    nodes: [],
    edges: [],
    webhookSlug: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockExecution: any = {
    id: 'exec-123',
    tenantId: 'org-tenant-123',
    workflowId: 'wf-123',
    temporalWorkflowId: 'automation-exec-exec-123',
    status: 'RUNNING',
    triggerPayload: {},
    nodeResults: {},
    startedAt: new Date(),
    finishedAt: null,
    errorMessage: null,
  };

  beforeEach(async () => {
    const mockService = {
      findAllWorkflows: jest.fn().mockResolvedValue([mockWorkflow]),
      createWorkflow: jest.fn().mockResolvedValue(mockWorkflow),
      findWorkflowById: jest.fn().mockResolvedValue(mockWorkflow),
      updateWorkflow: jest.fn().mockResolvedValue(mockWorkflow),
      deleteWorkflow: jest.fn().mockResolvedValue(undefined),
      triggerExecution: jest.fn().mockResolvedValue(mockExecution),
      triggerWebhook: jest.fn().mockResolvedValue(mockExecution),
      findExecutionsByWorkflow: jest.fn().mockResolvedValue([mockExecution]),
      findExecutionById: jest.fn().mockResolvedValue(mockExecution),
      signalExecution: jest.fn().mockResolvedValue(mockExecution),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AutomationsController],
      providers: [
        {
          provide: AutomationsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AutomationsController>(AutomationsController);
    service = module.get<AutomationsService>(AutomationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAllWorkflows', () => {
    it('returns all workflows for the authenticated tenant', async () => {
      const result = await controller.findAllWorkflows(mockUser);
      expect(result).toEqual([mockWorkflow]);
      expect(service.findAllWorkflows).toHaveBeenCalledWith(mockUser.organizationId);
    });
  });

  describe('createWorkflow', () => {
    it('creates a new workflow', async () => {
      const dto: CreateAutomationDto = {
        name: 'New Workflow',
        triggerType: 'MANUAL',
        nodes: [],
        edges: [],
      };
      const result = await controller.createWorkflow(mockUser, dto);
      expect(result).toEqual(mockWorkflow);
      expect(service.createWorkflow).toHaveBeenCalledWith(mockUser.organizationId, dto);
    });
  });

  describe('findWorkflowById', () => {
    it('returns a single workflow by id', async () => {
      const result = await controller.findWorkflowById(mockUser, 'wf-123');
      expect(result).toEqual(mockWorkflow);
      expect(service.findWorkflowById).toHaveBeenCalledWith(mockUser.organizationId, 'wf-123');
    });
  });

  describe('updateWorkflow', () => {
    it('updates a workflow', async () => {
      const dto: UpdateAutomationDto = {
        name: 'Updated Name',
        status: 'ACTIVE',
      };
      const result = await controller.updateWorkflow(mockUser, 'wf-123', dto);
      expect(result).toEqual(mockWorkflow);
      expect(service.updateWorkflow).toHaveBeenCalledWith(mockUser.organizationId, 'wf-123', dto);
    });
  });

  describe('deleteWorkflow', () => {
    it('deletes a workflow', async () => {
      await controller.deleteWorkflow(mockUser, 'wf-123');
      expect(service.deleteWorkflow).toHaveBeenCalledWith(mockUser.organizationId, 'wf-123');
    });
  });

  describe('testRunWorkflow', () => {
    it('triggers a test run with custom payload', async () => {
      const payload = { testInput: 123 };
      const result = await controller.testRunWorkflow(mockUser, 'wf-123', payload);
      expect(result).toEqual(mockExecution);
      expect(service.triggerExecution).toHaveBeenCalledWith(mockUser.organizationId, 'wf-123', payload);
    });
  });

  describe('handleWebhook', () => {
    it('triggers execution from public webhook slug', async () => {
      const payload = { event: 'deal_won', amount: 5000 };
      const result = await controller.handleWebhook('wh_sample_slug', payload);
      expect(result).toEqual(mockExecution);
      expect(service.triggerWebhook).toHaveBeenCalledWith('wh_sample_slug', payload);
    });
  });

  describe('findExecutions', () => {
    it('returns executions for a workflow', async () => {
      const result = await controller.findExecutions(mockUser, 'wf-123');
      expect(result).toEqual([mockExecution]);
      expect(service.findExecutionsByWorkflow).toHaveBeenCalledWith(mockUser.organizationId, 'wf-123');
    });
  });

  describe('findExecutionById', () => {
    it('returns a single execution record', async () => {
      const result = await controller.findExecutionById(mockUser, 'exec-123');
      expect(result).toEqual(mockExecution);
      expect(service.findExecutionById).toHaveBeenCalledWith(mockUser.organizationId, 'exec-123');
    });
  });

  describe('signalExecution', () => {
    it('sends approval or rejection signal', async () => {
      const dto: SignalExecutionDto = {
        action: 'APPROVE',
        nodeId: 'node-approval-1',
        comment: 'Looks great',
      };
      const result = await controller.signalExecution(mockUser, 'exec-123', dto);
      expect(result).toEqual(mockExecution);
      expect(service.signalExecution).toHaveBeenCalledWith(mockUser.organizationId, 'exec-123', dto);
    });
  });
});
