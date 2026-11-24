import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  IMPORT_DEFINITIONS,
  IMPORT_ENTITIES,
  IMPORT_LIMITS,
  assertUaeTrn,
  importKeys,
  importTemplate,
  readRow,
  resolveVatStatus,
  suggestMapping,
  validateImportRow,
  type ImportEntity,
  type ImportFailure,
  type ImportMapping,
  type ImportOptionsPayload,
  type ImportPreviewDto,
  type ImportPreviewRow,
  type ImportRowIssue,
  type ImportRunDto,
} from '@saas/shared';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { CatalogItem } from '../catalog/entities/catalog-item.entity';
import { Material } from '../catalog/entities/material.entity';
import { WorkCenter } from '../catalog/entities/work-center.entity';
import { Contact } from '../contacts/entities/contact.entity';
import { ContactsService } from '../contacts/contacts.service';
import { Customer } from '../customers/entities/customer.entity';
import { InventoryService } from '../inventory/inventory.service';
import type { UploadedFileLike } from '../storage/storage.types';
import { ImportRun } from './entities/import-run.entity';
import { parseSpreadsheet } from './import-parser';

/** A saved record a row matched. */
interface Existing {
  id: string;
  label: string;
  record: Record<string, unknown>;
}

/** One row, read, validated and matched. */
interface PlannedRow extends ImportPreviewRow {
  value: Record<string, unknown> | null;
  existing: Existing | null;
}

interface Plan {
  headers: string[];
  mapping: ImportMapping;
  rows: PlannedRow[];
}

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' ? v : '');
const lowerList = (values: unknown[]) => [
  ...new Set(values.map((v) => text(v).trim().toLowerCase()).filter(Boolean)),
];

