import { randomUUID } from 'node:crypto';
import { PERMISSIONS, type Permission } from '@saas/shared';
import { AiService } from '@/modules/ai/ai.service';
import { AuditService } from '@/modules/audit/audit.service';
import { TenantContextService } from '@/common/context/tenant-context.service';
import { CustomObjectToolFactoryService } from '@/modules/custom-objects/services/custom-object-tool-factory.service';
import { CustomObjectsService } from '@/modules/custom-objects/services/custom-objects.service';
import { CustomRecordsService } from '@/modules/custom-objects/services/custom-records.service';
import type { CustomObjectDefinition } from '@/modules/custom-objects/entities/custom-object-definition.entity';
import { RbacService } from '@/modules/rbac/rbac.service';
import { ChannelProviderType } from '../../entities/channel-config.entity';
import { SkillRegistry } from '../../skills/skill.registry';
import { ToolExecutionPolicyService } from '../../skills/tool-execution-policy.service';
import type { ChannelSkill, SkillContext } from '../../skills/skill.types';
import type {
  AgentReactActivities,
  ToolCallSpec,
  ToolExecutionResult,
} from './agent-react.activities';

type AgentActivityContext = {
  organizationId: string;
  userId: string;
  message: string;
};

const skillDomain = (name: string): string => {
  if (name.startsWith('work_order.')) return 'PRODUCTION';
  if (name.startsWith('purchase_order.')) return 'FINANCE';
  return 'SALES';
};

