import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { findStarterTemplate, STARTER_TEMPLATES } from '@saas/shared';
import { Material } from './entities/material.entity';
import { ProductTemplate } from './entities/product-template.entity';
import { Tooling } from './entities/tooling.entity';
import { WorkCenter } from './entities/work-center.entity';
import { StarterTemplatesService } from './starter-templates.service';

const tenantId = '11111111-1111-1111-1111-111111111111';
const userId = '44444444-4444-4444-4444-444444444444';
const ownGlue = '10000000-0000-4000-8000-000000000001';
const ownQc = '20000000-0000-4000-8000-000000000001';
const ownActiveQc = '20000000-0000-4000-8000-000000000002';

/** An in-memory stand-in for one table, enough for find/create/save. */
function table<T extends { id?: string }>(rows: T[] = []) {
  let next = rows.length;
  return {
    rows,
    find: jest.fn(async () => [...rows]),
    create: jest.fn((dto: T) => dto),
    save: jest.fn(async (row: T) => {
      next++;
      const saved = {
        ...row,
        id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
      };
      rows.push(saved);
      return saved;
    }),
  };
}

describe('StarterTemplatesService', () => {
  let materials: ReturnType<typeof table<Partial<Material>>>;
  let workCenters: ReturnType<typeof table<Partial<WorkCenter>>>;
  let tooling: ReturnType<typeof table<Partial<Tooling>>>;
  let templates: ReturnType<typeof table<Partial<ProductTemplate>>>;
  let transaction: jest.Mock;
  let service: StarterTemplatesService;

  beforeEach(() => {
    materials = table();
    workCenters = table();
    tooling = table();
    templates = table();
    const repos = new Map<unknown, unknown>([
      [Material, materials],
      [WorkCenter, workCenters],
      [Tooling, tooling],
      [ProductTemplate, templates],
    ]);
    transaction = jest.fn(async (run: (manager: unknown) => unknown) =>
      run({ getRepository: (entity: unknown) => repos.get(entity) }),
    );
    service = new StarterTemplatesService({
      transaction,
    } as unknown as DataSource);
  });

  it('lists every starter with its example priced', () => {
    const list = service.list();
    expect(list.map((s) => s.key)).toEqual(STARTER_TEMPLATES.map((s) => s.key));
    for (const s of list) expect(s.example.unitPrice).toBeGreaterThan(0);
  });

  it('creates the template and every primitive in one transaction', async () => {
    const result = await service.install(tenantId, 'rsc-carton', userId);
    const { catalog } = findStarterTemplate('rsc-carton')!;

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result.created).toEqual({
      materials: Object.keys(catalog.materials).length,
      workCenters: Object.keys(catalog.workCenters).length,
      tooling: Object.keys(catalog.tooling).length,
    });
    expect(materials.rows.every((row) => row.tenantId === tenantId)).toBe(true);

    const saved = templates.rows[0];
    expect(saved).toMatchObject({
      tenantId,
      templateKey: 'rsc-carton',
      version: 1,
      isCurrent: true,
      currency: 'AED',
      blankPreview: null,
      createdById: userId,
    });
    // Every reference points at a row that now exists for this tenant.
    const materialIds = new Set(materials.rows.map((row) => row.id));
    const workCenterIds = new Set(workCenters.rows.map((row) => row.id));
    for (const line of saved.materials!)
      expect(materialIds.has(line.materialId)).toBe(true);
    for (const line of saved.operations!)
      expect(workCenterIds.has(line.workCenterId)).toBe(true);
    expect(saved.tooling![0].toolingId).toBe(tooling.rows[0].id);
  });

  it('reuses primitives a second starter shares, matched by SKU or name', async () => {
    materials.rows.push({
      id: ownGlue,
      tenantId,
      sku: 'glue-pva',
      name: 'Our glue',
    });
    workCenters.rows.push({ id: ownQc, tenantId, name: 'qc and packing' });

    await service.install(tenantId, 'rigid-box', userId);
    const result = await service.install(tenantId, 'rsc-carton', userId);

    // Glue by SKU (case-insensitive), QC by name; neither is duplicated.
    expect(
      materials.rows.filter((row) => row.sku?.toUpperCase() === 'GLUE-PVA'),
    ).toHaveLength(1);
    expect(
      workCenters.rows.filter(
        (row) => row.name?.toLowerCase() === 'qc and packing',
      ),
    ).toHaveLength(1);
    expect(result.reused.materials).toBe(1);
    expect(result.reused.workCenters).toBe(1);

    const carton = templates.rows[1];
    expect(
      carton.materials!.find((line) => line.key === 'glue')!.materialId,
    ).toBe(ownGlue);
    expect(
      carton.operations!.find((line) => line.key === 'bundle')!.workCenterId,
    ).toBe(ownQc);
  });

  it('does not reuse a same-named material bought in another unit, and prefers an active match', async () => {
    const { catalog } = findStarterTemplate('rsc-carton')!;
    const glue = Object.values(catalog.materials).find(
      (m) => m.sku === 'GLUE-PVA',
    )!;
    materials.rows.push({
      id: ownGlue,
      tenantId,
      sku: null,
      name: glue.name,
      uom: 'EACH',
    });
    workCenters.rows.push(
      { id: ownQc, tenantId, name: 'QC and packing', isActive: false },
      { id: ownActiveQc, tenantId, name: 'QC and packing', isActive: true },
    );

    await service.install(tenantId, 'rsc-carton', userId);
    const carton = templates.rows[0];

    expect(
      carton.materials!.find((line) => line.key === 'glue')!.materialId,
    ).not.toBe(ownGlue);
    expect(
      carton.operations!.find((line) => line.key === 'bundle')!.workCenterId,
    ).toBe(ownActiveQc);
  });

  it('a reinstall reuses every primitive and gets its own template key', async () => {
    await service.install(tenantId, 'cabinet-carcass', userId);
    const counts = [materials.rows.length, workCenters.rows.length];

    const again = await service.install(tenantId, 'cabinet-carcass', userId);

    expect([materials.rows.length, workCenters.rows.length]).toEqual(counts);
    expect(again.created).toEqual({ materials: 0, workCenters: 0, tooling: 0 });
    expect(again.templateKey).toBe('cabinet-carcass-2');
    expect(templates.rows[1].name).toMatch(/\(2\)$/);
  });

  it('keeps the rigid box blank drawing on', async () => {
    await service.install(tenantId, 'rigid-box', userId);
    expect(templates.rows[0].blankPreview).toBe('RIGID_BOX');
  });

  it('rejects an unknown starter before touching the database', async () => {
    await expect(
      service.install(tenantId, 'nope', userId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
