import { Test, TestingModule } from '@nestjs/testing';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AiService } from '../ai/ai.service';
import { PERMISSIONS } from '@saas/shared';
import { PERMISSIONS_KEY } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';
import { SignalExecutionDto } from './dto/signal-execution.dto';

describe('AutomationsController', () => {
  let controller: AutomationsController;
  let service: AutomationsService;

  const mockUser: AuthenticatedUser = {
    id: 'user-123',
    organizationId: 'org-tenant-123',
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
    roles: ['admin'],
    level: 1,
    isOwner: false,
    teamId: null,
    managerId: null,
    permissions: [
      'automation:read',
      'automation:create',
      'automation:update',
      'automation:delete',
      'automation:execute',
      'automation:approve',
    ],
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
      findExecutionsPage: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
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
        {
          provide: AiService,
          useValue: {
            getBudgetStatus: jest
              .fn()
              .mockResolvedValue({ automationAiEmailToCustomers: true }),
          },
        },
      ],
    }).compile();

    controller = module.get<AutomationsController>(AutomationsController);
    service = module.get<AutomationsService>(AutomationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSettings', () => {
    it('returns the organisation AI-email setting', async () => {
      const result = await controller.getSettings(mockUser);
      expect(result).toEqual({ aiEmailToCustomers: true });
    });

    it('requires automation:read', () => {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          AutomationsController.prototype.getSettings,
        ),
      ).toEqual([PERMISSIONS.AUTOMATION_READ]);
    });

    it('is declared before the :id route so it is not captured by it', () => {
      const names = Object.getOwnPropertyNames(AutomationsController.prototype);
      expect(names.indexOf('getSettings')).toBeLessThan(
        names.indexOf('findWorkflowById'),
      );
    });
  });

  describe('findAllWorkflows', () => {
    it('returns all workflows for the authenticated tenant', async () => {
      const result = await controller.findAllWorkflows(mockUser);
      expect(result).toEqual([mockWorkflow]);
      expect(service.findAllWorkflows).toHaveBeenCalledWith(
        mockUser.organizationId,
      );
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
      expect(service.createWorkflow).toHaveBeenCalledWith(
        mockUser.organizationId,
        dto,
      );
    });
  });

  describe('findWorkflowById', () => {
    it('returns a single workflow by id', async () => {
      const result = await controller.findWorkflowById(mockUser, 'wf-123');
      expect(result).toEqual(mockWorkflow);
      expect(service.findWorkflowById).toHaveBeenCalledWith(
        mockUser.organizationId,
        'wf-123',
      );
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
      expect(service.updateWorkflow).toHaveBeenCalledWith(
        mockUser.organizationId,
        'wf-123',
        dto,
        mockUser.id,
      );
    });
  });

  describe('deleteWorkflow', () => {
    it('deletes a workflow', async () => {
      await controller.deleteWorkflow(mockUser, 'wf-123');
      expect(service.deleteWorkflow).toHaveBeenCalledWith(
        mockUser.organizationId,
        'wf-123',
      );
    });
  });

  describe('testRunWorkflow', () => {
    it('triggers a test run with custom payload', async () => {
      const payload = { testInput: 123 };
      const result = await controller.testRunWorkflow(
        mockUser,
        'wf-123',
        payload,
      );
      expect(result).toEqual(mockExecution);
      expect(service.triggerExecution).toHaveBeenCalledWith(
        mockUser.organizationId,
        'wf-123',
        payload,
        mockUser.id,
        { testRun: true },
      );
    });
  });

  it('no longer serves the public webhook route (AutomationWebhookController does)', () => {
    expect(
      (AutomationsController.prototype as unknown as Record<string, unknown>)
        .handleWebhook,
    ).toBeUndefined();
  });

  describe('findExecutions', () => {
    it('returns one page of runs for a workflow', async () => {
      const query = { limit: 10, status: 'FAILED' as const };
      const result = await controller.findExecutions(mockUser, 'wf-123', query);
      expect(result).toEqual({ items: [], nextCursor: null });
      expect(service.findExecutionsPage).toHaveBeenCalledWith(
        mockUser.organizationId,
        'wf-123',
        query,
      );
    });
  });

  describe('findExecutionById', () => {
    it('shows run data to a user who can update automations', async () => {
      const user = {
        ...mockUser,
        permissions: [PERMISSIONS.AUTOMATION_READ, PERMISSIONS.AUTOMATION_UPDATE],
      };
      await controller.findExecutionById(user, 'exec-123');
      expect(service.findExecutionById).toHaveBeenCalledWith(
        mockUser.organizationId,
        'exec-123',
        true,
      );
    });

    it('hides run data from a user who can only read', async () => {
      const user = { ...mockUser, permissions: [PERMISSIONS.AUTOMATION_READ] };
      await controller.findExecutionById(user, 'exec-123');
      expect(service.findExecutionById).toHaveBeenCalledWith(
        mockUser.organizationId,
        'exec-123',
        false,
      );
    });
  });

  describe('signalExecution', () => {
    it('decides as the current user', async () => {
      const dto: SignalExecutionDto = {
        action: 'APPROVE',
        nodeId: 'node-approval-1',
        comment: 'Looks great',
      };
      const result = await controller.signalExecution(
        mockUser,
        'exec-123',
        dto,
      );
      expect(result).toEqual(mockExecution);
      expect(service.signalExecution).toHaveBeenCalledWith(
        mockUser.organizationId,
        'exec-123',
        dto,
        mockUser,
      );
    });
  });
});