export function createAgentReactActivities(deps: {
  aiService: AiService;
  rbacService: RbacService;
  skillRegistry: SkillRegistry;
  auditService: AuditService;
  customObjectToolFactory: CustomObjectToolFactoryService;
  customObjectsService: CustomObjectsService;
  customRecordsService: CustomRecordsService;
  tenantContext: TenantContextService;
}): AgentReactActivities {
  const policy = new ToolExecutionPolicyService();

  const resolveSkills = async (
    ctx: Pick<AgentActivityContext, 'organizationId' | 'userId'>,
    allowedDomains?: string[],
  ): Promise<{ skills: ChannelSkill<never>[]; permissions: Permission[] }> => {
    if (!ctx.userId) {
      return { skills: [], permissions: [] };
    }
    const access = await deps.rbacService.resolveAccess(
      ctx.userId,
      ctx.organizationId,
    );
    const skills = deps.skillRegistry.permittedFor(access.permissions);
    return {
      skills:
        allowedDomains?.length
          ? skills.filter((skill) => allowedDomains.includes(skillDomain(skill.name)))
          : skills,
      permissions: access.permissions,
    };
  };

  const makeContext = (
    input: AgentActivityContext,
    permissions: Permission[],
  ): SkillContext => ({
    organizationId: input.organizationId,
    userId: input.userId,
    message: input.message,
    permissions,
    provider: ChannelProviderType.EMAIL_RESEND,
    senderIdentifier: 'automation',
  });

  const findSkill = (
    skills: ChannelSkill<never>[],
    name: string,
  ): ChannelSkill<never> | undefined => skills.find((skill) => skill.name === name);

  const resolveTool = async (
    tool: ToolCallSpec,
    ctx: AgentActivityContext,
  ) => {
    const { skills, permissions } = await resolveSkills(ctx);
    const skill = findSkill(skills, tool.name);
    if (!skill) {
      throw new Error(`Tool '${tool.name}' is unavailable or not authorized`);
    }
    const skillContext = makeContext(ctx, permissions);
    const resolution = await skill.resolve(tool.args, skillContext);
    return { skill, skillContext, resolution };
  };

  const resolveCustomObjectTool = async (
    toolName: string,
    ctx: Pick<AgentActivityContext, 'organizationId' | 'userId'>,
  ): Promise<{ object: CustomObjectDefinition; permissions: Permission[] } | null> => {
    const isQuery = toolName.startsWith('query_custom_');
    const isCreate = toolName.startsWith('create_custom_');
    if (!isQuery && !isCreate) return null;

    const { permissions } = await resolveSkills(ctx);
    const requiredPermission = isQuery
      ? PERMISSIONS.CUSTOM_RECORD_READ
      : PERMISSIONS.CUSTOM_RECORD_CREATE;
    if (!permissions.includes(requiredPermission)) {
      throw new Error(`Tool '${toolName}' is unavailable or not authorized`);
    }

    const prefix = isQuery ? 'query_custom_' : 'create_custom_';
    const normalizeSlug = (slug: string) =>
      slug.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const objects = await deps.customObjectsService.list(ctx.organizationId);
    const object = objects.find(
      (candidate) => `${prefix}${normalizeSlug(candidate.slug)}` === toolName,
    );
    if (!object) {
      throw new Error(`Custom object tool '${toolName}' no longer exists`);
    }
    return { object, permissions };
  };

  return {
    async listAvailableTools(input) {
      return deps.tenantContext.runWithTenant(input.organizationId, async () => {
        const { skills, permissions } = await resolveSkills(input, input.allowedDomains);
        const availableTools = skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          inputSchema: skill.jsonSchema,
        }));
        if (
          (!input.allowedDomains?.length ||
            input.allowedDomains.includes('CUSTOM_OBJECTS')) &&
          (permissions.includes(PERMISSIONS.CUSTOM_RECORD_READ) ||
            permissions.includes(PERMISSIONS.CUSTOM_RECORD_CREATE))
        ) {
          const objects = await deps.customObjectsService.list(input.organizationId);
          availableTools.push(
            ...deps.customObjectToolFactory
              .createDynamicTools(objects)
              .filter(
                (tool) =>
                  (tool.name.startsWith('query_custom_') &&
                    permissions.includes(PERMISSIONS.CUSTOM_RECORD_READ)) ||
                  (tool.name.startsWith('create_custom_') &&
                    permissions.includes(PERMISSIONS.CUSTOM_RECORD_CREATE)),
              )
              .map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.jsonSchema,
              })),
          );
        }
        return availableTools;
      });
    },

    async planReActTurn(input) {
      return deps.tenantContext.runWithTenant(input.organizationId, async () => {
        const toolNames = input.availableTools.map((tool) => tool.name);
        const schema = {
          type: 'object',
          properties: {
            thought: { type: 'string' },
            finalAnswer: { type: 'string' },
            toolCalls: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: {
                    type: 'string',
                    ...(toolNames.length ? { enum: toolNames } : {}),
                  },
                  args: { type: 'object', additionalProperties: true },
                },
                required: ['name', 'args'],
                additionalProperties: false,
              },
            },
          },
          required: ['thought'],
          additionalProperties: false,
        };
        const tools = input.availableTools
          .map(
            (tool) =>
              `${tool.name}: ${tool.description}\n${JSON.stringify(tool.inputSchema)}`,
          )
          .join('\n\n');
        const result = await deps.aiService.generateStructured<{
          thought?: string;
          finalAnswer?: string;
          toolCalls?: Array<{
            id?: string;
            name: string;
            args: Record<string, unknown>;
          }>;
        }>(
          'automations.ai_agent',
          {
            messages: [
              {
                role: 'user',
                content:
                  `Goal: ${input.prompt}\n\nConversation:\n${JSON.stringify(input.conversationHistory)}\n\n` +
                  `Authorized tools:\n${tools || '(none)'}\n\n` +
                  'Use only the listed tools. If none are needed or available, provide a final answer. Do not claim an action succeeded until a tool result confirms it.',
              },
            ],
            jsonSchema: schema,
            schemaName: 'agent_react_turn',
          },
          {
            organizationId: input.organizationId,
            ...(input.userId ? { userId: input.userId } : {}),
          },
        );
        const knownNames = new Set(toolNames);
        const toolCalls = (result.data.toolCalls ?? [])
          .filter((call) => knownNames.has(call.name))
          .map((call) => ({
            id: call.id || randomUUID(),
            name: call.name,
            args: call.args ?? {},
          }));
        return {
          thought: result.data.thought ?? '',
          model: result.model,
          ...(typeof result.data.finalAnswer === 'string'
            ? { finalAnswer: result.data.finalAnswer }
            : {}),
          ...(toolCalls.length ? { toolCalls } : {}),
        };
      });
    },

    async executeToolActivity(
      tool: ToolCallSpec,
      ctx: AgentActivityContext,
    ): Promise<ToolExecutionResult> {
      return deps.tenantContext.runWithTenant(ctx.organizationId, async () => {
        const customTool = await resolveCustomObjectTool(tool.name, ctx);
        if (customTool) {
          const isQuery = tool.name.startsWith('query_custom_');
          if (isQuery) {
            const result = await deps.customRecordsService.list(
              ctx.organizationId,
              customTool.object.slug,
              { search: tool.args.search, limit: tool.args.limit },
              { id: ctx.userId, permissions: customTool.permissions },
            );
            return {
              toolCallId: tool.id,
              toolName: tool.name,
              isMutating: false,
              requiresApproval: false,
              output: { items: result.items, total: result.total },
            };
          }
          return {
            toolCallId: tool.id,
            toolName: tool.name,
            isMutating: true,
            requiresApproval: true,
            previewPayload: {
              summary: `Create ${customTool.object.singularName} in ${customTool.object.name}`,
              values: tool.args,
            },
          };
        }

        const { skill, skillContext, resolution } = await resolveTool(tool, ctx);
        if (resolution.kind === 'question') {
          return {
            toolCallId: tool.id,
            toolName: tool.name,
            isMutating: false,
            requiresApproval: false,
            output: { reply: resolution.question, slots: resolution.slots },
          };
        }
        if (resolution.kind === 'refused') {
          return {
            toolCallId: tool.id,
            toolName: tool.name,
            isMutating: false,
            requiresApproval: false,
            output: { error: resolution.reason },
          };
        }

        const isMutating = skill.isMutating !== false;
        const evaluation = policy.evaluatePolicy(tool.name, isMutating);
        if (evaluation.requiresApproval) {
          return {
            toolCallId: tool.id,
            toolName: tool.name,
            isMutating,
            requiresApproval: true,
            previewPayload: {
              summary: await skill.preview(resolution.value, skillContext),
            },
          };
        }

        const outcome = await skill.execute(resolution.value, skillContext);
        return {
          toolCallId: tool.id,
          toolName: tool.name,
          isMutating,
          requiresApproval: false,
          output: {
            reply: outcome.reply,
            resultType: outcome.resultType,
            resultId: outcome.resultId,
          },
        };
      });
    },

    async commitToolMutationActivity(tool, ctx) {
      return deps.tenantContext.runWithTenant(ctx.organizationId, async () => {
        const customTool = await resolveCustomObjectTool(tool.name, ctx);
        if (customTool) {
          if (!tool.name.startsWith('create_custom_')) {
            throw new Error(
              `Tool '${tool.name}' is read-only and cannot be committed`,
            );
          }
          const record = await deps.customRecordsService.create(
            ctx.organizationId,
            customTool.object.slug,
            { values: tool.args },
            { id: ctx.userId, permissions: customTool.permissions },
          );
          await deps.auditService.record({
            tenantId: ctx.organizationId,
            action: 'custom_record.created',
            subjectType: customTool.object.slug,
            subjectId: record.id,
            actorId: ctx.userId,
            summary: `Created ${customTool.object.singularName} via AI`,
            origin: 'AI_ASSISTED',
            channel: 'SYSTEM',
            model: tool.model,
            promptVersion: 'custom-object/1',
          });
          return {
            success: true,
            resultSummary: `Created ${customTool.object.singularName} record ${record.id}.`,
          };
        }

        const { skill, skillContext, resolution } = await resolveTool(tool, ctx);
        if (resolution.kind !== 'resolved') {
          throw new Error(`Tool '${tool.name}' is no longer ready to execute`);
        }
        if (skill.isMutating === false) {
          throw new Error(
            `Tool '${tool.name}' is read-only and cannot be committed`,
          );
        }
        const outcome = await skill.execute(resolution.value, skillContext);
        await deps.auditService.record({
          tenantId: ctx.organizationId,
          action: `${skill.name}.executed`,
          subjectType: outcome.resultType ?? skill.name,
          subjectId: outcome.resultId,
          actorId: ctx.userId,
          summary: outcome.reply,
          origin: 'AI_ASSISTED',
          channel: 'SYSTEM',
          model: tool.model,
          promptVersion: skill.promptVersion,
        });
        return {
          success: true,
          resultSummary: outcome.reply,
        };
      });
    },
  };
}