/**
 * Spreadsheet import for customers, contacts, catalog products, materials,
 * work centres and opening stock.
 *
 * Stateless: the browser keeps the file and sends it to `preview` (a dry
 * run) and again to `commit`, so nothing half-imported is ever stored. Both
 * build the same plan; commit then writes it in batches of
 * `IMPORT_LIMITS.batchSize` rows, each batch one transaction and each row a
 * savepoint, so a bad row fails alone without losing its batch.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ImportRun)
    private readonly runs: Repository<ImportRun>,
    private readonly contacts: ContactsService,
    private readonly inventory: InventoryService,
  ) {}

  /** The entities this actor may import. */
  allowedEntities(actor: AuthenticatedUser): ImportEntity[] {
    return IMPORT_ENTITIES.filter((e) =>
      actor.permissions.includes(IMPORT_DEFINITIONS[e].createPermission),
    );
  }

  private assertCanImport(actor: AuthenticatedUser, entity: ImportEntity) {
    if (
      !actor.permissions.includes(IMPORT_DEFINITIONS[entity].createPermission)
    ) {
      throw new ForbiddenException(
        `You do not have permission to import ${IMPORT_DEFINITIONS[entity].nounPlural}`,
      );
    }
  }

  /* ---------------- Templates ---------------- */

  async template(
    entity: ImportEntity,
    format: 'csv' | 'xlsx',
  ): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const { headers, example } = importTemplate(entity);
    const fileName = `kerf-${entity}-template.${format}`;
    if (format === 'csv') {
      return {
        buffer: Buffer.from(`\uFEFF${stringify([headers, example])}`, 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        fileName,
      };
    }
    return {
      buffer: await this.workbook(IMPORT_DEFINITIONS[entity].label, [
        headers,
        example,
      ]),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName,
    };
  }

  private async workbook(sheetName: string, rows: string[][]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
    rows.forEach((r) => sheet.addRow(r));
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((c) => (c.width = 22));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /* ---------------- Preview (dry run) ---------------- */

  async preview(
    actor: AuthenticatedUser,
    entity: ImportEntity,
    file: UploadedFileLike | undefined,
    mapping: ImportMapping | undefined,
  ): Promise<ImportPreviewDto> {
    this.assertCanImport(actor, entity);
    const plan = await this.plan(actor, entity, file, mapping);
    const rows = plan.rows.map((row): ImportPreviewRow => ({
      rowNumber: row.rowNumber,
      values: row.values,
      issues: row.issues,
      match: row.match,
      matchLabel: row.matchLabel,
    }));
    return {
      entity,
      fileName: file?.originalname ?? '',
      headers: plan.headers,
      mapping: plan.mapping,
      totalRows: rows.length,
      counts: {
        valid: rows.filter((r) => r.issues.length === 0).length,
        invalid: rows.filter((r) => r.issues.length > 0).length,
        existing: rows.filter(
          (r) => r.issues.length === 0 && r.match === 'existing',
        ).length,
        repeats: rows.filter((r) => r.match === 'repeat').length,
      },
      rows,
    };
  }

  /** Reads, validates and matches every row. Shared by preview and commit. */
  private async plan(
    actor: AuthenticatedUser,
    entity: ImportEntity,
    file: UploadedFileLike | undefined,
    requested: ImportMapping | undefined,
  ): Promise<Plan> {
    const { headers, rows, rowNumbers } = await parseSpreadsheet(file);
    const definition = IMPORT_DEFINITIONS[entity];
    const mapping = this.checkMapping(
      entity,
      requested ?? suggestMapping(entity, headers),
      headers.length,
    );
    const planned: PlannedRow[] = rows.map((cells, i) => {
      const values = readRow(entity, cells, mapping);
      const result = validateImportRow(entity, values);
      // An unmapped required column shows on every row as "<field> is required".
      const issues: ImportRowIssue[] = result.ok ? [] : result.issues;
      return {
        rowNumber: rowNumbers[i],
        values,
        issues,
        match: 'new',
        matchLabel: null,
        value: result.ok ? result.value : null,
        existing: null,
      };
    });
    const valid = planned.filter((r) => r.value);
    const index = await this.existing(
      actor,
      entity,
      valid.map((r) => r.value!),
    );
    if (entity === 'contacts') await this.resolveOwners(actor, valid);
    if (entity === 'opening-stock') await this.resolveMaterials(actor, valid);

    const seen = new Map<string, number>();
    for (const row of planned) {
      if (!row.value || row.issues.length > 0) continue;
      const keys = importKeys(entity, row.value);
      const earlier = keys.map((k) => seen.get(k)).find((n) => n !== undefined);
      if (earlier !== undefined) {
        row.match = 'repeat';
        row.matchLabel = `Row ${earlier}`;
        row.issues.push({
          field: null,
          message: `Same ${definition.noun} as row ${earlier}`,
        });
        continue;
      }
      keys.forEach((k) => seen.set(k, row.rowNumber));
      const hit = keys.map((k) => index.get(k)).find(Boolean);
      if (hit) {
        row.match = 'existing';
        row.matchLabel = hit.label;
        row.existing = hit;
      }
    }
    return { headers, mapping, rows: planned };
  }

  private checkMapping(
    entity: ImportEntity,
    mapping: ImportMapping,
    width: number,
  ): ImportMapping {
    const fields = IMPORT_DEFINITIONS[entity].fields;
    const out: ImportMapping = {};
    const used = new Set<number>();
    for (const field of fields) {
      const index = mapping[field.key];
      if (index == null) {
        out[field.key] = null;
        continue;
      }
      if (index >= width) {
        throw new BadRequestException(
          `"${field.label}" points at a column the file does not have`,
        );
      }
      if (used.has(index)) {
        throw new BadRequestException(
          'Each column can be used for one field only',
        );
      }
      used.add(index);
      out[field.key] = index;
    }
    return out;
  }

  /** Saved records keyed the way `importKeys` keys a row. */
  private async existing(
    actor: AuthenticatedUser,
    entity: ImportEntity,
    values: Row[],
  ): Promise<Map<string, Existing>> {
    const tenantId = actor.organizationId;
    const manager = this.dataSource.manager;
    const index = new Map<string, Existing>();
    const add = (record: Row, label: string) => {
      const entry = { id: String(record.id), label, record };
      for (const key of importKeys(entity, record)) {
        if (!index.has(key)) index.set(key, entry);
      }
    };
    if (values.length === 0) return index;

    switch (entity) {
      case 'customers': {
        const emails = lowerList(values.map((v) => v.email));
        const names = lowerList(values.map((v) => v.companyName));
        const found = await manager
          .getRepository(Customer)
          .createQueryBuilder('c')
          .where('c.tenantId = :tenantId', { tenantId })
          .andWhere(
            new Brackets((w) => {
              w.where('LOWER(c.companyName) IN (:...names)', {
                names: names.length ? names : [''],
              });
              if (emails.length)
                w.orWhere('LOWER(c.email) IN (:...emails)', { emails });
            }),
          )
          .getMany();
        // Email first: index the email keys of every record before any name.
        found.forEach(
          (c) => c.email && add({ id: c.id, email: c.email }, c.companyName),
        );
        found.forEach((c) => add(c as unknown as Row, c.companyName));
        break;
      }
      case 'contacts': {
        const emails = lowerList(values.map((v) => v.email));
        const names = lowerList(
          values
            .filter((v) => !v.email)
            .map((v) => `${text(v.firstName)} ${text(v.lastName)}`),
        );
        // Through scoped(): a contact this user cannot see is not matched,
        // exactly as the contacts list would not show it.
        const qb = this.contacts.scoped(actor).andWhere(
          new Brackets((w) => {
            w.where('1 = 0');
            if (emails.length)
              w.orWhere('LOWER(contact.email) IN (:...emails)', { emails });
            if (names.length) {
              w.orWhere(
                `LOWER(contact.firstName || ' ' || contact.lastName) IN (:...names)`,
                { names },
              );
            }
          }),
        );
        const found = await qb.getMany();
        found.forEach((c) =>
          add(
            c as unknown as Row,
            `${c.firstName} ${c.lastName}${c.email ? ` (${c.email})` : ''}`,
          ),
        );
        // A contact with an email is also found by name when the row has none.
        found
          .filter((c) => c.email)
          .forEach((c) => {
            const key = `name:${c.firstName.toLowerCase()} ${c.lastName.toLowerCase()}`;
            if (!index.has(key)) {
              index.set(key, {
                id: c.id,
                label: `${c.firstName} ${c.lastName}`,
                record: c as unknown as Row,
              });
            }
          });
        break;
      }
      case 'products': {
        const skus = lowerList(values.map((v) => v.sku));
        const found = await manager
          .getRepository(CatalogItem)
          .createQueryBuilder('i')
          .where('i.tenantId = :tenantId', { tenantId })
          .andWhere('LOWER(i.sku) IN (:...skus)', { skus })
          .getMany();
        found.forEach((i) => add(i as unknown as Row, `${i.sku} · ${i.name}`));
        break;
      }
      case 'materials': {
        const skus = lowerList(values.map((v) => v.sku));
        const names = lowerList(
          values.filter((v) => !v.sku).map((v) => v.name),
        );
        const found = await manager
          .getRepository(Material)
          .createQueryBuilder('m')
          .where('m.tenantId = :tenantId', { tenantId })
          .andWhere(
            new Brackets((w) => {
              w.where('1 = 0');
              if (skus.length)
                w.orWhere('LOWER(m.sku) IN (:...skus)', { skus });
              if (names.length)
                w.orWhere('LOWER(m.name) IN (:...names)', { names });
            }),
          )
          .getMany();
        found.forEach((m) =>
          add(m as unknown as Row, m.sku ? `${m.sku} · ${m.name}` : m.name),
        );
        found
          .filter((m) => m.sku)
          .forEach((m) => {
            const key = `name:${m.name.toLowerCase()}`;
            if (!index.has(key))
              index.set(key, {
                id: m.id,
                label: m.name,
                record: m as unknown as Row,
              });
          });
        break;
      }
      case 'work-centres': {
        const names = lowerList(values.map((v) => v.name));
        const found = await manager
          .getRepository(WorkCenter)
          .createQueryBuilder('w')
          .where('w.tenantId = :tenantId', { tenantId })
          .andWhere('LOWER(w.name) IN (:...names)', { names })
          .getMany();
        found.forEach((w) => add(w as unknown as Row, w.name));
        break;
      }
      case 'opening-stock': {
        // "Existing" here means the material already holds stock: an
        // opening count is for stock the books have never seen.
        const skus = lowerList(values.map((v) => v.sku));
        const held: {
          sku: string;
          name: string;
          material_id: string;
          qty: string;
        }[] = await manager.query(
          `SELECT m.sku, m.name, m.id AS material_id, SUM(s.qty_on_hand) AS qty
               FROM catalog_materials m
               JOIN stock_items s ON s.material_id = m.id AND s.tenant_id = m.tenant_id
              WHERE m.tenant_id = $1 AND m."deletedAt" IS NULL AND LOWER(m.sku) = ANY($2)
              GROUP BY m.sku, m.name, m.id
             HAVING SUM(s.qty_on_hand) <> 0`,
          [tenantId, skus],
        );
        held.forEach((h) =>
          index.set(`sku:${h.sku.toLowerCase()}`, {
            id: h.material_id,
            label: `${h.name} already has ${Number(h.qty)} in stock`,
            record: {},
          }),
        );
        break;
      }
    }
    return index;
  }

  /** Turns "Owner email" into a user of this organisation. */
  private async resolveOwners(actor: AuthenticatedUser, rows: PlannedRow[]) {
    const emails = lowerList(rows.map((r) => r.value!.ownerEmail));
    if (emails.length === 0) return;
    const users: { id: string; email: string }[] =
      await this.dataSource.manager.query(
        `SELECT id, LOWER(email) AS email FROM users WHERE tenant_id = $1 AND "isActive" AND LOWER(email) = ANY($2)`,
        [actor.organizationId, emails],
      );
    const byEmail = new Map(users.map((u) => [u.email, u.id]));
    for (const row of rows) {
      const email = text(row.value!.ownerEmail).toLowerCase();
      if (!email) continue;
      const id = byEmail.get(email);
      if (!id) {
        row.issues.push({
          field: 'ownerEmail',
          message: 'No active team member has this email',
        });
        continue;
      }
      row.value!.ownerId = id;
    }
  }

  /** Turns "Material SKU" into a material. */
  private async resolveMaterials(actor: AuthenticatedUser, rows: PlannedRow[]) {
    const skus = lowerList(rows.map((r) => r.value!.sku));
    const found = await this.dataSource.manager
      .getRepository(Material)
      .createQueryBuilder('m')
      .where('m.tenantId = :tenantId', { tenantId: actor.organizationId })
      .andWhere('LOWER(m.sku) IN (:...skus)', {
        skus: skus.length ? skus : [''],
      })
      .getMany();
    const bySku = new Map(found.map((m) => [m.sku!.toLowerCase(), m]));
    for (const row of rows) {
      const material = bySku.get(text(row.value!.sku).toLowerCase());
      if (!material) {
        row.issues.push({
          field: 'sku',
          message: 'No material has this SKU. Import materials first.',
        });
        continue;
      }
      row.value!.materialId = material.id;
    }
  }

  /* ---------------- Commit ---------------- */

  async commit(
    actor: AuthenticatedUser,
    entity: ImportEntity,
    file: UploadedFileLike | undefined,
    options: ImportOptionsPayload,
  ): Promise<ImportRunDto> {
    this.assertCanImport(actor, entity);
    const definition = IMPORT_DEFINITIONS[entity];
    const update = options.onDuplicate === 'update' && definition.canUpdate;
    if (update && !actor.permissions.includes(definition.updatePermission)) {
      throw new ForbiddenException(
        `You do not have permission to update ${definition.nounPlural}`,
      );
    }
    const plan = await this.plan(actor, entity, file, options.mapping);

    const failures: ImportFailure[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const work: PlannedRow[] = [];
    for (const row of plan.rows) {
      if (row.issues.length > 0 || !row.value) {
        failures.push({
          rowNumber: row.rowNumber,
          values: row.values,
          issues: row.issues,
        });
      } else if (row.existing && !update) {
        skipped++;
      } else {
        work.push(row);
      }
    }

    for (let start = 0; start < work.length; start += IMPORT_LIMITS.batchSize) {
      const batch = work.slice(start, start + IMPORT_LIMITS.batchSize);
      await this.dataSource.transaction(async (batchManager) => {
        for (const row of batch) {
          try {
            // A savepoint: a row that fails rolls back alone.
            await batchManager.transaction((em) =>
              this.write(em, actor, entity, row),
            );
            if (row.existing) updated++;
            else created++;
          } catch (e) {
            failures.push({
              rowNumber: row.rowNumber,
              values: row.values,
              issues: [{ field: null, message: this.reason(e) }],
            });
          }
        }
      });
    }

    failures.sort((a, b) => a.rowNumber - b.rowNumber);
    const run = await this.runs.save(
      this.runs.create({
        tenantId: actor.organizationId,
        entity,
        fileName: (file?.originalname ?? 'import').slice(0, 255),
        onDuplicate: update ? 'update' : 'skip',
        totalRows: plan.rows.length,
        created,
        updated,
        skipped,
        failed: failures.length,
        failures,
        createdById: actor.id,
      }),
    );
    return this.toDto(
      run,
      failures,
      `${actor.firstName} ${actor.lastName}`.trim(),
    );
  }

  /** Only the columns the file actually filled, so an update never blanks a field it did not mention. */
  private patch(row: PlannedRow, extra: string[] = []): Row {
    const out: Row = {};
    for (const key of [...Object.keys(row.values), ...extra]) {
      if (key in row.value!) out[key] = row.value![key];
    }
    return out;
  }

  private async write(
    em: EntityManager,
    actor: AuthenticatedUser,
    entity: ImportEntity,
    row: PlannedRow,
  ): Promise<void> {
    const tenantId = actor.organizationId;
    const value = row.value!;
    const existing = row.existing;
    switch (entity) {
      case 'customers': {
        const repo = em.getRepository(Customer);
        if (!existing) {
          await repo.save(
            repo.create({
              ...value,
              tenantId,
              vatStatus: resolveVatStatus(null, value),
            } as Partial<Customer>),
          );
          return;
        }
        const customer = await repo.findOneOrFail({
          where: { id: existing.id, tenantId },
        });
        const patch = this.patch(row);
        let taxId = customer.taxId;
        if ('country' in patch || 'taxId' in patch) {
          taxId = assertUaeTrn(
            'country' in patch
              ? (patch.country as string | null)
              : customer.country,
            'taxId' in patch ? (patch.taxId as string | null) : customer.taxId,
          );
        }
        Object.assign(customer, patch, {
          taxId,
          vatStatus: resolveVatStatus(customer, patch),
        });
        await repo.save(customer);
        return;
      }
      case 'contacts': {
        const repo = em.getRepository(Contact);
        const fields = { ...value };
        const requested = fields.ownerId;
        delete fields.ownerEmail;
        delete fields.ownerId;
        // Without the right to assign, a contact is the importer's own.
        const ownerId = await this.contacts.assignableOwner(
          actor,
          requested as string | undefined,
        );
        if (!existing) {
          await repo.save(
            repo.create({ ...fields, tenantId, ownerId } as Partial<Contact>),
          );
          return;
        }
        const contact = await repo.findOneOrFail({
          where: { id: existing.id, tenantId },
        });
        const patch = this.patch(row);
        delete patch.ownerEmail;
        if (requested && ownerId === requested) patch.ownerId = ownerId;
        Object.assign(contact, patch);
        await repo.save(contact);
        return;
      }
      case 'products': {
        const repo = em.getRepository(CatalogItem);
        if (!existing) {
          await repo.save(
            repo.create({ ...value, tenantId } as Partial<CatalogItem>),
          );
          return;
        }
        const item = await repo.findOneOrFail({
          where: { id: existing.id, tenantId },
        });
        Object.assign(item, this.patch(row));
        await repo.save(item);
        return;
      }
      case 'materials': {
        const repo = em.getRepository(Material);
        if (!existing) {
          await repo.save(
            repo.create({ ...value, tenantId } as Partial<Material>),
          );
          return;
        }
        const material = await repo.findOneOrFail({
          where: { id: existing.id, tenantId },
        });
        Object.assign(material, this.patch(row));
        if (
          material.uom === 'SHEET' &&
          (material.sheetWidthMm == null || material.sheetHeightMm == null)
        ) {
          throw new BadRequestException(
            'Sheet materials need a width and height',
          );
        }
        await repo.save(material);
        return;
      }
      case 'work-centres': {
        const repo = em.getRepository(WorkCenter);
        if (!existing) {
          await repo.save(
            repo.create({ ...value, tenantId } as Partial<WorkCenter>),
          );
          return;
        }
        const workCenter = await repo.findOneOrFail({
          where: { id: existing.id, tenantId },
        });
        Object.assign(workCenter, this.patch(row));
        await repo.save(workCenter);
        return;
      }
      case 'opening-stock': {
        // The same posting as an opening count on the Stock screen: stock in
        // at the stated cost, Dr Inventory / Cr Opening balance equity.
        await this.inventory.adjust(
          tenantId,
          actor.id,
          {
            materialId: value.materialId as string,
            kind: 'OPENING',
            qtyDelta: value.quantity as number,
            unitCost: value.unitCost as number,
            note: 'Opening stock (import)',
          },
          em,
        );
        return;
      }
    }
  }

  private reason(e: unknown): string {
    if (e instanceof BadRequestException || e instanceof NotFoundException) {
      const response = e.getResponse() as
        { message?: string | string[] } | string;
      const message =
        typeof response === 'string' ? response : response.message;
      return Array.isArray(message)
        ? message.join('; ')
        : (message ?? e.message);
    }
    if (
      e instanceof QueryFailedError &&
      (e.driverError as { code?: string })?.code === '23505'
    ) {
      return 'Another record already uses this name or code';
    }
    if (e instanceof Error && /TRN/.test(e.message)) return e.message;
    this.logger.warn(`Import row failed: ${(e as Error)?.message ?? e}`);
    return 'This row could not be saved';
  }

  /* ---------------- History and error files ---------------- */

  async list(actor: AuthenticatedUser): Promise<ImportRunDto[]> {
    const entities = this.allowedEntities(actor);
    if (entities.length === 0) return [];
    const runs = await this.runs.find({
      where: { tenantId: actor.organizationId, entity: In(entities) },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    const names = await this.userNames(runs.map((r) => r.createdById));
    return runs.map((r) =>
      this.toDto(r, [], names.get(r.createdById ?? '') ?? null),
    );
  }

  async findOne(actor: AuthenticatedUser, id: string): Promise<ImportRunDto> {
    const run = await this.runs
      .createQueryBuilder('run')
      .addSelect('run.failures')
      .where('run.tenantId = :tenantId', { tenantId: actor.organizationId })
      .andWhere('run.id = :id', { id })
      .getOne();
    if (!run || !this.allowedEntities(actor).includes(run.entity)) {
      throw new NotFoundException('Import not found');
    }
    const names = await this.userNames([run.createdById]);
    return this.toDto(
      run,
      run.failures ?? [],
      names.get(run.createdById ?? '') ?? null,
    );
  }

  /** The failed rows as they were uploaded, plus an "Errors" column. */
  async errorsFile(
    actor: AuthenticatedUser,
    id: string,
    format: 'csv' | 'xlsx',
  ): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const run = await this.findOne(actor, id);
    const fields = IMPORT_DEFINITIONS[run.entity].fields;
    const rows = [
      ['Row', ...fields.map((f) => f.label), 'Errors'],
      ...run.failures.map((f) => [
        String(f.rowNumber),
        ...fields.map((field) => f.values[field.key] ?? ''),
        f.issues
          .map((i) => {
            const label = fields.find((field) => field.key === i.field)?.label;
            return label && !i.message.startsWith(label)
              ? `${label}: ${i.message}`
              : i.message;
          })
          .join('; '),
      ]),
    ];
    const fileName = `kerf-${run.entity}-errors.${format}`;
    if (format === 'csv') {
      return {
        buffer: Buffer.from(`\uFEFF${stringify(rows)}`, 'utf8'),
        contentType: 'text/csv; charset=utf-8',
        fileName,
      };
    }
    return {
      buffer: await this.workbook('Errors', rows),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName,
    };
  }

  private async userNames(
    ids: (string | null)[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const rows: { id: string; name: string }[] =
      await this.dataSource.manager.query(
        `SELECT id, TRIM("firstName" || ' ' || "lastName") AS name FROM users WHERE id = ANY($1)`,
        [unique],
      );
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private toDto(
    run: ImportRun,
    failures: ImportFailure[],
    createdByName: string | null,
  ): ImportRunDto {
    return {
      id: run.id,
      entity: run.entity,
      fileName: run.fileName,
      onDuplicate: run.onDuplicate,
      totalRows: run.totalRows,
      created: run.created,
      updated: run.updated,
      skipped: run.skipped,
      failed: run.failed,
      failures,
      createdById: run.createdById,
      createdByName,
      createdAt: run.createdAt.toISOString(),
    };
  }
}
