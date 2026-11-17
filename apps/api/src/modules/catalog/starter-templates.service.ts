import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager } from 'typeorm';
import {
  createProductTemplateSchema,
  findStarterTemplate,
  previewStarterTemplate,
  STARTER_TEMPLATES,
  type StarterInstallResultDto,
  type StarterTemplatePreviewDto,
} from '@saas/shared';
import { Material } from './entities/material.entity';
import { ProductTemplate } from './entities/product-template.entity';
import { Tooling } from './entities/tooling.entity';
import { WorkCenter } from './entities/work-center.entity';

const normalise = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase();

/**
 * Installs a starter from the shared library into a tenant's catalog.
 *
 * Materials are matched by SKU, then by name; work centres and tooling have
 * no SKU, so by name. Anything matched is reused untouched (the shop's own
 * rates win over the placeholders), anything missing is created. All of it,
 * and the template, in one transaction: a half-installed starter would leave
 * primitives behind with no template naming them.
 */
@Injectable()
export class StarterTemplatesService {
  constructor(private readonly dataSource: DataSource) {}

  list(): StarterTemplatePreviewDto[] {
    return STARTER_TEMPLATES.map(previewStarterTemplate);
  }

  async install(
    tenantId: string,
    key: string,
    createdById: string | null,
  ): Promise<StarterInstallResultDto> {
    const starter = findStarterTemplate(key);
    if (!starter) throw new NotFoundException(`No starter template "${key}"`);

    return this.dataSource.transaction(async (manager) => {
      const created = { materials: 0, workCenters: 0, tooling: 0 };
      const reused = { materials: 0, workCenters: 0, tooling: 0 };
      const ids = {
        materials: new Map<string, string>(),
        workCenters: new Map<string, string>(),
        tooling: new Map<string, string>(),
      };

      const materials = manager.getRepository(Material);
      const existingMaterials = await materials.find({ where: { tenantId } });
      for (const [starterId, spec] of Object.entries(
        starter.catalog.materials,
      )) {
        const match =
          (spec.sku &&
            existingMaterials.find(
              (row) => normalise(row.sku) === normalise(spec.sku),
            )) ||
          existingMaterials.find(
            (row) => normalise(row.name) === normalise(spec.name),
          );
        if (match) {
          ids.materials.set(starterId, match.id);
          reused.materials++;
          continue;
        }
        const row = await materials.save(
          materials.create({
            tenantId,
            sku: spec.sku ?? null,
            name: spec.name,
            uom: spec.uom,
            costPerUom: spec.costPerUom,
            sheetWidthMm: spec.sheetWidthMm ?? null,
            sheetHeightMm: spec.sheetHeightMm ?? null,
            grain: spec.grain ?? 'NONE',
            wastePct: spec.wastePct ?? 0,
          }),
        );
        existingMaterials.push(row);
        ids.materials.set(starterId, row.id);
        created.materials++;
      }

      const workCenters = manager.getRepository(WorkCenter);
      const existingWorkCenters = await workCenters.find({
        where: { tenantId },
      });
      for (const [starterId, spec] of Object.entries(
        starter.catalog.workCenters,
      )) {
        const match = existingWorkCenters.find(
          (row) => normalise(row.name) === normalise(spec.name),
        );
        if (match) {
          ids.workCenters.set(starterId, match.id);
          reused.workCenters++;
          continue;
        }
        const row = await workCenters.save(
          workCenters.create({
            tenantId,
            name: spec.name,
            setupMinutes: spec.setupMinutes,
            machineCostPerHour: spec.machineCostPerHour,
            laborCostPerHour: spec.laborCostPerHour,
            scrapPct: spec.scrapPct ?? 0,
            minChargeMinutes: spec.minChargeMinutes ?? 0,
            dailyCapacityMinutes: spec.dailyCapacityMinutes ?? 480,
          }),
        );
        existingWorkCenters.push(row);
        ids.workCenters.set(starterId, row.id);
        created.workCenters++;
      }

      const tooling = manager.getRepository(Tooling);
      const existingTooling = await tooling.find({ where: { tenantId } });
      for (const [starterId, spec] of Object.entries(starter.catalog.tooling)) {
        const match = existingTooling.find(
          (row) => normalise(row.name) === normalise(spec.name),
        );
        if (match) {
          ids.tooling.set(starterId, match.id);
          reused.tooling++;
          continue;
        }
        const row = await tooling.save(
          tooling.create({
            tenantId,
            name: spec.name,
            cost: spec.cost,
            amortize: spec.amortize,
            reusable: spec.reusable,
          }),
        );
        existingTooling.push(row);
        ids.tooling.set(starterId, row.id);
        created.tooling++;
      }

      const template = await this.saveTemplate(
        manager,
        tenantId,
        starter.key,
        createdById,
        ids,
      );
      return {
        templateId: template.id,
        templateKey: template.templateKey,
        created,
        reused,
      };
    });
  }

  private async saveTemplate(
    manager: EntityManager,
    tenantId: string,
    key: string,
    createdById: string | null,
    ids: Record<'materials' | 'workCenters' | 'tooling', Map<string, string>>,
  ): Promise<ProductTemplate> {
    const { template } = findStarterTemplate(key)!;
    const repo = manager.getRepository(ProductTemplate);

    // Installing the same starter twice gives a second, independent template
    // rather than a new version of one the shop may already have edited.
    const taken = new Set(
      (await repo.find({ where: { tenantId }, withDeleted: true })).map(
        (row) => row.templateKey,
      ),
    );
    let templateKey = key;
    let copy = 1;
    while (taken.has(templateKey)) templateKey = `${key}-${++copy}`;

    const payload = createProductTemplateSchema.parse({
      templateKey,
      name: copy > 1 ? `${template.name} (${copy})` : template.name,
      description: template.description ?? null,
      currency: template.currency ?? 'AED',
      blankPreview: template.blankPreview ?? null,
      parameters: template.parameters,
      derived: template.derived ?? [],
      materials: template.materials.map((line) => ({
        ...line,
        materialId: ids.materials.get(line.materialId),
      })),
      operations: template.operations.map((line) => ({
        ...line,
        workCenterId: ids.workCenters.get(line.workCenterId),
      })),
      tooling: (template.tooling ?? []).map((line) => ({
        ...line,
        toolingId: ids.tooling.get(line.toolingId),
      })),
      pricing: template.pricing,
    });

    const draft: DeepPartial<ProductTemplate> = {
      ...payload,
      blankPreview: payload.blankPreview ?? null,
      tenantId,
      version: 1,
      isCurrent: true,
      createdById,
    };
    return repo.save(repo.create(draft));
  }
}