describe('AutomationsController secrets', () => {
  const wf: any = {
    id: 'wf-1',
    triggerType: 'WEBHOOK',
    webhookSlug: 'a'.repeat(43),
    triggerConfig: { requireSignature: true, signatureSecret: 's'.repeat(43) },
  };
  const reader: any = {
    id: 'u',
    organizationId: 't',
    permissions: ['automation:read'],
  };
  const editor: any = {
    id: 'u',
    organizationId: 't',
    permissions: ['automation:read', 'automation:update'],
  };
  let controller: AutomationsController;
  let svc: any;

  beforeEach(() => {
    svc = {
      findAllWorkflows: jest.fn().mockResolvedValue([wf]),
      findWorkflowById: jest.fn().mockResolvedValue(wf),
      createWorkflow: jest.fn().mockResolvedValue(wf),
      regenerateWebhookToken: jest.fn().mockResolvedValue(wf),
    };
    controller = new AutomationsController(svc, {} as any);
  });

  it('hides token and secret from a reader on list and one', async () => {
    const [listed] = await controller.findAllWorkflows(reader);
    const one = await controller.findWorkflowById(reader, 'wf-1');
    for (const w of [listed, one]) {
      expect(w.webhookSlug).toBeNull();
      expect(w.triggerConfig.signatureSecret).toBeUndefined();
    }
  });

  it('shows both to an editor on list and one', async () => {
    const [listed] = await controller.findAllWorkflows(editor);
    const one = await controller.findWorkflowById(editor, 'wf-1');
    for (const w of [listed, one]) {
      expect(w.webhookSlug).toBe('a'.repeat(43));
      expect(w.triggerConfig.signatureSecret).toBe('s'.repeat(43));
    }
  });

  it('create answers with the token and secret only for a caller who can update', async () => {
    const creator: any = {
      id: 'u',
      organizationId: 't',
      permissions: ['automation:read', 'automation:create'],
    };
    const dto: any = { name: 'Hook', triggerType: 'WEBHOOK' };
    const made = await controller.createWorkflow(creator, dto);
    expect(made.webhookSlug).toBeNull();
    expect(made.triggerConfig.signatureSecret).toBeUndefined();

    const madeByEditor = await controller.createWorkflow(
      { ...editor, permissions: [...editor.permissions, 'automation:create'] },
      dto,
    );
    expect(madeByEditor.webhookSlug).toBe('a'.repeat(43));
    expect(madeByEditor.triggerConfig.signatureSecret).toBe('s'.repeat(43));
  });

  it('regenerate route requires automation:update and calls the service', async () => {
    const perms = Reflect.getMetadata(
      PERMISSIONS_KEY,
      AutomationsController.prototype.regenerateWebhookToken,
    );
    expect(perms).toContain(PERMISSIONS.AUTOMATION_UPDATE);
    await controller.regenerateWebhookToken(editor, 'wf-1');
    expect(svc.regenerateWebhookToken).toHaveBeenCalledWith('t', 'wf-1', 'u');
  });
});
