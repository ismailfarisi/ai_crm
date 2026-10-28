import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AutomationsService,
  generateWebhookToken,
  redactForReader,
} from './automations.service';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { TemporalService } from '../temporal/temporal.service';
import { AutomationSchedulesService } from './schedules/automation-schedules.service';
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
    sourceEventId: null,
    idempotencyKey: null,
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
      getClient: jest.fn().mockResolvedValue(mockTemporalClient),
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
        {
          provide: AutomationSchedulesService,
          useValue: {
            sync: jest.fn().mockResolvedValue(undefined),
            deleteFor: jest.fn().mockResolvedValue(undefined),
          },
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
          webhookSlug: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
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

      expect(result.webhookSlug).toMatch(/^[A-Za-z0-9_-]{43}$/);
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
        {
          triggerType: 'SCHEDULE',
          triggerConfig: {
            schedule: { frequency: 'hourly', minute: 0, timezone: 'Asia/Dubai' },
          },
        },
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

    it('a run with no actor (webhook, schedule) acts as the owner', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        triggerType: 'WEBHOOK',
        activatedByUserId: 'owner-1',
      });
      await service.triggerExecution(mockTenantId, 'wf-uuid-1', {}, undefined, {
        failOnStartError: true,
      });
      const [input] = mockTemporalClient.workflow.start.mock.calls[0][1].args;
      expect(input.ownerUserId).toBe('owner-1');
      expect(input).not.toHaveProperty('actorUserId');
    });

    it.each(['WEBHOOK', 'SCHEDULE', 'MANUAL', 'CRM_EVENT'] as const)(
      'passes the automation trigger type (%s) to the run',
      async (triggerType) => {
        workflowRepo.findOne.mockResolvedValueOnce({
          ...mockWorkflow,
          triggerType,
        });
        await service.triggerExecution(mockTenantId, 'wf-uuid-1', {
          // The payload never decides it.
          triggerType: 'MANUAL',
        });
        const [input] = mockTemporalClient.workflow.start.mock.calls[0][1].args;
        expect(input.triggerType).toBe(triggerType);
      },
    );

    it('an outbox (event) run also passes the trigger type', async () => {
      workflowRepo.findOne.mockResolvedValueOnce({
        ...mockWorkflow,
        triggerType: 'CRM_EVENT',
      });
      executionRepo.findOne.mockResolvedValueOnce(null);
      await service.triggerExecution(mockTenantId, 'wf-uuid-1', {}, 'event-actor', {
        sourceEventId: '7d1f0b2a-4c1e-4f7a-9a51-2f6f3c1d9e01',
      });
      const [input] = mockTemporalClient.workflow.start.mock.calls[0][1].args;
      expect(input.triggerType).toBe('CRM_EVENT');
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
        temporalService.getClient.mockRejectedValueOnce(
          new Error('Temporal offline'),
        );

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
      temporalService.getClient.mockRejectedValueOnce(
          new Error('Temporal offline'),
        );

      const exec = await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        {},
      );
      expect(exec).toBeDefined();
      expect(exec.id).toBe('exec-uuid-1');
    });
  });

  describe('failOnStartError', () => {
    it('rethrows a failed start and marks the execution FAILED', async () => {
      mockTemporalClient.workflow.start.mockRejectedValueOnce(
        new Error('Temporal offline'),
      );
      executionRepo.save.mockClear();

      await expect(
        service.triggerExecution(mockTenantId, 'wf-uuid-1', {}, undefined, {
          failOnStartError: true,
        }),
      ).rejects.toThrow('Temporal offline');

      const last = executionRepo.save.mock.calls.at(-1)[0];
      expect(last).toMatchObject({
        id: 'exec-uuid-1',
        status: 'FAILED',
        errorMessage: expect.stringContaining('could not start'),
      });
      expect(last.finishedAt).toBeInstanceOf(Date);
      expect(last.temporalWorkflowId).toMatch(/^exec-/);
    });
  });

  describe('with an idempotency key', () => {
    const key = 'webhook:abc';
    const DAY = 24 * 60 * 60 * 1000;

    it('records the key and starts a workflow keyed on the execution', async () => {
      executionRepo.findOne.mockResolvedValueOnce(null);

      const exec = await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        { payload: 1 },
        undefined,
        { idempotencyKey: key, failOnStartError: true },
      );

      expect(executionRepo.findOne).toHaveBeenCalledWith({
        where: { tenantId: mockTenantId, workflowId: 'wf-uuid-1', idempotencyKey: key },
      });
      expect(executionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: key, status: 'RUNNING' }),
      );
      expect(mockTemporalClient.workflow.start).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workflowId: 'automation-exec-exec-uuid-1',
          workflowIdReusePolicy: 'REJECT_DUPLICATE',
        }),
      );
      expect(exec.temporalWorkflowId).toBe('automation-exec-exec-uuid-1');
    });

    it('returns the run already started with the same key, without starting again', async () => {
      const started = {
        ...mockExecution,
        idempotencyKey: key,
        startedAt: new Date(Date.now() - DAY + 60_000),
      };
      executionRepo.findOne.mockResolvedValueOnce(started);
      executionRepo.save.mockClear();

      const exec = await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        {},
        undefined,
        { idempotencyKey: key, failOnStartError: true },
      );

      expect(exec).toBe(started);
      expect(mockTemporalClient.workflow.start).not.toHaveBeenCalled();
      expect(executionRepo.create).not.toHaveBeenCalled();
      expect(executionRepo.save).not.toHaveBeenCalled();
    });

    it('resumes the same execution after a failed start, with its original payload', async () => {
      const failed = {
        ...mockExecution,
        idempotencyKey: key,
        temporalWorkflowId: 'exec-1700000000000',
        status: 'FAILED' as const,
        errorMessage: 'The run could not start: Temporal offline',
        finishedAt: new Date(),
        triggerPayload: { first: true },
        startedAt: new Date(),
      };
      executionRepo.findOne.mockResolvedValueOnce(failed);

      const exec = await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        { second: true },
        undefined,
        { idempotencyKey: key, failOnStartError: true },
      );

      expect(executionRepo.create).not.toHaveBeenCalled();
      const [input] = mockTemporalClient.workflow.start.mock.calls[0][1].args;
      expect(input.executionId).toBe(failed.id);
      expect(input.triggerPayload).toEqual({ first: true });
      expect(exec).toMatchObject({
        id: failed.id,
        status: 'RUNNING',
        errorMessage: null,
        finishedAt: null,
        temporalWorkflowId: `automation-exec-${failed.id}`,
      });
    });

    it('treats an already-started workflow as started', async () => {
      executionRepo.findOne.mockResolvedValueOnce(null);
      mockTemporalClient.workflow.start.mockRejectedValueOnce(
        new WorkflowExecutionAlreadyStartedError(
          'already started',
          'automation-exec-exec-uuid-1',
          'dynamicDagWorkflow',
        ),
      );

      const exec = await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        {},
        undefined,
        { idempotencyKey: key, failOnStartError: true },
      );

      expect(exec.status).toBe('RUNNING');
      expect(exec.temporalWorkflowId).toBe('automation-exec-exec-uuid-1');
    });

    it('forgets a key after 24 hours and starts a new run', async () => {
      const old = {
        ...mockExecution,
        id: 'exec-old',
        idempotencyKey: key,
        startedAt: new Date(Date.now() - DAY - 60_000),
      };
      executionRepo.findOne.mockResolvedValueOnce(old);
      executionRepo.update = jest.fn().mockResolvedValue({ affected: 1 });

      const exec = await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        {},
        undefined,
        { idempotencyKey: key, failOnStartError: true },
      );

      expect(executionRepo.update).toHaveBeenCalledWith(
        { id: 'exec-old', idempotencyKey: key },
        { idempotencyKey: null },
      );
      expect(executionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: key }),
      );
      expect(exec.id).toBe('exec-uuid-1');
    });

    it('falls back to the row a concurrent request inserted first', async () => {
      const raced = {
        ...mockExecution,
        idempotencyKey: key,
        startedAt: new Date(),
      };
      executionRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(raced);
      executionRepo.save.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'uq_automation_executions_idempotency_key',
        }),
      );

      const exec = await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        {},
        undefined,
        { idempotencyKey: key, failOnStartError: true },
      );

      expect(exec).toBe(raced);
      expect(mockTemporalClient.workflow.start).not.toHaveBeenCalled();
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

