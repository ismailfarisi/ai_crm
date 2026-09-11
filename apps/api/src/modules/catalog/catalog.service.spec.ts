import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import type { CreateProductTemplatePayload } from '@saas/shared';
import { CatalogService } from './catalog.service';
import { CatalogItem } from './entities/catalog-item.entity';
import { Material } from './entities/material.entity';
import { ProductTemplate } from './entities/product-template.entity';
import { Tooling } from './entities/tooling.entity';
import { WorkCenter } from './entities/work-center.entity';

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '44444444-4444-4444-4444-444444444444';
const materialId = '10000000-0000-0000-0000-000000000001';
const workCenterId = '20000000-0000-0000-0000-000000000001';
const toolingId = '30000000-0000-0000-0000-000000000001';

function validTemplate(
  overrides: Partial<CreateProductTemplatePayload> = {},
): CreateProductTemplatePayload {
  return {
    templateKey: 'rigid-box',
    name: 'Rigid box',
    description: null,
    currency: 'USD',
    parameters: [
      { key: 'width_mm', label: 'Width', type: 'NUMBER', unit: 'mm', min: 10, max: 500 },
    ],
    derived: [{ key: 'blank_w', formula: 'width_mm * 2', unit: 'mm' }],
    materials: [
      {
        key: 'board',
        label: 'Board',
        materialId,
        mode: 'SHEET_NEST',
        blankWidthFormula: 'blank_w',
        blankHeightFormula: 'blank_w',
      },
    ],
    operations: [
      {
        key: 'diecut',
        label: 'Die-cut',
        workCenterId,
        sequence: 10,
        runMinutesFormula: 'board_units / 900 * 60',
      },
    ],
    tooling: [{ key: 'die', label: 'Die', toolingId }],
    pricing: { method: 'MARGIN', rate: 0.35, overheadPct: 0.12 },
    ...overrides,
  } as CreateProductTemplatePayload;
}

