import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';

export type DomainCluster = 'SALES' | 'PRODUCTION' | 'FINANCE' | 'CUSTOM_OBJECTS' | 'GENERAL';

export interface DomainClassification {
  domain: DomainCluster;
  confidence: number;
}

export interface DomainAwareSkill {
  name: string;
  domain: DomainCluster;
  requiredPermission?: string;
  description?: string;
  jsonSchema?: Record<string, unknown>;
}

@Injectable()
export class HierarchicalToolRouterService {
  private readonly logger = new Logger(HierarchicalToolRouterService.name);

  constructor(private readonly ai: AiService) {}

  async classifyDomain(
    message: string,
    actor: { organizationId: string; userId: string },
  ): Promise<DomainClassification> {
    const schema = {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          enum: ['SALES', 'PRODUCTION', 'FINANCE', 'CUSTOM_OBJECTS', 'GENERAL'],
          description: 'The primary CRM functional domain of the user request.',
        },
        confidence: {
          type: 'number',
          description: 'Confidence score from 0 to 1.',
        },
      },
      required: ['domain', 'confidence'],
      additionalProperties: false,
    };

    try {
      const result = await this.ai.generateStructured<{ domain: DomainCluster; confidence: number }>(
        'channels.classify_domain',
        {
          messages: [
            {
              role: 'user',
              content: `Classify the user intent into one domain:
- SALES: Quotes, deals, customer purchase orders, pricing
- PRODUCTION: Work orders, routing, machine operations, shop floor time
- FINANCE: Invoices, payments, expense claims, ledger receipts
- CUSTOM_OBJECTS: User-defined custom entities (vehicles, contracts, charts)
- GENERAL: Casual chat, status queries, help

Message: "${message}"`,
            },
          ],
          jsonSchema: schema,
          schemaName: 'domain_classification',
        },
        actor,
      );

      return result.data;
    } catch (err) {
      this.logger.warn(`Domain classification degraded to GENERAL: ${err}`);
      return { domain: 'GENERAL', confidence: 0.5 };
    }
  }

  filterAuthorizedTools<T extends DomainAwareSkill>(
    domain: DomainCluster,
    userPermissions: string[],
    skills: T[],
  ): T[] {
    const hasWildcard = userPermissions.includes('*') || userPermissions.includes('admin');

    return skills.filter((skill) => {
      // Must match domain or be universal general tool
      if (domain !== 'GENERAL' && skill.domain !== domain && skill.domain !== 'GENERAL') {
        return false;
      }
      // Must satisfy RBAC permission
      if (!skill.requiredPermission || hasWildcard) {
        return true;
      }
      return userPermissions.includes(skill.requiredPermission);
    });
  }
}