describe('webhook tokens, signature secrets and schedules', () => {
  let service: AutomationsService;
  let workflowRepo: any;
  let schedules: { sync: jest.Mock; deleteFor: jest.Mock };
  const tenantId = 'tenant-uuid-1';
  const base = (over: Record<string, any> = {}): any => ({
    id: 'wf-1',
    tenantId,
    name: 'W',
    description: null,
    status: 'DRAFT',
    triggerType: 'WEBHOOK',
    triggerConfig: {},
    nodes: [],
    edges: [],
    webhookSlug: 'a'.repeat(43),
    activatedByUserId: null,
    version: 1,
    ...over,
  });

  beforeEach(async () => {
    schedules = {
      sync: jest.fn().mockResolvedValue(undefined),
      deleteFor: jest.fn().mockResolvedValue(undefined),
    };
    workflowRepo = {
      create: jest
        .fn()
        .mockImplementation((dto) => ({ ...dto, id: 'wf-1', version: 1 })),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
      findOne: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationsService,
        {
          provide: getRepositoryToken(AutomationWorkflow),
          useValue: workflowRepo,
        },
        { provide: getRepositoryToken(AutomationExecution), useValue: {} },
        { provide: TemporalService, useValue: { getClient: jest.fn() } },
        { provide: AutomationSchedulesService, useValue: schedules },
      ],
    }).compile();
    service = module.get(AutomationsService);
  });

  const update = (existing: any, payload: any) => {
    workflowRepo.findOne.mockResolvedValueOnce(existing);
    return service.updateWorkflow(tenantId, 'wf-1', payload, 'u1');
  };

  it('generateWebhookToken makes 43-char base64url tokens that differ each time', () => {
    const a = generateWebhookToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookToken()).not.toBe(a);
  });

  it('createWorkflow gives a WEBHOOK workflow a strong token', async () => {
    const wf = await service.createWorkflow(tenantId, {
      name: 'W',
      triggerType: 'WEBHOOK',
    });
    expect(wf.webhookSlug).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('replaces an old-format slug on the next save but keeps a strong one', async () => {
    const old = await update(base({ webhookSlug: 'wh_123_abcde' }), {
      name: 'x',
    });
    expect(old.webhookSlug).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const strong = await update(base(), { name: 'x' });
    expect(strong.webhookSlug).toBe('a'.repeat(43));
  });

  describe('regenerateWebhookToken', () => {
    it('changes the token', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(base());
      const wf = await service.regenerateWebhookToken(tenantId, 'wf-1', 'u1');
      expect(wf.webhookSlug).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(wf.webhookSlug).not.toBe('a'.repeat(43));
      expect(workflowRepo.save).toHaveBeenCalled();
    });

    it('rejects a non-webhook automation', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(
        base({ triggerType: 'MANUAL', webhookSlug: null }),
      );
      await expect(
        service.regenerateWebhookToken(tenantId, 'wf-1', 'u1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('schedule validation', () => {
    const sched = { frequency: 'daily', time: '09:00', timezone: 'Asia/Dubai' };
    const scheduled = () => base({ triggerType: 'SCHEDULE', webhookSlug: null });

    it('refuses to activate a SCHEDULE automation with no schedule', async () => {
      await expect(update(scheduled(), { status: 'ACTIVE' })).rejects.toThrow(
        new BadRequestException('Choose when this automation runs'),
      );
    });

    it('allows a draft without a schedule', async () => {
      const wf = await update(scheduled(), { name: 'x' });
      expect(wf.name).toBe('x');
    });

    it('rejects an invalid schedule with the validation message', async () => {
      await expect(
        update(scheduled(), {
          triggerConfig: {
            schedule: { frequency: 'daily', timezone: 'Asia/Dubai' },
          },
        }),
      ).rejects.toThrow(/time is required/);
    });

    it('saves a valid schedule and activates', async () => {
      const wf = await update(scheduled(), {
        status: 'ACTIVE',
        triggerConfig: { schedule: sched },
      });
      expect(wf.triggerConfig.schedule).toEqual(sched);
      expect(wf.activatedByUserId).toBe('u1');
    });
  });

  describe('schedule lifecycle', () => {
    const sched = { frequency: 'daily', time: '09:00', timezone: 'Asia/Dubai' };
    const scheduled = (over: Record<string, any> = {}) =>
      base({
        triggerType: 'SCHEDULE',
        webhookSlug: null,
        triggerConfig: { schedule: sched },
        ...over,
      });
    const unavailable = () =>
      new ServiceUnavailableException(
        "Couldn't update the automation's schedule. Try again in a minute.",
      );

    it('syncs the schedule after validation and before saving', async () => {
      const order: string[] = [];
      schedules.sync.mockImplementation(async (wf: any) => {
        order.push(`sync:${wf.status}`);
      });
      workflowRepo.save.mockImplementation(async (e: any) => {
        order.push('save');
        return e;
      });

      await update(scheduled(), { status: 'ACTIVE' });

      expect(order).toEqual(['sync:ACTIVE', 'save']);
      expect(schedules.sync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'wf-1',
          status: 'ACTIVE',
          triggerType: 'SCHEDULE',
          triggerConfig: { schedule: sched },
        }),
        { hadSchedule: false },
      );
    });

    it('tells sync the automation had a schedule when it was active on a schedule', async () => {
      await update(scheduled({ status: 'ACTIVE' }), { status: 'PAUSED' });
      expect(schedules.sync).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PAUSED' }),
        { hadSchedule: true },
      );
    });

    it('does not sync when validation fails', async () => {
      await expect(
        update(scheduled({ triggerConfig: {} }), { status: 'ACTIVE' }),
      ).rejects.toThrow(BadRequestException);
      expect(schedules.sync).not.toHaveBeenCalled();
    });

    it('Temporal down while saving an active schedule: the save fails and nothing is stored', async () => {
      schedules.sync.mockRejectedValueOnce(unavailable());

      await expect(
        update(scheduled({ status: 'ACTIVE' }), {
          triggerConfig: {
            schedule: { frequency: 'hourly', minute: 5, timezone: 'UTC' },
          },
        }),
      ).rejects.toThrow(unavailable());

      // The stored row is only ever changed by save(), which never ran.
      expect(workflowRepo.save).not.toHaveBeenCalled();
    });

    it('a new automation is a draft, so create asks for no schedule', async () => {
      await service.createWorkflow(tenantId, {
        name: 'S',
        triggerType: 'SCHEDULE',
        triggerConfig: { schedule: sched },
      } as any);
      expect(schedules.sync).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'DRAFT' }),
        { hadSchedule: false },
      );
      expect(workflowRepo.save).toHaveBeenCalled();
    });

    it('deleting removes the schedule before the row', async () => {
      const order: string[] = [];
      schedules.deleteFor.mockImplementation(async () => {
        order.push('schedule');
      });
      workflowRepo.remove.mockImplementation(async () => {
        order.push('row');
      });
      workflowRepo.findOne.mockResolvedValueOnce(scheduled({ status: 'ACTIVE' }));

      await service.deleteWorkflow(tenantId, 'wf-1');

      expect(order).toEqual(['schedule', 'row']);
    });

    it('deleting keeps the row when the schedule cannot be removed', async () => {
      schedules.deleteFor.mockRejectedValueOnce(unavailable());
      workflowRepo.findOne.mockResolvedValueOnce(scheduled({ status: 'ACTIVE' }));

      await expect(service.deleteWorkflow(tenantId, 'wf-1')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(workflowRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('webhook trigger config', () => {
    it('rejects an http or malformed redirect URL and accepts https', async () => {
      await expect(
        update(base(), {
          triggerConfig: { redirectUrl: 'http://example.com/thanks' },
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        update(base(), { triggerConfig: { redirectUrl: 'not a url' } }),
      ).rejects.toThrow(BadRequestException);
      const wf = await update(base(), {
        triggerConfig: { redirectUrl: 'https://example.com/thanks' },
      });
      expect(wf.triggerConfig.redirectUrl).toBe('https://example.com/thanks');
    });

    it('generates a secret when a signature is required, keeping it on later saves', async () => {
      const wf = await update(base(), {
        triggerConfig: { requireSignature: true },
      });
      const secret = wf.triggerConfig.signatureSecret;
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const again = await update(wf, {
        triggerConfig: { requireSignature: true },
      });
      expect(again.triggerConfig.signatureSecret).toBe(secret);
    });

    it('rotates the secret on regenerateSignature', async () => {
      const wf = await update(base(), {
        triggerConfig: { requireSignature: true },
      });
      const secret = wf.triggerConfig.signatureSecret;
      const rotated = await update(wf, { regenerateSignature: true });
      expect(rotated.triggerConfig.requireSignature).toBe(true);
      expect(rotated.triggerConfig.signatureSecret).toMatch(
        /^[A-Za-z0-9_-]{43}$/,
      );
      expect(rotated.triggerConfig.signatureSecret).not.toBe(secret);
    });

    it('removes the secret when the signature is switched off', async () => {
      const wf = await update(base(), {
        triggerConfig: { requireSignature: true },
      });
      const off = await update(wf, {
        triggerConfig: {
          requireSignature: false,
          signatureSecret: wf.triggerConfig.signatureSecret,
        },
      });
      expect(off.triggerConfig.signatureSecret).toBeUndefined();
    });

    it('does not mutate the payload it was given', async () => {
      const triggerConfig = { requireSignature: true };
      await update(base(), { triggerConfig });
      expect(triggerConfig).toEqual({ requireSignature: true });
    });
  });

  describe('redactForReader', () => {
    const wf: any = base({
      triggerConfig: {
        requireSignature: true,
        signatureSecret: 's'.repeat(43),
        redirectUrl: 'https://x.test',
      },
    });

    it('hides the token and secret from users who cannot update, without mutating', () => {
      const out = redactForReader(wf, ['automation:read']);
      expect(out.webhookSlug).toBeNull();
      expect(out.triggerConfig.signatureSecret).toBeUndefined();
      expect(out.triggerConfig.requireSignature).toBe(true);
      expect(out.triggerConfig.redirectUrl).toBe('https://x.test');
      expect(wf.webhookSlug).toBe('a'.repeat(43));
      expect(wf.triggerConfig.signatureSecret).toBe('s'.repeat(43));
    });

    it('leaves both for users who can update', () => {
      const out = redactForReader(wf, ['automation:read', 'automation:update']);
      expect(out.webhookSlug).toBe('a'.repeat(43));
      expect(out.triggerConfig.signatureSecret).toBe('s'.repeat(43));
    });
  });
});
