import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, DeepPartial, ILike, IsNull, Repository } from 'typeorm';
import {
  compileExpression,
  ExpressionError,
  type CatalogSearchPayload,
  type DerivedVariable,
  type TemplateMaterial,
  type TemplateOperation,
  type TemplateParameter,
  type TemplateTooling,
  type CreateCatalogItemPayload,
  type CreateMaterialPayload,
  type CreateProductTemplatePayload,
  type CreateToolingPayload,
  type CreateWorkCenterPayload,
  type UpdateCatalogItemPayload,
  type UpdateMaterialPayload,
  type UpdateProductTemplatePayload,
  type UpdateToolingPayload,
  type UpdateWorkCenterPayload,
} from '@saas/shared';
import { CatalogItem } from './entities/catalog-item.entity';
import { Material } from './entities/material.entity';
import { ProductTemplate } from './entities/product-template.entity';
import { Tooling } from './entities/tooling.entity';
import { WorkCenter } from './entities/work-center.entity';

/**
 * CRUD over the costing catalog. Every query is tenant-scoped at this layer —
 * a raw `find()` without `tenantId` leaks another shop's cost base, which is
 * the most commercially sensitive data in the product.
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Material)
    private readonly materials: Repository<Material>,
    @InjectRepository(WorkCenter)
    private readonly workCenters: Repository<WorkCenter>,
    @InjectRepository(Tooling)
    private readonly tooling: Repository<Tooling>,
    @InjectRepository(CatalogItem)
    private readonly items: Repository<CatalogItem>,
    @InjectRepository(ProductTemplate)
    private readonly templates: Repository<ProductTemplate>,
    private readonly dataSource: DataSource,
  ) {}

  /* ---------------- Materials ---------------- */

  async listMaterials(tenantId: string, includeInactive = false): Promise<Material[]> {
    return this.materials.find({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findMaterial(tenantId: string, id: string): Promise<Material> {
    const material = await this.materials.findOne({ where: { id, tenantId } });
    if (!material) throw new NotFoundException(`Material ${id} not found`);
    return material;
  }

  async createMaterial(tenantId: string, payload: CreateMaterialPayload): Promise<Material> {
    return this.materials.save(this.materials.create({ ...payload, tenantId }));
  }

  async updateMaterial(
    tenantId: string,
    id: string,
    payload: UpdateMaterialPayload,
  ): Promise<Material> {
    const material = await this.findMaterial(tenantId, id);
    Object.assign(material, payload);
    return this.materials.save(material);
  }

  async deleteMaterial(tenantId: string, id: string): Promise<void> {
    const material = await this.findMaterial(tenantId, id);
    await this.assertNotReferenced(tenantId, 'materialId', id, material.name);
    await this.materials.softRemove(material);
  }

  /* ---------------- Work centres ---------------- */

  async listWorkCenters(tenantId: string, includeInactive = false): Promise<WorkCenter[]> {
    return this.workCenters.find({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findWorkCenter(tenantId: string, id: string): Promise<WorkCenter> {
    const workCenter = await this.workCenters.findOne({ where: { id, tenantId } });
    if (!workCenter) throw new NotFoundException(`Work centre ${id} not found`);
    return workCenter;
  }

  async createWorkCenter(tenantId: string, payload: CreateWorkCenterPayload): Promise<WorkCenter> {
    return this.workCenters.save(this.workCenters.create({ ...payload, tenantId }));
  }

  async updateWorkCenter(
    tenantId: string,
    id: string,
    payload: UpdateWorkCenterPayload,
  ): Promise<WorkCenter> {
    const workCenter = await this.findWorkCenter(tenantId, id);
    Object.assign(workCenter, payload);
    return this.workCenters.save(workCenter);
  }

  async deleteWorkCenter(tenantId: string, id: string): Promise<void> {
    const workCenter = await this.findWorkCenter(tenantId, id);
    await this.assertNotReferenced(tenantId, 'workCenterId', id, workCenter.name);
    await this.workCenters.softRemove(workCenter);
  }

  /* ---------------- Tooling ---------------- */

  async listTooling(tenantId: string, includeInactive = false): Promise<Tooling[]> {
    return this.tooling.find({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      order: { name: 'ASC' },
    });
  }

  async findTooling(tenantId: string, id: string): Promise<Tooling> {
    const tool = await this.tooling.findOne({ where: { id, tenantId } });
    if (!tool) throw new NotFoundException(`Tooling ${id} not found`);
    return tool;
  }

  async createTooling(tenantId: string, payload: CreateToolingPayload): Promise<Tooling> {
    return this.tooling.save(this.tooling.create({ ...payload, tenantId }));
  }

  async updateTooling(
    tenantId: string,
    id: string,
    payload: UpdateToolingPayload,
  ): Promise<Tooling> {
    const tool = await this.findTooling(tenantId, id);
    Object.assign(tool, payload);
    return this.tooling.save(tool);
  }

  async deleteTooling(tenantId: string, id: string): Promise<void> {
    const tool = await this.findTooling(tenantId, id);
    await this.assertNotReferenced(tenantId, 'toolingId', id, tool.name);
    await this.tooling.softRemove(tool);
  }

  /* ---------------- Catalog items ---------------- */

  async searchItems(tenantId: string, query: CatalogSearchPayload): Promise<CatalogItem[]> {
    const base = query.includeInactive ? { tenantId } : { tenantId, isActive: true };

    if (!query.q) {
      return this.items.find({ where: base, order: { name: 'ASC' }, take: query.limit });
    }

    const term = `%${query.q}%`;
    return this.items.find({
      where: [
        { ...base, name: ILike(term) },
        { ...base, sku: ILike(term) },
        { ...base, description: ILike(term) },
      ],
      order: { name: 'ASC' },
      take: query.limit,
    });
  }

  async findItem(tenantId: string, id: string): Promise<CatalogItem> {
    const item = await this.items.findOne({ where: { id, tenantId } });
    if (!item) throw new NotFoundException(`Catalog item ${id} not found`);
    return item;
  }

  async createItem(tenantId: string, payload: CreateCatalogItemPayload): Promise<CatalogItem> {
    await this.assertSkuFree(tenantId, payload.sku);
    return this.items.save(this.items.create({ ...payload, tenantId }));
  }

  async updateItem(
    tenantId: string,
    id: string,
    payload: UpdateCatalogItemPayload,
  ): Promise<CatalogItem> {
    const item = await this.findItem(tenantId, id);
    if (payload.sku && payload.sku !== item.sku) {
      await this.assertSkuFree(tenantId, payload.sku);
    }
    Object.assign(item, payload);
    return this.items.save(item);
  }

  async deleteItem(tenantId: string, id: string): Promise<void> {
    await this.items.softRemove(await this.findItem(tenantId, id));
  }

  private async assertSkuFree(tenantId: string, sku: string): Promise<void> {
    const clash = await this.items.findOne({
      where: { tenantId, sku, deletedAt: IsNull() },
    });
    if (clash) {
      throw new BadRequestException(`SKU "${sku}" is already used by "${clash.name}"`);
    }
  }

  /* ---------------- Product templates ---------------- */

  async listTemplates(tenantId: string, includeAllVersions = false): Promise<ProductTemplate[]> {
    return this.templates.find({
      where: includeAllVersions ? { tenantId } : { tenantId, isCurrent: true },
      order: { name: 'ASC', version: 'DESC' },
    });
  }

  async findTemplate(tenantId: string, id: string): Promise<ProductTemplate> {
    const template = await this.templates.findOne({ where: { id, tenantId } });
    if (!template) throw new NotFoundException(`Product template ${id} not found`);
    return template;
  }

  async listTemplateVersions(tenantId: string, templateKey: string): Promise<ProductTemplate[]> {
    return this.templates.find({
      where: { tenantId, templateKey },
      order: { version: 'DESC' },
    });
  }

  async createTemplate(
    tenantId: string,
    payload: CreateProductTemplatePayload,
    createdById: string | null,
  ): Promise<ProductTemplate> {
    const existing = await this.templates.findOne({
      where: { tenantId, templateKey: payload.templateKey },
    });
    if (existing) {
      throw new BadRequestException(
        `Template key "${payload.templateKey}" already exists — publish a new version instead`,
      );
    }

    this.validateTemplateModel(payload);
    await this.assertCatalogReferencesExist(tenantId, payload);

    const draft: DeepPartial<ProductTemplate> = {
      ...payload,
      tenantId,
      version: 1,
      isCurrent: true,
      createdById,
    };

    return this.templates.save(this.templates.create(draft));
  }

  /**
   * Publishes a new immutable version. The caller passes the id of any version
   * of the key; the new row is built from that row's contents plus the patch,
   * so a partial update does not silently blank the rest of the model.
   */
  async publishTemplateVersion(
    tenantId: string,
    id: string,
    payload: UpdateProductTemplatePayload,
    createdById: string | null,
  ): Promise<ProductTemplate> {
    const current = await this.findTemplate(tenantId, id);
    const merged = {
      name: payload.name ?? current.name,
      description: payload.description ?? current.description,
      currency: payload.currency ?? current.currency,
      parameters: payload.parameters ?? current.parameters,
      derived: payload.derived ?? current.derived,
      materials: payload.materials ?? current.materials,
      operations: payload.operations ?? current.operations,
      tooling: payload.tooling ?? current.tooling,
      pricing: payload.pricing ?? current.pricing,
    };

    this.validateTemplateModel(merged);
    await this.assertCatalogReferencesExist(tenantId, merged);

    // One current version per key, and the version number has a unique index,
    // so do both writes in a transaction.
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(ProductTemplate);

      const highest = await repo
        .createQueryBuilder('template')
        .where('template.tenant_id = :tenantId', { tenantId })
        .andWhere('template.template_key = :templateKey', {
          templateKey: current.templateKey,
        })
        .orderBy('template.version', 'DESC')
        .getOne();

      await repo.update(
        { tenantId, templateKey: current.templateKey },
        { isCurrent: false },
      );

      const draft: DeepPartial<ProductTemplate> = {
        ...merged,
        tenantId,
        templateKey: current.templateKey,
        version: (highest?.version ?? current.version) + 1,
        isCurrent: true,
        createdById,
      };

      return repo.save(repo.create(draft));
    });
  }

  async retireTemplate(tenantId: string, id: string): Promise<void> {
    const template = await this.findTemplate(tenantId, id);
    // Versions are never deleted — a quote points at one. Retiring only takes
    // the key out of the picker.
    await this.templates.update(
      { tenantId, templateKey: template.templateKey },
      { isCurrent: false },
    );
  }

  /* ---------------- Validation ---------------- */

  /**
   * Compiles every formula and checks the key namespace before the template is
   * ever stored. Catching a typo here means it cannot reach a quote, where the
   * failure would land in front of a customer.
   */
  private validateTemplateModel(model: {
    parameters?: TemplateParameter[];
    derived?: DerivedVariable[];
    materials?: TemplateMaterial[];
    operations?: TemplateOperation[];
    tooling?: TemplateTooling[];
  }): void {
    const seen = new Set<string>(['quantity']);

    const claim = (key: string, what: string): void => {
      if (seen.has(key)) {
        throw new BadRequestException(
          key === 'quantity'
            ? `${what} "${key}" collides with the built-in order quantity`
            : `${what} "${key}" is declared more than once`,
        );
      }
      seen.add(key);
    };

    for (const parameter of model.parameters ?? []) {
      claim(parameter.key, 'Parameter');
      if (parameter.type === 'ENUM' && !(parameter.options ?? []).length) {
        throw new BadRequestException(`Parameter "${parameter.key}" is an enum with no options`);
      }
    }
    for (const derived of model.derived ?? []) claim(derived.key, 'Derived variable');
    for (const material of model.materials ?? []) claim(material.key, 'Material line');
    for (const operation of model.operations ?? []) claim(operation.key, 'Operation');
    for (const tool of model.tooling ?? []) claim(tool.key, 'Tooling line');

    const check = (formula: string | null | undefined, where: string): void => {
      if (!formula) return;
      try {
        compileExpression(formula);
      } catch (error) {
        const detail = error instanceof ExpressionError ? error.message : String(error);
        throw new BadRequestException(`${where}: ${detail}`);
      }
    };

    for (const derived of model.derived ?? []) {
      check(derived.formula, `Derived variable "${derived.key}"`);
    }
    for (const material of model.materials ?? []) {
      check(material.blankWidthFormula, `Material "${material.key}" blank width`);
      check(material.blankHeightFormula, `Material "${material.key}" blank height`);
      check(material.quantityFormula, `Material "${material.key}" quantity`);
      check(material.wastePctFormula, `Material "${material.key}" waste`);
      check(material.condition, `Material "${material.key}" condition`);

      if (material.mode === 'SHEET_NEST') {
        if (!material.blankWidthFormula || !material.blankHeightFormula) {
          throw new BadRequestException(
            `Material "${material.key}" nests sheets, so it needs both blank dimensions`,
          );
        }
      } else if (!material.quantityFormula) {
        throw new BadRequestException(`Material "${material.key}" needs a quantity formula`);
      }
    }
    for (const operation of model.operations ?? []) {
      check(operation.runMinutesFormula, `Operation "${operation.key}" run time`);
      check(operation.setupMinutesFormula, `Operation "${operation.key}" setup time`);
      check(operation.condition, `Operation "${operation.key}" condition`);
    }
    for (const tool of model.tooling ?? []) {
      check(tool.condition, `Tooling "${tool.key}" condition`);
    }
  }

  /** A template may only reference this tenant's own materials and machines. */
  private async assertCatalogReferencesExist(
    tenantId: string,
    model: {
      materials?: TemplateMaterial[];
      operations?: TemplateOperation[];
      tooling?: TemplateTooling[];
    },
  ): Promise<void> {
    const materialIds = [...new Set((model.materials ?? []).map((line) => line.materialId))];
    const workCenterIds = [...new Set((model.operations ?? []).map((line) => line.workCenterId))];
    const toolingIds = [...new Set((model.tooling ?? []).map((line) => line.toolingId))];

    const [materials, workCenters, tools] = await Promise.all([
      materialIds.length
        ? this.materials.findBy(materialIds.map((id) => ({ id, tenantId })))
        : Promise.resolve([]),
      workCenterIds.length
        ? this.workCenters.findBy(workCenterIds.map((id) => ({ id, tenantId })))
        : Promise.resolve([]),
      toolingIds.length
        ? this.tooling.findBy(toolingIds.map((id) => ({ id, tenantId })))
        : Promise.resolve([]),
    ]);

    const missing = [
      ...this.diff(materialIds, materials, 'material'),
      ...this.diff(workCenterIds, workCenters, 'work centre'),
      ...this.diff(toolingIds, tools, 'tooling'),
    ];

    if (missing.length) {
      throw new BadRequestException(`Template references unknown ${missing.join(', ')}`);
    }
  }

  private diff(ids: string[], found: { id: string }[], label: string): string[] {
    const have = new Set(found.map((row) => row.id));
    return ids.filter((id) => !have.has(id)).map((id) => `${label} ${id}`);
  }

  /**
   * Blocks deleting a primitive a template still uses. Without this the
   * template would keep validating until someone quoted from it, and the
   * failure would surface as a broken quote instead of a refused delete.
   */
  private async assertNotReferenced(
    tenantId: string,
    field: 'materialId' | 'workCenterId' | 'toolingId',
    id: string,
    name: string,
  ): Promise<void> {
    const column = field === 'materialId' ? 'materials' : field === 'workCenterId' ? 'operations' : 'tooling';

    const users = await this.templates
      .createQueryBuilder('template')
      .where('template.tenant_id = :tenantId', { tenantId })
      .andWhere('template.is_current = true')
      .andWhere(
        `EXISTS (SELECT 1 FROM jsonb_array_elements(template.${column}) AS line
                 WHERE line->>'${field}' = :id)`,
        { id },
      )
      .getMany();

    if (users.length) {
      const names = users.map((template) => template.name).join(', ');
      throw new BadRequestException(
        `"${name}" is still used by ${users.length} template(s): ${names}`,
      );
    }
  }
}
