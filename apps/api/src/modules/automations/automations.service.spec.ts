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
import { PERMISSIONS } from '@saas/shared';
import { AutomationWorkflow } from './entities/automation-workflow.entity';
import { AutomationExecution } from './entities/automation-execution.entity';
import { TemporalService } from '../temporal/temporal.service';
import { AutomationSchedulesService } from './schedules/automation-schedules.service';
import { AutomationApprovalsService } from './approvals/automation-approvals.service';

describe('AutomationsService', () => {
  let service: AutomationsService;
  let workflowRepo: any;
  let executionRepo: any;
  let temporalService: any;
  let mockTemporalClient: any;
  let mockWorkflowHandle: any;
  let approvals: { decideByNode: jest.Mock; findPendingForExecution: jest.Mock };

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
    triggerSource: null,
    temporalWorkflowId: 'automation-exec-exec-uuid-1',
    status: 'RUNNING',
    triggerPayload: { key: 'value' },
    nodeResults: {},
    startedAt: new Date(),
    finishedAt: null,
    errorMessage: null,
  };

  beforeEach(async () => {
    approvals = {
      decideByNode: jest.fn().mockResolvedValue({ id: 'appr-1' }),
      findPendingForExecution: jest.fn().mockResolvedValue([]),
    };
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
        { provide: AutomationApprovalsService, useValue: approvals },
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

      it('marks the row FAILED before rethrowing, so a dead-lettered event does not leave it Running', async () => {
        executionRepo.findOne.mockResolvedValueOnce(null);
        mockTemporalClient.workflow.start.mockRejectedValueOnce(
          new Error('connect ECONNREFUSED 10.0.0.5:7233'),
        );
        executionRepo.save.mockClear();

        await expect(
          service.triggerExecution(mockTenantId, 'wf-uuid-1', {}, undefined, {
            sourceEventId: eventId,
          }),
        ).rejects.toThrow('ECONNREFUSED');

        const saved = executionRepo.save.mock.calls.at(-1)[0];
        expect(saved).toMatchObject({
          status: 'FAILED',
          errorMessage: "Couldn't start the run",
        });
        expect(saved.finishedAt).toBeInstanceOf(Date);
        // The placeholder stays, so the outbox retry starts this row again.
        expect(saved.temporalWorkflowId).toMatch(/^exec-/);
      });

      it('a retry that starts a run marked FAILED puts it back to Running', async () => {
        const failed = {
          ...mockExecution,
          sourceEventId: eventId,
          temporalWorkflowId: 'exec-1700000000000',
          status: 'FAILED' as const,
          errorMessage: "Couldn't start the run",
          finishedAt: new Date(),
        };
        executionRepo.findOne.mockResolvedValueOnce(failed);
        executionRepo.save.mockClear();

        const exec = await service.triggerExecution(
          mockTenantId,
          'wf-uuid-1',
          {},
          undefined,
          { sourceEventId: eventId },
        );

        expect(exec).toMatchObject({
          status: 'RUNNING',
          errorMessage: null,
          finishedAt: null,
          temporalWorkflowId: `automation-${mockWorkflow.id}-${eventId}`,
        });
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
        errorMessage: "Couldn't start the run",
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
        errorMessage: "Couldn't start the run",
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

  describe('findExecutionsPage', () => {
    const idFor = (n: number) =>
      `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const rowAt = (n: number) => ({
      id: idFor(n),
      workflowId: 'wf-uuid-1',
      status: 'COMPLETED',
      triggerSource: n % 2 ? 'webhook' : null,
      startedAt: new Date(Date.UTC(2026, 9, 1, 12, 0, 0) - n * 1000),
      finishedAt: null,
      errorMessage: null,
    });
    let qb: any;

    beforeEach(() => {
      qb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      executionRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);
    });

    it('returns 25 by default, with a cursor to the rest', async () => {
      qb.getMany.mockResolvedValueOnce(
        Array.from({ length: 26 }, (_, i) => rowAt(i)),
      );
      const first = await service.findExecutionsPage(
        mockTenantId,
        'wf-uuid-1',
        {},
      );
      expect(qb.limit).toHaveBeenCalledWith(26);
      expect(first.items).toHaveLength(25);
      expect(first.nextCursor).toBe(
        Buffer.from(`${rowAt(24).startedAt.toISOString()}|${idFor(24)}`).toString(
          'base64url',
        ),
      );
      expect(qb.andWhere).not.toHaveBeenCalled();

      qb.getMany.mockResolvedValueOnce([rowAt(25)]);
      const second = await service.findExecutionsPage(
        mockTenantId,
        'wf-uuid-1',
        { cursor: first.nextCursor! },
      );
      expect(second.items.map((i) => i.id)).toEqual([idFor(25)]);
      expect(second.nextCursor).toBeNull();
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('<'),
        {
          cursorAt: rowAt(24).startedAt,
          cursorId: idFor(24),
        },
      );
    });

    it('orders newest first and caps the page size at 100', async () => {
      await service.findExecutionsPage(mockTenantId, 'wf-uuid-1', {
        limit: 5000,
      });
      expect(qb.limit).toHaveBeenCalledWith(101);
      expect(qb.orderBy).toHaveBeenCalledWith(
        expect.stringContaining('startedAt'),
        'DESC',
      );
      expect(qb.addOrderBy).toHaveBeenCalledWith('e.id', 'DESC');
    });

    it('filters by status', async () => {
      await service.findExecutionsPage(mockTenantId, 'wf-uuid-1', {
        status: 'FAILED',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('e.status = :status', {
        status: 'FAILED',
      });
    });

    it('lists summaries only: no step results and no trigger payload', async () => {
      qb.getMany.mockResolvedValueOnce([rowAt(1)]);
      const page = await service.findExecutionsPage(
        mockTenantId,
        'wf-uuid-1',
        {},
      );
      expect(page.items[0]).not.toHaveProperty('nodeResults');
      expect(page.items[0]).not.toHaveProperty('triggerPayload');
      expect(page.items[0]).toMatchObject({
        id: idFor(1),
        triggerSource: 'webhook',
        startedAt: rowAt(1).startedAt.toISOString(),
      });
      const selected: string[] = qb.select.mock.calls[0][0];
      expect(selected).not.toContain('e.nodeResults');
      expect(selected).not.toContain('e.triggerPayload');
    });

    it.each(['not-base64-of-anything', Buffer.from('2026|x').toString('base64url')])(
      'rejects a malformed cursor (%s) with 400',
      async (cursor) => {
        await expect(
          service.findExecutionsPage(mockTenantId, 'wf-uuid-1', { cursor }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('falls back to the default page size for a non-finite limit', async () => {
      await service.findExecutionsPage(mockTenantId, 'wf-uuid-1', {
        limit: Number.NaN,
      });
      expect(qb.limit).toHaveBeenCalledWith(26);
    });

    it('rejects an unknown status with 400', async () => {
      await expect(
        service.findExecutionsPage(mockTenantId, 'wf-uuid-1', {
          status: 'BOGUS' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if the workflow does not exist', async () => {
      workflowRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.findExecutionsPage(mockTenantId, 'wf-unknown', {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findExecutionById', () => {
    const pendingApproval = {
      id: 'appr-1',
      executionId: 'exec-uuid-1',
      status: 'PENDING',
      details: { tool: 'quote.create', preview: { total: 100 } },
      triggerSummary: 'contact.created — Ana Silva',
    };
    const recorded = {
      ...mockExecution,
      status: 'WAITING_APPROVAL' as const,
      triggerSource: 'webhook' as const,
      triggerPayload: { email: 'a@b.com' },
      nodeResults: {
        n1: {
          status: 'SUCCESS',
          label: 'Send email',
          type: 'sendEmail',
          input: { to: 'a@b.com' },
          output: { id: 'm1' },
          startedAt: '2026-10-08T12:00:00.000Z',
          durationMs: 5,
        },
        n2: {
          status: 'FAILED',
          error: 'boom',
          input: { x: 1 },
          startedAt: '2026-10-08T12:00:01.000Z',
        },
      },
    };

    beforeEach(() => {
      executionRepo.findOne.mockResolvedValue(recorded);
      approvals.findPendingForExecution.mockResolvedValue([pendingApproval]);
    });

    it('reads the database only, never Temporal, and adds pending approvals', async () => {
      const result = await service.findExecutionById(
        mockTenantId,
        'exec-uuid-1',
        true,
      );
      expect(temporalService.getClient).not.toHaveBeenCalled();
      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
      expect(executionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'exec-uuid-1', tenantId: mockTenantId },
      });
      expect(approvals.findPendingForExecution).toHaveBeenCalledWith(
        mockTenantId,
        'exec-uuid-1',
      );
      expect(result).toMatchObject({
        id: 'exec-uuid-1',
        status: 'WAITING_APPROVAL',
        triggerSource: 'webhook',
        triggerPayload: { email: 'a@b.com' },
        dataHidden: false,
        pendingApprovals: [pendingApproval],
      });
      expect(result.nodeResults.n1).toEqual(recorded.nodeResults.n1);
      expect(typeof result.startedAt).toBe('string');
    });

    it('without data access strips payload, step input/output and approval details', async () => {
      const result = await service.findExecutionById(
        mockTenantId,
        'exec-uuid-1',
        false,
      );
      expect(result.dataHidden).toBe(true);
      expect(result.triggerPayload).toEqual({});
      expect(result.nodeResults.n1).not.toHaveProperty('input');
      expect(result.nodeResults.n1).not.toHaveProperty('output');
      expect(result.nodeResults.n1).toMatchObject({
        status: 'SUCCESS',
        label: 'Send email',
        durationMs: 5,
      });
      expect(result.nodeResults.n2).toMatchObject({
        status: 'FAILED',
        error: 'boom',
      });
      expect(result.nodeResults.n2).not.toHaveProperty('input');
      expect(result.pendingApprovals).toEqual([
        { ...pendingApproval, details: {}, triggerSummary: '' },
      ]);
      // The stored record is untouched.
      expect(recorded.nodeResults.n1.input).toEqual({ to: 'a@b.com' });
    });

    it('an approver without data access keeps approval details but not the trigger summary', async () => {
      const result = await service.findExecutionById(
        mockTenantId,
        'exec-uuid-1',
        false,
        true,
      );
      expect(result.dataHidden).toBe(true);
      expect(result.triggerPayload).toEqual({});
      expect(result.nodeResults.n1).not.toHaveProperty('input');
      expect(result.pendingApprovals).toEqual([
        { ...pendingApproval, triggerSummary: '' },
      ]);
    });

    it('throws NotFoundException when execution does not exist', async () => {
      executionRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.findExecutionById(mockTenantId, 'exec-missing', true),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('run source', () => {
    it.each([
      ['webhook option', { triggerSource: 'webhook' as const }, 'webhook'],
      ['schedule option', { triggerSource: 'schedule' as const }, 'schedule'],
      ['test run', { testRun: true, triggerSource: 'webhook' as const }, 'test'],
      ['no option', {}, 'event'],
    ])('a keyless run from %s is recorded as %s', async (_n, options, want) => {
      await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        {},
        'user-1',
        options,
      );
      expect(executionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggerSource: want }),
      );
    });

    it('a keyed run records its source', async () => {
      executionRepo.findOne.mockResolvedValueOnce(null);
      await service.triggerExecution(mockTenantId, 'wf-uuid-1', {}, undefined, {
        idempotencyKey: 'schedule:t1',
        triggerSource: 'schedule',
      });
      expect(executionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'schedule:t1',
          triggerSource: 'schedule',
        }),
      );
    });

    it('a sourceEventId run is recorded as event, whatever the option says', async () => {
      executionRepo.findOne.mockResolvedValueOnce(null);
      await service.triggerExecution(mockTenantId, 'wf-uuid-1', {}, undefined, {
        sourceEventId: '7d1f0b2a-4c1e-4f7a-9a51-2f6f3c1d9e01',
        triggerSource: 'webhook',
      });
      expect(executionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ triggerSource: 'event' }),
      );
    });

    it('without failOnStartError a failed start leaves the row FAILED', async () => {
      mockTemporalClient.workflow.start.mockRejectedValueOnce(
        new Error('Temporal offline'),
      );
      executionRepo.save.mockClear();

      const exec = await service.triggerExecution(
        mockTenantId,
        'wf-uuid-1',
        {},
      );

      expect(exec).toMatchObject({
        status: 'FAILED',
        errorMessage: "Couldn't start the run",
      });
      expect(exec.finishedAt).toBeInstanceOf(Date);
      const saved = executionRepo.save.mock.calls.at(-1)[0];
      expect(saved).toMatchObject({ status: 'FAILED' });
      expect(saved.temporalWorkflowId).toMatch(/^exec-/);
    });
  });

  describe('signalExecution', () => {
    const user = { id: 'user-ana' };

    it('returns the run with data only to a user who can update automations', async () => {
      executionRepo.findOne.mockResolvedValueOnce({
        ...mockExecution,
        triggerPayload: { secret: 1 },
        nodeResults: {
          n1: { status: 'SUCCESS', input: { a: 1 }, output: { b: 2 }, startedAt: 's' },
        },
      });
      const hidden = await service.signalExecution(
        mockTenantId,
        'exec-uuid-1',
        { action: 'APPROVE', nodeId: 'n1' },
        { id: 'u', permissions: ['automation:approve'] },
      );
      expect(hidden.dataHidden).toBe(true);
      expect(hidden.triggerPayload).toEqual({});
      expect(hidden.nodeResults.n1).not.toHaveProperty('input');

      executionRepo.findOne.mockResolvedValueOnce({
        ...mockExecution,
        triggerPayload: { secret: 1 },
      });
      const shown = await service.signalExecution(
        mockTenantId,
        'exec-uuid-1',
        { action: 'APPROVE', nodeId: 'n1' },
        { id: 'u', permissions: [PERMISSIONS.AUTOMATION_UPDATE] },
      );
      expect(shown.dataHidden).toBe(false);
      expect(shown.triggerPayload).toEqual({ secret: 1 });
    });

    it('keeps pending approval details for an approver, without the trigger summary', async () => {
      const pending = {
        id: 'appr-2',
        details: { message: 'Check the discount' },
        triggerSummary: 'Webhook',
      };
      approvals.findPendingForExecution.mockResolvedValueOnce([pending]);
      const result = await service.signalExecution(
        mockTenantId,
        'exec-uuid-1',
        { action: 'APPROVE', nodeId: 'n1' },
        { id: 'u', permissions: [PERMISSIONS.AUTOMATION_APPROVE] },
      );
      expect(result.dataHidden).toBe(true);
      expect(result.pendingApprovals).toEqual([
        { ...pending, triggerSummary: '' },
      ]);
    });

    it('decides through the approvals claim, as the user, and returns the run', async () => {
      const result = await service.signalExecution(
        mockTenantId,
        'exec-uuid-1',
        {
          action: 'APPROVE',
          nodeId: 'approval-node-1',
          comment: 'Approved by manager',
        },
        user,
      );

      expect(approvals.decideByNode).toHaveBeenCalledWith(
        mockTenantId,
        'exec-uuid-1',
        'approval-node-1',
        user,
        { action: 'APPROVE', comment: 'Approved by manager' },
      );
      expect(result).toMatchObject({ id: 'exec-uuid-1', dataHidden: true });
      expect(executionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'exec-uuid-1', tenantId: mockTenantId },
      });
      expect(mockWorkflowHandle.signal).not.toHaveBeenCalled();
    });

    it('passes a rejection reason as the comment', async () => {
      await service.signalExecution(
        mockTenantId,
        'exec-uuid-1',
        {
          action: 'REJECT',
          nodeId: 'approval-node-1',
          reason: 'Budget exceeded',
        },
        user,
      );
      expect(approvals.decideByNode).toHaveBeenCalledWith(
        mockTenantId,
        'exec-uuid-1',
        'approval-node-1',
        user,
        { action: 'REJECT', comment: 'Budget exceeded' },
      );
    });

    it("surfaces the claim's errors unchanged", async () => {
      approvals.decideByNode.mockRejectedValueOnce(
        new ServiceUnavailableException(
          'Unable to deliver the approval decision to the workflow',
        ),
      );
      await expect(
        service.signalExecution(
          mockTenantId,
          'exec-uuid-1',
          { action: 'APPROVE', nodeId: 'node-1' },
          user,
        ),
      ).rejects.toThrow(ServiceUnavailableException);

      approvals.decideByNode.mockRejectedValueOnce(
        new BadRequestException("Node 'future-node' has no pending approval"),
      );
      await expect(
        service.signalExecution(
          mockTenantId,
          'exec-uuid-1',
          { action: 'APPROVE', nodeId: 'future-node' },
          user,
        ),
      ).rejects.toThrow(BadRequestException);

      approvals.decideByNode.mockRejectedValueOnce(
        new NotFoundException('Execution exec-missing not found'),
      );
      await expect(
        service.signalExecution(
          mockTenantId,
          'exec-missing',
          { action: 'APPROVE', nodeId: 'node-1' },
          user,
        ),
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
        { provide: AutomationApprovalsService, useValue: {} },
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

    it('ignores a secret sent by the client: the server owns it', async () => {
      const chosen = 'c'.repeat(43);
      const fresh = await update(base(), {
        triggerConfig: { requireSignature: true, signatureSecret: chosen },
      });
      expect(fresh.triggerConfig.signatureSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(fresh.triggerConfig.signatureSecret).not.toBe(chosen);

      const kept = fresh.triggerConfig.signatureSecret;
      const again = await update(fresh, {
        triggerConfig: { requireSignature: true, signatureSecret: chosen },
      });
      expect(again.triggerConfig.signatureSecret).toBe(kept);
    });

    it('ignores a client-sent secret on create too', async () => {
      const chosen = 'c'.repeat(43);
      const created = await service.createWorkflow('tenant-1', {
        name: 'Hook',
        triggerType: 'WEBHOOK',
        triggerConfig: { requireSignature: true, signatureSecret: chosen },
        nodes: [],
        edges: [],
      } as any);
      expect(created.triggerConfig.signatureSecret).toMatch(
        /^[A-Za-z0-9_-]{43}$/,
      );
      expect(created.triggerConfig.signatureSecret).not.toBe(chosen);
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
