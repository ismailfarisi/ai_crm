import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { TemporalService } from '../temporal/temporal.service';
import {
  approveNodeSignal,
  getExecutionStateQuery,
  rejectNodeSignal,
} from './workflows/interfaces';

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
    activatedByUserId: null,
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
      query: jest.fn().mockResolvedValue({
        status: 'RUNNING',
        nodeResults: {},
        pendingApprovals: {},
        startedAt: '2026-10-08T12:00:00.000Z',
        finishedAt: null,
        errorMessage: null,
      }),
    };

    mockTemporalClient = {
      workflow: {
        start: jest
          .fn()
          .mockResolvedValue({ workflowId: 'automation-exec-exec-uuid-1' }),
        getHandle: jest.fn().mockReturnValue(mockWorkflowHandle),
      },
    };

    workflowRepo = {
      create: jest
        .fn()
        .mockImplementation((dto) => ({ ...dto, id: 'wf-uuid-1', version: 1 })),
      save: jest
        .fn()
        .mockImplementation((entity) =>
          Promise.resolve({ ...entity, id: entity.id || 'wf-uuid-1' }),
        ),
      find: jest.fn().mockResolvedValue([mockWorkflow]),
      findOne: jest.fn().mockResolvedValue(mockWorkflow),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      remove: jest.fn().mockResolvedValue(mockWorkflow),
    };

    executionRepo = {
      create: jest
        .fn()
        .mockImplementation((dto) => ({ ...dto, id: 'exec-uuid-1' })),
      save: jest
        .fn()
        .mockImplementation((entity) =>
          Promise.resolve({ ...entity, id: entity.id || 'exec-uuid-1' }),
        ),
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
      await expect(
        service.findWorkflowById(mockTenantId, 'wf-missing'),
      ).rejects.toThrow(NotFoundException);
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
      }, 'u1');

      expect(result.name).toBe('Updated Name');
      expect(result.description).toBe('New Description');
      expect(result.status).toBe('ACTIVE');
      expect(result.version).toBe(2);
      expect(workflowRepo.save).toHaveBeenCalled();
    });

    it('generates webhookSlug if updated to WEBHOOK and slug was missing', async () => {
      const existing = {
        ...mockWorkflow,
        webhookSlug: null,
        triggerType: 'MANUAL' as const,
      };
      workflowRepo.findOne.mockResolvedValueOnce(existing);

      const result = await service.updateWorkflow(mockTenantId, 'wf-uuid-1', {
        triggerType: 'WEBHOOK',
      }, 'u1');

      expect(result.webhookSlug).toMatch(/^wh_\d+_[a-z0-9]+$/);
    });

    it('throws NotFoundException if workflow does not exist', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.updateWorkflow(mockTenantId, 'non-existent', { name: 'Test' }, 'u1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ownership and trigger-event sync', () => {
    const crmNode = (event: string) => ({
      id: 'trg',
      type: 'crmEventTrigger' as const,
      position: { x: 0, y: 0 },
      data: { label: 'CRM', config: { event } },
    });

    it('sets activatedByUserId when status changes to ACTIVE', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({ ...mockWorkflow });
      const result = await service.updateWorkflow(
        mockTenantId,
        'wf-uuid-1',
        { status: 'ACTIVE' },
        'u1',
      );
      expect(result.activatedByUserId).toBe('u1');
    });

    it('saving nodes on an ACTIVE workflow makes the saver the owner', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        status: 'ACTIVE',
        activatedByUserId: 'u1',
      });
      const result = await service.updateWorkflow(
        mockTenantId,
        'wf-uuid-1',
        { nodes: [...mockWorkflow.nodes] },
        'u2',
      );
      expect(result.activatedByUserId).toBe('u2');
    });

    it('saving only name on an ACTIVE workflow keeps the owner', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        status: 'ACTIVE',
        activatedByUserId: 'u1',
      });
      const result = await service.updateWorkflow(
        mockTenantId,
        'wf-uuid-1',
        { name: 'Renamed' },
        'u2',
      );
      expect(result.activatedByUserId).toBe('u1');
    });

    it("copies the CRM trigger node's event into triggerConfig on save", async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        triggerType: 'CRM_EVENT',
        triggerConfig: {},
      });
      const result = await service.updateWorkflow(
        mockTenantId,
        'wf-uuid-1',
        { nodes: [crmNode('invoice.overdue')] },
        'u1',
      );
      expect(result.triggerConfig.event).toBe('invoice.overdue');
    });

    it("copies the CRM trigger node's event into triggerConfig on create", async () => {
      const result = await service.createWorkflow(mockTenantId, {
        name: 'x',
        triggerType: 'CRM_EVENT',
        nodes: [crmNode('invoice.overdue')],
        edges: [],
      } as any);
      expect(result.triggerConfig.event).toBe('invoice.overdue');
    });

    it('rejects activating a CRM_EVENT workflow without an event', async () => {
      const run = () => {
        workflowRepo.findOne.mockResolvedValueOnce({
          ...mockWorkflow,
          triggerType: 'CRM_EVENT',
          triggerConfig: {},
        });
        return service.updateWorkflow(
          mockTenantId,
          'wf-uuid-1',
          { status: 'ACTIVE' },
          'u1',
        );
      };
      await expect(run()).rejects.toThrow(BadRequestException);
      await expect(run()).rejects.toThrow(
        'Choose the CRM event that starts this automation',
      );
    });

    it('clearing the trigger node event on save removes triggerConfig.event', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        triggerType: 'CRM_EVENT',
        triggerConfig: { event: 'invoice.overdue', other: 1 },
        nodes: [crmNode('invoice.overdue')],
      });
      const result = await service.updateWorkflow(
        mockTenantId,
        'wf-uuid-1',
        { nodes: [crmNode('')] },
        'u1',
      );
      expect(result.triggerConfig).toEqual({ other: 1 });
    });

    it('deleting the trigger node removes triggerConfig.event', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        triggerType: 'CRM_EVENT',
        triggerConfig: { event: 'invoice.overdue' },
        nodes: [crmNode('invoice.overdue')],
      });
      const result = await service.updateWorkflow(
        mockTenantId,
        'wf-uuid-1',
        { nodes: [] },
        'u1',
      );
      expect(result.triggerConfig).not.toHaveProperty('event');
    });

    it('a trigger node whose event is not text removes triggerConfig.event', async () => {
      const result = await service.createWorkflow(mockTenantId, {
        name: 'x',
        triggerType: 'CRM_EVENT',
        triggerConfig: { event: 'quote.accepted' },
        nodes: [
          {
            ...crmNode('x'),
            data: { label: 'CRM', config: { event: 42 } },
          },
        ],
        edges: [],
      } as any);
      expect(result.triggerConfig).not.toHaveProperty('event');
    });

    it('activating after the event was cleared is rejected', async () => {
      const saved = {
        ...mockWorkflow,
        triggerType: 'CRM_EVENT',
        triggerConfig: { event: 'invoice.overdue' },
        nodes: [crmNode('invoice.overdue')],
      };
      workflowRepo.findOne.mockResolvedValueOnce(saved);
      const cleared = await service.updateWorkflow(
        mockTenantId,
        'wf-uuid-1',
        { nodes: [crmNode('')] },
        'u1',
      );
      workflowRepo.findOne.mockResolvedValueOnce(cleared);
      await expect(
        service.updateWorkflow(
          mockTenantId,
          'wf-uuid-1',
          { status: 'ACTIVE' },
          'u1',
        ),
      ).rejects.toThrow('Choose the CRM event that starts this automation');
    });

    it('changing the trigger type on an ACTIVE workflow makes the saver the owner', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        status: 'ACTIVE',
        activatedByUserId: 'u1',
      });
      const result = await service.updateWorkflow(
        mockTenantId,
        'wf-uuid-1',
        { triggerType: 'SCHEDULE' },
        'u2',
      );
      expect(result.activatedByUserId).toBe('u2');
    });

    it('test run passes the clicking user as owner', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        activatedByUserId: 'owner-1',
      });
      await service.triggerExecution(mockTenantId, 'wf-uuid-1', {}, 'clicker', {
        testRun: true,
      });
      expect(mockTemporalClient.workflow.start).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          args: [
            expect.objectContaining({
              ownerUserId: 'clicker',
              workflowName: 'Sample Workflow',
            }),
          ],
        }),
      );
    });

    it('a bridge run with an actor but no event id still acts as the owner', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        activatedByUserId: 'owner-1',
      });
      await service.triggerExecution(mockTenantId, 'wf-uuid-1', {}, 'event-actor');
      expect(mockTemporalClient.workflow.start).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          args: [
            expect.objectContaining({
              ownerUserId: 'owner-1',
              actorUserId: 'event-actor',
            }),
          ],
        }),
      );
    });

    it('a webhook run acts as the owner', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        triggerType: 'WEBHOOK',
        webhookSlug: 'wh_x',
        activatedByUserId: 'owner-1',
      });
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        activatedByUserId: 'owner-1',
      });
      await service.triggerWebhook('wh_x', {});
      expect(mockTemporalClient.workflow.start).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          args: [expect.objectContaining({ ownerUserId: 'owner-1' })],
        }),
      );
    });

    it('event-triggered run passes activatedByUserId as owner', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        activatedByUserId: 'owner-1',
      });
      executionRepo.findOne.mockResolvedValueOnce(null);
      await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        {},
        'event-actor',
        { sourceEventId: '7d1f0b2a-4c1e-4f7a-9a51-2f6f3c1d9e01' },
      );
      expect(mockTemporalClient.workflow.start).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          args: [
            expect.objectContaining({
              ownerUserId: 'owner-1',
              actorUserId: 'event-actor',
              workflowName: 'Sample Workflow',
            }),
          ],
        }),
      );
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
      await expect(
        service.deleteWorkflow(mockTenantId, 'wf-missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('triggerExecution', () => {
    it('creates execution record and starts temporal workflow', async () => {
      const payload = { amount: 500, customer: 'Acme' };
      const exec = await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        payload,
      );

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

    describe('with a source event id (outbox delivery)', () => {
      const eventId = '7d1f0b2a-4c1e-4f7a-9a51-2f6f3c1d9e01';

      it('keys the Temporal workflow on the event and records the event on the execution', async () => {
        executionRepo.findOne.mockResolvedValueOnce(null);

        await service.triggerExecution(mockTenantId, 'wf-uuid-1', {}, undefined, {
          sourceEventId: eventId,
        });

        expect(executionRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ sourceEventId: eventId }),
        );
        expect(mockTemporalClient.workflow.start).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            workflowId: `automation-${mockWorkflow.id}-${eventId}`,
            workflowIdReusePolicy: 'REJECT_DUPLICATE',
          }),
        );
      });

      it('returns the existing execution without starting again on redelivery', async () => {
        const started = {
          ...mockExecution,
          sourceEventId: eventId,
          temporalWorkflowId: `automation-${mockWorkflow.id}-${eventId}`,
        };
        executionRepo.findOne.mockResolvedValueOnce(started);
        mockTemporalClient.workflow.start.mockClear();
        executionRepo.save.mockClear();

        const exec = await service.triggerExecution(
          mockTenantId,
          'wf-uuid-1',
          {},
          undefined,
          { sourceEventId: eventId },
        );

        expect(exec).toBe(started);
        expect(mockTemporalClient.workflow.start).not.toHaveBeenCalled();
        expect(executionRepo.save).not.toHaveBeenCalled();
      });

      it('retries the start for an execution recorded by an earlier failed delivery', async () => {
        const pending = {
          ...mockExecution,
          sourceEventId: eventId,
          temporalWorkflowId: 'exec-1700000000000',
        };
        executionRepo.findOne.mockResolvedValueOnce(pending);
        executionRepo.save.mockClear();

        await service.triggerExecution(mockTenantId, 'wf-uuid-1', {}, undefined, {
          sourceEventId: eventId,
        });

        expect(executionRepo.save).toHaveBeenCalledTimes(1);
        expect(executionRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            id: pending.id,
            temporalWorkflowId: `automation-${mockWorkflow.id}-${eventId}`,
          }),
        );
      });

      it('treats an already-started workflow as started', async () => {
        executionRepo.findOne.mockResolvedValueOnce(null);
        mockTemporalClient.workflow.start.mockRejectedValueOnce(
          new WorkflowExecutionAlreadyStartedError(
            'already started',
            `automation-${mockWorkflow.id}-${eventId}`,
            'dynamicDagWorkflow',
          ),
        );

        const exec = await service.triggerExecution(
          mockTenantId,
          'wf-uuid-1',
          {},
          undefined,
          { sourceEventId: eventId },
        );

        expect(exec.temporalWorkflowId).toBe(
          `automation-${mockWorkflow.id}-${eventId}`,
        );
      });

      it('rethrows a failed start so the outbox retries the event', async () => {
        executionRepo.findOne.mockResolvedValueOnce(null);
        temporalService.getClient.mockImplementationOnce(() => {
          throw new Error('Temporal offline');
        });

        await expect(
          service.triggerExecution(mockTenantId, 'wf-uuid-1', {}, undefined, {
            sourceEventId: eventId,
          }),
        ).rejects.toThrow('Temporal offline');
      });

      it('falls back to the row another delivery inserted first', async () => {
        const raced = {
          ...mockExecution,
          sourceEventId: eventId,
          temporalWorkflowId: `automation-${mockWorkflow.id}-${eventId}`,
        };
        executionRepo.findOne
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(raced);
        executionRepo.save.mockRejectedValueOnce(
          Object.assign(new Error('duplicate key'), {
            code: '23505',
            constraint: 'uq_automation_executions_source_event',
          }),
        );
        mockTemporalClient.workflow.start.mockClear();

        const exec = await service.triggerExecution(
          mockTenantId,
          'wf-uuid-1',
          {},
          undefined,
          { sourceEventId: eventId },
        );

        expect(exec).toBe(raced);
        expect(mockTemporalClient.workflow.start).not.toHaveBeenCalled();
      });
    });

    it('handles temporal offline gracefully without throwing', async () => {
      temporalService.getClient.mockImplementationOnce(() => {
        throw new Error('Temporal offline');
      });

      const exec = await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        {},
      );
      expect(exec).toBeDefined();
      expect(exec.id).toBe('exec-uuid-1');
    });
  });

  describe('triggerWebhook', () => {
    it('finds workflow by slug and triggers execution', async () => {
      const webhookWf = {
        ...mockWorkflow,
        webhookSlug: 'wh_test_slug',
        status: 'ACTIVE' as const,
      };
      workflowRepo.findOne.mockResolvedValueOnce(webhookWf);

      const exec = await service.triggerWebhook('wh_test_slug', {
        event: 'user_created',
      });
      expect(exec).toBeDefined();
      expect(workflowRepo.findOne).toHaveBeenCalledWith({
        where: { webhookSlug: 'wh_test_slug' },
      });
      expect(mockTemporalClient.workflow.start).toHaveBeenCalled();
    });

    it('throws NotFoundException if webhook slug does not exist', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.triggerWebhook('wh_unknown', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findExecutionsByWorkflow', () => {
    it('returns executions list for workflow', async () => {
      const execs = await service.findExecutionsByWorkflow(
        mockTenantId,
        'wf-uuid-1',
      );
      expect(execs).toEqual([mockExecution]);
      expect(executionRepo.find).toHaveBeenCalledWith({
        where: { tenantId: mockTenantId, workflowId: 'wf-uuid-1' },
        order: { startedAt: 'DESC' },
      });
    });

    it('throws NotFoundException if workflow does not exist', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.findExecutionsByWorkflow(mockTenantId, 'wf-unknown'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findExecutionById', () => {
    it('returns execution when found', async () => {
      const result = await service.findExecutionById(
        mockTenantId,
        'exec-uuid-1',
      );
      expect(result).toEqual(mockExecution);
      expect(executionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'exec-uuid-1', tenantId: mockTenantId },
      });
    });

    it('returns live Temporal node results, including pending approval details', async () => {
      const liveState = {
        status: 'WAITING_APPROVAL' as const,
        nodeResults: {
          'agent-node': {
            status: 'WAITING' as const,
            startedAt: '2026-10-08T12:00:00.000Z',
            output: {
              pendingAction: {
                tool: 'quote.create',
                preview: { summary: 'Create quote QT-1' },
              },
            },
          },
        },
        pendingApprovals: {},
        finishedAt: null,
        errorMessage: null,
      };
      mockWorkflowHandle.query.mockResolvedValueOnce(liveState);

      const result = await service.findExecutionById(
        mockTenantId,
        'exec-uuid-1',
      );

      expect(mockWorkflowHandle.query).toHaveBeenCalledWith(
        getExecutionStateQuery,
      );
      expect(result.status).toBe('WAITING_APPROVAL');
      expect(result.nodeResults['agent-node'].output.pendingAction).toEqual(
        liveState.nodeResults['agent-node'].output.pendingAction,
      );
    });

    it('throws NotFoundException when execution does not exist', async () => {
      executionRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.findExecutionById(mockTenantId, 'exec-missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('signalExecution', () => {
    it('signals APPROVE to temporal workflow', async () => {
      mockWorkflowHandle.query.mockResolvedValueOnce({
        status: 'WAITING_APPROVAL',
        nodeResults: {},
        pendingApprovals: {
          'approval-node-1': { nodeId: 'approval-node-1' },
        },
        startedAt: '2026-10-08T12:00:00.000Z',
        finishedAt: null,
        errorMessage: null,
      });
      const result = await service.signalExecution(
        mockTenantId,
        'exec-uuid-1',
        {
          action: 'APPROVE',
          nodeId: 'approval-node-1',
          comment: 'Approved by manager',
        },
      );

      expect(result).toEqual({
        ...mockExecution,
        status: 'WAITING_APPROVAL',
      });
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
      mockWorkflowHandle.query.mockResolvedValueOnce({
        status: 'WAITING_APPROVAL',
        nodeResults: {},
        pendingApprovals: {
          'approval-node-1': { nodeId: 'approval-node-1' },
        },
        startedAt: '2026-10-08T12:00:00.000Z',
        finishedAt: null,
        errorMessage: null,
      });
      const result = await service.signalExecution(
        mockTenantId,
        'exec-uuid-1',
        {
          action: 'REJECT',
          nodeId: 'approval-node-1',
          reason: 'Budget exceeded',
        },
      );

      expect(result).toEqual({
        ...mockExecution,
        status: 'WAITING_APPROVAL',
      });
      expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
        rejectNodeSignal,
        expect.objectContaining({
          nodeId: 'approval-node-1',
          reason: 'Budget exceeded',
        }),
      );
    });

    it('surfaces when Temporal cannot deliver a signal', async () => {
      mockWorkflowHandle.query.mockResolvedValueOnce({
        status: 'WAITING_APPROVAL',
        nodeResults: {},
        pendingApprovals: {
          'node-1': { nodeId: 'node-1' },
        },
        startedAt: '2026-10-08T12:00:00.000Z',
        finishedAt: null,
        errorMessage: null,
      });
      mockWorkflowHandle.signal.mockRejectedValueOnce(
        new Error('Connection lost'),
      );

      await expect(
        service.signalExecution(mockTenantId, 'exec-uuid-1', {
          action: 'APPROVE',
          nodeId: 'node-1',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('rejects decisions for nodes without a pending approval', async () => {
      await expect(
        service.signalExecution(mockTenantId, 'exec-uuid-1', {
          action: 'APPROVE',
          nodeId: 'future-node',
        }),
      ).rejects.toThrow(BadRequestException);
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