describe('CatalogService', () => {
  let service: CatalogService;
  let materials: jest.Mocked<Partial<Repository<Material>>>;
  let workCenters: jest.Mocked<Partial<Repository<WorkCenter>>>;
  let tooling: jest.Mocked<Partial<Repository<Tooling>>>;
  let items: jest.Mocked<Partial<Repository<CatalogItem>>>;
  let templates: jest.Mocked<Partial<Repository<ProductTemplate>>>;
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let queryBuilder: Record<string, jest.Mock>;

  beforeEach(() => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      getMany: jest.fn().mockResolvedValue([]),
    };

    materials = { findBy: jest.fn().mockResolvedValue([{ id: materialId }]) };
    workCenters = { findBy: jest.fn().mockResolvedValue([{ id: workCenterId }]) };
    tooling = { findBy: jest.fn().mockResolvedValue([{ id: toolingId }]) };
    items = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (row) => ({ id: 'new', ...row })),
    };
    templates = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation(async (row) => ({ id: 'new', ...row })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation(async (run: (m: unknown) => unknown) =>
        run({ getRepository: () => templates }),
      ),
    };

    service = new CatalogService(
      materials as Repository<Material>,
      workCenters as Repository<WorkCenter>,
      tooling as Repository<Tooling>,
      items as Repository<CatalogItem>,
      templates as Repository<ProductTemplate>,
      dataSource as DataSource,
    );
  });

  describe('template validation', () => {
    it('accepts a well-formed template as version 1', async () => {
      const created = await service.createTemplate(tenantId, validTemplate(), userId);

      expect(created).toMatchObject({
        tenantId,
        templateKey: 'rigid-box',
        version: 1,
        isCurrent: true,
        createdById: userId,
      });
    });

    // A formula typo caught here can never reach a customer-facing quote.
    it('rejects a formula that does not parse', async () => {
      await expect(
        service.createTemplate(
          tenantId,
          validTemplate({ derived: [{ key: 'bad', formula: '2 + * 3', label: undefined, unit: undefined }] }),
          userId,
        ),
      ).rejects.toThrow(/Derived variable "bad"/);
    });

    it('rejects a key declared twice', async () => {
      await expect(
        service.createTemplate(
          tenantId,
          validTemplate({
            derived: [
              { key: 'blank_w', formula: 'width_mm * 2', label: undefined, unit: undefined },
              { key: 'blank_w', formula: 'width_mm * 3', label: undefined, unit: undefined },
            ],
          }),
          userId,
        ),
      ).rejects.toThrow(/declared more than once/);
    });

    it('rejects a key that collides with the built-in order quantity', async () => {
      await expect(
        service.createTemplate(
          tenantId,
          validTemplate({
            derived: [{ key: 'quantity', formula: '1', label: undefined, unit: undefined }],
          }),
          userId,
        ),
      ).rejects.toThrow(/collides with the built-in order quantity/);
    });

    it('rejects a sheet-nest material with no blank dimensions', async () => {
      await expect(
        service.createTemplate(
          tenantId,
          validTemplate({
            materials: [
              { key: 'board', label: 'Board', materialId, mode: 'SHEET_NEST' },
            ] as CreateProductTemplatePayload['materials'],
          }),
          userId,
        ),
      ).rejects.toThrow(/needs both blank dimensions/);
    });

    it('rejects a per-unit material with no quantity formula', async () => {
      await expect(
        service.createTemplate(
          tenantId,
          validTemplate({
            materials: [
              { key: 'glue', label: 'Glue', materialId, mode: 'PER_UNIT' },
            ] as CreateProductTemplatePayload['materials'],
          }),
          userId,
        ),
      ).rejects.toThrow(/needs a quantity formula/);
    });

    it('rejects an enum parameter with no options', async () => {
      await expect(
        service.createTemplate(
          tenantId,
          validTemplate({
            parameters: [
              { key: 'finish', label: 'Finish', type: 'ENUM', options: [] },
            ] as unknown as CreateProductTemplatePayload['parameters'],
          }),
          userId,
        ),
      ).rejects.toThrow(/enum with no options/);
    });

    // A template must not reach across tenants for its cost base.
    it('rejects a reference to a material this tenant does not own', async () => {
      materials.findBy = jest.fn().mockResolvedValue([]);

      await expect(
        service.createTemplate(tenantId, validTemplate(), userId),
      ).rejects.toThrow(/unknown material/);
    });

    it('scopes the reference check to the caller tenant', async () => {
      await service.createTemplate(tenantId, validTemplate(), userId);

      expect(materials.findBy).toHaveBeenCalledWith([{ id: materialId, tenantId }]);
      expect(workCenters.findBy).toHaveBeenCalledWith([{ id: workCenterId, tenantId }]);
      expect(tooling.findBy).toHaveBeenCalledWith([{ id: toolingId, tenantId }]);
    });

    it('refuses a duplicate template key', async () => {
      templates.findOne = jest.fn().mockResolvedValue({ id: 'existing' });

      await expect(
        service.createTemplate(tenantId, validTemplate(), userId),
      ).rejects.toThrow(/already exists/);
    });
  });

  describe('versioning', () => {
    const existing = {
      ...validTemplate(),
      id: 'template-1',
      tenantId,
      version: 2,
      isCurrent: true,
    } as unknown as ProductTemplate;

    beforeEach(() => {
      templates.findOne = jest.fn().mockResolvedValue(existing);
      queryBuilder.getOne = jest.fn().mockResolvedValue({ version: 2 });
    });

    it('publishes version + 1 rather than editing in place', async () => {
      const published = await service.publishTemplateVersion(
        tenantId,
        'template-1',
        { name: 'Rigid box mk2' },
        userId,
      );

      expect(published).toMatchObject({
        templateKey: 'rigid-box',
        version: 3,
        isCurrent: true,
        name: 'Rigid box mk2',
      });
      // The old row is untouched apart from losing `isCurrent`.
      expect(templates.update).toHaveBeenCalledWith(
        { tenantId, templateKey: 'rigid-box' },
        { isCurrent: false },
      );
    });

    it('carries forward the parts of the model the patch left out', async () => {
      const published = await service.publishTemplateVersion(
        tenantId,
        'template-1',
        { name: 'Renamed' },
        userId,
      );

      expect(published.materials).toEqual(existing.materials);
      expect(published.operations).toEqual(existing.operations);
      expect(published.pricing).toEqual(existing.pricing);
    });

    it('validates the merged model, not just the patch', async () => {
      await expect(
        service.publishTemplateVersion(
          tenantId,
          'template-1',
          { derived: [{ key: 'bad', formula: 'ceil(', label: undefined, unit: undefined }] },
          userId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('retires every version of a key without deleting any', async () => {
      await service.retireTemplate(tenantId, 'template-1');

      expect(templates.update).toHaveBeenCalledWith(
        { tenantId, templateKey: 'rigid-box' },
        { isCurrent: false },
      );
    });
  });

  describe('deleting primitives', () => {
    it('blocks deleting a material a live template still uses', async () => {
      materials.findOne = jest.fn().mockResolvedValue({ id: materialId, tenantId, name: 'Board' });
      materials.softRemove = jest.fn();
      queryBuilder.getMany = jest.fn().mockResolvedValue([{ name: 'Rigid box' }]);

      await expect(service.deleteMaterial(tenantId, materialId)).rejects.toThrow(
        /still used by 1 template/,
      );
      expect(materials.softRemove).not.toHaveBeenCalled();
    });

    it('allows deleting a material nothing references', async () => {
      const row = { id: materialId, tenantId, name: 'Board' };
      materials.findOne = jest.fn().mockResolvedValue(row);
      materials.softRemove = jest.fn().mockResolvedValue(row);
      queryBuilder.getMany = jest.fn().mockResolvedValue([]);

      await service.deleteMaterial(tenantId, materialId);
      expect(materials.softRemove).toHaveBeenCalledWith(row);
    });

    it('404s on a material from another tenant', async () => {
      materials.findOne = jest.fn().mockResolvedValue(null);
      await expect(service.deleteMaterial(tenantId, materialId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('catalog items', () => {
    it('refuses a duplicate SKU', async () => {
      items.findOne = jest.fn().mockResolvedValue({ id: 'other', name: 'Existing box' });

      await expect(
        service.createItem(tenantId, {
          sku: 'BOX-1',
          name: 'New box',
          description: null,
          uom: 'Units',
          listPrice: 1,
          standardCost: 0.5,
          taxRate: 0,
          leadTimeDays: 0,
          isActive: true,
        }),
      ).rejects.toThrow(/already used by "Existing box"/);
    });

    it('searches name, sku and description, scoped to the tenant', async () => {
      await service.searchItems(tenantId, { q: 'mailer', limit: 25, includeInactive: false });

      const [[where]] = (items.find as jest.Mock).mock.calls;
      expect(where.where).toHaveLength(3);
      for (const clause of where.where) {
        expect(clause.tenantId).toBe(tenantId);
        expect(clause.isActive).toBe(true);
      }
    });
  });
});
