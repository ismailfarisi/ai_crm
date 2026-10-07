import { Injectable } from '@nestjs/common';
import type { CustomObjectDefinition } from '../entities/custom-object-definition.entity';

export interface DynamicToolDescriptor {
  name: string;
  domain: 'CUSTOM_OBJECTS';
  description: string;
  isMutating: boolean;
  jsonSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
}

export interface CustomObjectAttribute {
  key?: string;
  slug?: string;
  label?: string;
  name?: string;
  type?: string;
  isRequired?: boolean;
}

export type CustomObject =
  | CustomObjectDefinition
  | {
      id?: string;
      name: string;
      slug: string;
      description?: string | null;
      attributes?: CustomObjectAttribute[];
      [key: string]: unknown;
    };

@Injectable()
export class CustomObjectToolFactoryService {
  createDynamicTools(objects: CustomObject[]): DynamicToolDescriptor[] {
    const tools: DynamicToolDescriptor[] = [];

    for (const obj of objects) {
      const slug = obj.slug.toLowerCase().replace(/[^a-z0-9_]/g, '_');

      // 1. Query Tool
      tools.push({
        name: `query_custom_${slug}`,
        domain: 'CUSTOM_OBJECTS',
        description: `Search and filter ${obj.name} records (${obj.description || 'custom entity'}).`,
        isMutating: false,
        jsonSchema: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'Keyword search across text fields' },
            limit: { type: 'number', description: 'Max records to return (default 10)' },
          },
          required: [],
          additionalProperties: false,
        },
      });

      // 2. Create Tool
      const properties: Record<string, unknown> = {};
      const required: string[] = [];

      for (const attr of obj.attributes || []) {
        const a = attr as any;
        const key = a.key ?? a.slug;
        const label = a.label ?? a.name ?? key;
        const normalizedType = String(a.type ?? '').toUpperCase();
        const typeMapping =
          normalizedType === 'NUMBER' ? 'number' : normalizedType === 'BOOLEAN' ? 'boolean' : 'string';

        if (key) {
          properties[key] = {
            type: typeMapping,
            description: label,
          };
          if (attr.isRequired) {
            required.push(key);
          }
        }
      }

      tools.push({
        name: `create_custom_${slug}`,
        domain: 'CUSTOM_OBJECTS',
        description: `Create a new ${obj.name} record.`,
        isMutating: true,
        jsonSchema: {
          type: 'object',
          properties,
          required,
          additionalProperties: false,
        },
      });
    }

    return tools;
  }
}
