import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository } from 'typeorm';
import type {
  CreatePurchaseOrderInput,
  CreateSupplierPayload,
  OriginMetadata,
  PaginatedResult,
  ReplaceSupplierMaterialsPayload,
  PurchaseOrderQueryPayload,
  SupplierQueryPayload,
  UpdateSupplierPayload,
} from '@saas/shared';
import {
  allocateNextSequenceValue,
  formatSequenceNumber,
} from '@/database/tenant-sequence.util';
import { Material } from '../catalog/entities/material.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { Supplier } from './entities/supplier.entity';
import { SupplierMaterial } from './entities/supplier-material.entity';
import type { MaterialDemand } from '../catalog/costing.service';
import { Organization } from '../organizations/entities/organization.entity';
import { MailService } from '../mail/mail.service';
import { PurchaseOrderPdfService } from './purchase-order-pdf.service';
import { PurchaseOrderLifecycleService } from './purchase-order-lifecycle.service';

/** Minimal escaping for the values interpolated into the supplier email. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One line of a proposed order, before anybody has agreed to it. */
export interface SuggestedPurchaseOrderLine {
  materialId: string;
  description: string;
  qtyOrdered: number;
  uom: string;
  unitCost: number;
  lineTotal: number;
  /** Set when the quantity was changed for the user, e.g. a minimum order. */
  note?: string;
}

export interface SuggestedPurchaseOrder {
  supplierId: string;
  supplierName: string;
  currency: string;
  leadTimeDays: number | null;
  lines: SuggestedPurchaseOrderLine[];
  totalAmount: number;
}

export interface UnsourcedDemand {
  materialId: string;
  materialName: string;
  uom: string;
  purchaseUnits: number;
  reason: string;
}

export interface PurchaseSuggestion {
  orders: SuggestedPurchaseOrder[];
  /** Demand nobody can be asked to fulfil yet. Never silently dropped. */
  unsourced: UnsourcedDemand[];
}

/** Money rounded to the cent; unit costs stay at 4dp until they are multiplied out. */
const money = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class PurchasingService {
  constructor(
    @InjectRepository(Supplier)
    private readonly suppliers: Repository<Supplier>,
    @InjectRepository(SupplierMaterial)
    private readonly supplierMaterials: Repository<SupplierMaterial>,
    @InjectRepository(PurchaseOrder)
    private readonly purchaseOrders: Repository<PurchaseOrder>,
    @InjectRepository(Material)
    private readonly materials: Repository<Material>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    private readonly mail: MailService,
    private readonly pdf: PurchaseOrderPdfService,
    private readonly lifecycle: PurchaseOrderLifecycleService,
  ) {}

  /* ------------------------------------------------------------------ *
   * Lookups
   *
   * Every one of these is tenant-scoped at the query, not filtered after.
   * They return *all* matches rather than a best guess — picking between
   * them is the caller's job, and for the chat layer that means asking.
   * ------------------------------------------------------------------ */

  async findSuppliersByName(
    tenantId: string,
    query: string,
  ): Promise<Supplier[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    return this.suppliers
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.deletedAt IS NULL')
      .andWhere('s.is_active = true')
      .andWhere('s.company_name ILIKE :q', { q: `%${trimmed}%` })
      .orderBy('length(s.company_name)', 'ASC')
      .limit(5)
      .getMany();
  }

  async findSupplierById(tenantId: string, id: string): Promise<Supplier> {
    const supplier = await this.suppliers.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
    });
    if (!supplier) throw new NotFoundException(`Supplier ${id} not found`);
    return supplier;
  }

  /**
   * Materials matching a phrase like "350gsm board".
   *
   * Scoped to a supplier when one is known, so "board" from Papertree does
   * not offer a material Papertree does not sell.
   */
  async findMaterialsByQuery(
    tenantId: string,
    query: string,
    supplierId?: string,
  ): Promise<Material[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const qb = this.materials
      .createQueryBuilder('m')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.deletedAt IS NULL')
      .andWhere('m.is_active = true')
      .andWhere(
        new Brackets((w) => {
          w.where('m.name ILIKE :q', { q: `%${trimmed}%` }).orWhere(
            'm.sku ILIKE :q',
            {
              q: `%${trimmed}%`,
            },
          );
        }),
      );

    if (supplierId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM supplier_materials sm
                  WHERE sm.material_id = m.id AND sm.supplier_id = :supplierId)`,
        { supplierId },
      );
    }

    return qb.orderBy('length(m.name)', 'ASC').limit(6).getMany();
  }

  async findMaterialById(
    tenantId: string,
    id: string,
  ): Promise<Material | null> {
    return this.materials.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
    });
  }

  async findSupplierPrice(
    tenantId: string,
    supplierId: string,
    materialId: string,
  ): Promise<SupplierMaterial | null> {
    return this.supplierMaterials.findOne({
      where: { tenantId, supplierId, materialId },
    });
  }

  /** The supplier to propose when a message names a material but no supplier. */
  async findPreferredSupplierFor(
    tenantId: string,
    materialId: string,
  ): Promise<{ supplier: Supplier; price: SupplierMaterial } | null> {
    const price = await this.supplierMaterials.findOne({
      where: { tenantId, materialId, isPreferred: true },
    });
    if (!price) return null;
    const supplier = await this.suppliers.findOne({
      where: { id: price.supplierId, tenantId, deletedAt: IsNull() },
    });
    return supplier ? { supplier, price } : null;
  }

  async findById(tenantId: string, id: string): Promise<PurchaseOrder> {
    const po = await this.purchaseOrders.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
    });
    if (!po) throw new NotFoundException(`Purchase order ${id} not found`);
    return po;
  }

  /* ------------------------------------------------------------------ *
   * Supplier CRUD
   * ------------------------------------------------------------------ */

  /**
   * Every query here filters on `tenantId` in the WHERE clause rather than
   * after the fetch — the same rule contacts follow. A raw find would leak
   * across tenants.
   */
  async listSuppliers(
    tenantId: string,
    query: SupplierQueryPayload,
  ): Promise<PaginatedResult<Supplier>> {
    const qb = this.suppliers
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.deletedAt IS NULL');

    if (!query.includeInactive) {
      qb.andWhere('s.is_active = true');
    }
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('s.company_name ILIKE :q', { q: `%${query.search}%` })
            .orWhere('s.contact_name ILIKE :q', { q: `%${query.search}%` })
            .orWhere('s.email ILIKE :q', { q: `%${query.search}%` });
        }),
      );
    }

    const sortColumn = {
      createdAt: 's.createdAt',
      updatedAt: 's.updatedAt',
      companyName: 's.company_name',
      country: 's.country',
    }[query.sortBy];

    const [data, total] = await qb
      .orderBy(sortColumn, query.sortOrder)
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    const totalPages = Math.ceil(total / query.limit) || 1;
    return {
      items: data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  }

  async createSupplier(
    tenantId: string,
    input: CreateSupplierPayload,
  ): Promise<Supplier> {
    const clash = await this.suppliers.findOne({
      where: { tenantId, companyName: input.companyName, deletedAt: IsNull() },
    });
    if (clash) {
      throw new ConflictException(
        `A supplier named "${input.companyName}" already exists`,
      );
    }
    return this.suppliers.save(this.suppliers.create({ ...input, tenantId }));
  }

  async updateSupplier(
    tenantId: string,
    id: string,
    input: UpdateSupplierPayload,
  ): Promise<Supplier> {
    const supplier = await this.findSupplierById(tenantId, id);
    if (input.companyName && input.companyName !== supplier.companyName) {
      const clash = await this.suppliers.findOne({
        where: {
          tenantId,
          companyName: input.companyName,
          deletedAt: IsNull(),
        },
      });
      if (clash) {
        throw new ConflictException(
          `A supplier named "${input.companyName}" already exists`,
        );
      }
    }
    Object.assign(supplier, input);
    return this.suppliers.save(supplier);
  }

  /**
   * Soft delete, and refused while the supplier has orders that are not
   * finished — a purchase order whose supplier has vanished is worse than a
   * supplier row nobody uses.
   */
  async deleteSupplier(tenantId: string, id: string): Promise<void> {
    const supplier = await this.findSupplierById(tenantId, id);
    const open = await this.purchaseOrders.count({
      where: [
        { tenantId, supplierId: id, status: 'DRAFT', deletedAt: IsNull() },
        {
          tenantId,
          supplierId: id,
          status: 'AWAITING_APPROVAL',
          deletedAt: IsNull(),
        },
        { tenantId, supplierId: id, status: 'APPROVED', deletedAt: IsNull() },
        { tenantId, supplierId: id, status: 'SENT', deletedAt: IsNull() },
        {
          tenantId,
          supplierId: id,
          status: 'PARTIALLY_RECEIVED',
          deletedAt: IsNull(),
        },
      ],
    });
    if (open > 0) {
      throw new ConflictException(
        `${supplier.companyName} has ${open} open purchase order(s). Cancel or complete them first, or mark the supplier inactive.`,
      );
    }
    await this.suppliers.softDelete({ id, tenantId });
  }

  /* ---- price list ---- */

  async listSupplierMaterials(
    tenantId: string,
    supplierId: string,
  ): Promise<SupplierMaterial[]> {
    await this.findSupplierById(tenantId, supplierId);
    return this.supplierMaterials.find({
      where: { tenantId, supplierId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Replaces a supplier's price list wholesale.
   *
   * `isPreferred` is unique per material across all suppliers — two preferred
   * suppliers for one material would make "order more board" ambiguous in a
   * way the chat layer cannot resolve — so setting it here clears it
   * elsewhere, in the same transaction.
   */
  async replaceSupplierMaterials(
    tenantId: string,
    supplierId: string,
    input: ReplaceSupplierMaterialsPayload,
  ): Promise<SupplierMaterial[]> {
    await this.findSupplierById(tenantId, supplierId);

    return this.supplierMaterials.manager.transaction(async (manager) => {
      const repo = manager.getRepository(SupplierMaterial);
      await repo.delete({ tenantId, supplierId });

      const saved: SupplierMaterial[] = [];
      for (const item of input.items) {
        if (item.isPreferred) {
          await repo.update(
            { tenantId, materialId: item.materialId },
            { isPreferred: false },
          );
        }
        saved.push(
          await repo.save(repo.create({ ...item, tenantId, supplierId })),
        );
      }
      return saved;
    });
  }

  /* ------------------------------------------------------------------ *
   * Purchase order queries and sending
   * ------------------------------------------------------------------ */

  async listPurchaseOrders(
    tenantId: string,
    query: PurchaseOrderQueryPayload,
  ): Promise<PaginatedResult<PurchaseOrder>> {
    const qb = this.purchaseOrders
      .createQueryBuilder('po')
      .leftJoinAndSelect('po.lines', 'line')
      .where('po.tenant_id = :tenantId', { tenantId })
      .andWhere('po.deletedAt IS NULL');

    if (query.status)
      qb.andWhere('po.status = :status', { status: query.status });
    if (query.supplierId) {
      qb.andWhere('po.supplier_id = :supplierId', {
        supplierId: query.supplierId,
      });
    }
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('po.po_number ILIKE :q', { q: `%${query.search}%` }).orWhere(
            'po.supplier_name ILIKE :q',
            { q: `%${query.search}%` },
          );
        }),
      );
    }

    const sortColumn = {
      createdAt: 'po.createdAt',
      orderDate: 'po.order_date',
      expectedDate: 'po.expected_date',
      totalAmount: 'po.total_amount',
    }[query.sortBy];

    const [items, total] = await qb
      .orderBy(sortColumn, query.sortOrder)
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    const totalPages = Math.ceil(total / query.limit) || 1;
    return {
      items,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  }

  async renderPdf(
    tenantId: string,
    orderId: string,
  ): Promise<{ order: PurchaseOrder; pdf: Buffer }> {
    const order = await this.findById(tenantId, orderId);
    const supplier = await this.suppliers.findOne({
      where: { id: order.supplierId, tenantId },
    });
    const organization = await this.organizations.findOne({
      where: { id: tenantId },
    });
    const pdf = await this.pdf.generate(
      order,
      supplier,
      organization?.name ?? 'Your company',
    );
    return { order, pdf };
  }

  /**
   * Emails the order to the supplier and marks it sent.
   *
   * The status moves only after the mail provider has accepted it. Marking
   * first and mailing second would leave an order recorded as sent that the
   * supplier never received, which is the failure that actually costs money.
   */
  async sendToSupplier(
    tenantId: string,
    orderId: string,
  ): Promise<PurchaseOrder> {
    const { order, pdf } = await this.renderPdf(tenantId, orderId);

    if (order.status !== 'APPROVED') {
      throw new BadRequestException(
        `${order.poNumber} is ${order.status.toLowerCase().replace(/_/g, ' ')} and has not been approved for sending.`,
      );
    }

    const supplier = await this.findSupplierById(tenantId, order.supplierId);
    if (!supplier.email) {
      throw new BadRequestException(
        `${supplier.companyName} has no email address on file to send the order to.`,
      );
    }

    const organization = await this.organizations.findOne({
      where: { id: tenantId },
    });
    const from = organization?.name ?? 'our team';

    await this.mail.sendMail({
      to: supplier.email,
      subject: `Purchase order ${order.poNumber}`,
      html: `<p>Hi ${escapeHtml(supplier.contactName ?? supplier.companyName)},</p><p>Please find attached purchase order <strong>${escapeHtml(order.poNumber)}</strong> for ${escapeHtml(order.totalAmount.toFixed(2))} ${escapeHtml(order.currency)}.</p><p>Thanks,<br>${escapeHtml(from)}</p>`,
      text: `Hi ${supplier.contactName ?? supplier.companyName},

Please find attached purchase order ${order.poNumber} for ${order.totalAmount.toFixed(2)} ${order.currency}.

Thanks,
${from}`,
      attachments: [
        {
          filename: `${order.poNumber}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });

    return this.lifecycle.markSent(tenantId, orderId);
  }

  /* ------------------------------------------------------------------ *
   * Suggestion
   * ------------------------------------------------------------------ */

  /**
   * Draft purchase order lines for the stock a quote will consume.
   *
   * This is what `MaterialCostLine.purchaseUnits` was always for. The costing
   * engine has computed it on every quote since the catalog shipped — 129
   * sheets, 1000 magnets at two per box — and nothing has ever read it.
   *
   * Grouped by supplier, because one quote usually needs board from one
   * merchant and fixings from another, and those are two orders. A material
   * with no preferred supplier is returned separately rather than guessed at:
   * picking a supplier on someone's behalf is how the wrong company gets an
   * order.
   */
  async suggestFromQuote(
    tenantId: string,
    demand: MaterialDemand[],
  ): Promise<PurchaseSuggestion> {
    const groups = new Map<string, SuggestedPurchaseOrder>();
    const unsourced: UnsourcedDemand[] = [];

    for (const item of demand) {
      const preferred = await this.findPreferredSupplierFor(
        tenantId,
        item.materialId,
      );
      if (!preferred) {
        unsourced.push({
          materialId: item.materialId,
          materialName: item.materialName,
          uom: item.uom,
          purchaseUnits: item.purchaseUnits,
          reason: 'No preferred supplier is set for this material.',
        });
        continue;
      }

      const { supplier, price } = preferred;
      const group =
        groups.get(supplier.id) ??
        ({
          supplierId: supplier.id,
          supplierName: supplier.companyName,
          currency: supplier.currency ?? 'USD',
          leadTimeDays: supplier.leadTimeDays,
          lines: [],
          totalAmount: 0,
        } satisfies SuggestedPurchaseOrder);

      // Round up to the supplier's minimum, and say so — a silent bump would
      // make the total disagree with the quantity the user asked for.
      let qty = item.purchaseUnits;
      let note: string | undefined;
      if (price.minOrderQty != null && qty < price.minOrderQty) {
        note = `Raised to ${supplier.companyName}'s minimum order of ${price.minOrderQty}`;
        qty = price.minOrderQty;
      }

      group.lines.push({
        materialId: item.materialId,
        description: item.materialName,
        qtyOrdered: qty,
        uom: item.uom,
        unitCost: price.unitCost,
        lineTotal: money(qty * price.unitCost),
        note,
      });
      group.totalAmount = money(
        group.lines.reduce((sum, l) => sum + l.lineTotal, 0),
      );
      groups.set(supplier.id, group);
    }

    return { orders: [...groups.values()], unsourced };
  }

  /* ------------------------------------------------------------------ *
   * Creation
   * ------------------------------------------------------------------ */

  /**
   * Raises a purchase order in `DRAFT`.
   *
   * There is deliberately no way to create one in any other state. Raising an
   * order and authorising it are separate acts, and keeping creation to a
   * single entry point is what stops a second front door — the chat layer —
   * from acquiring its own, laxer rules.
   */
  async createPurchaseOrder(
    tenantId: string,
    userId: string,
    input: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrder> {
    if (!input.lines?.length) {
      throw new BadRequestException('A purchase order needs at least one line');
    }
    for (const line of input.lines) {
      if (!(line.qtyOrdered > 0)) {
        throw new BadRequestException(
          `Quantity for "${line.description}" must be above zero`,
        );
      }
      if (line.unitCost < 0) {
        throw new BadRequestException(
          `Unit cost for "${line.description}" cannot be negative`,
        );
      }
    }

    const supplier = await this.findSupplierById(tenantId, input.supplierId);

    return this.purchaseOrders.manager.transaction(async (manager) => {
      const sequenceValue = await allocateNextSequenceValue(
        manager,
        tenantId,
        'purchase_order_number',
      );
      const poNumber = formatSequenceNumber('PO', sequenceValue);

      const lines = input.lines.map((line) =>
        manager.create(PurchaseOrderLine, {
          tenantId,
          materialId: line.materialId ?? null,
          description: line.description,
          qtyOrdered: line.qtyOrdered,
          qtyReceived: 0,
          uom: line.uom,
          unitCost: line.unitCost,
          lineTotal: money(line.qtyOrdered * line.unitCost),
        }),
      );

      const subtotal = money(lines.reduce((sum, l) => sum + l.lineTotal, 0));
      const origin: OriginMetadata = input.originMetadata ?? {
        origin: 'HUMAN',
      };

      const expectedDate =
        input.expectedDate ??
        (supplier.leadTimeDays != null
          ? new Date(Date.now() + supplier.leadTimeDays * 24 * 60 * 60 * 1000)
          : null);

      const po = manager.create(PurchaseOrder, {
        tenantId,
        poNumber,
        supplierId: supplier.id,
        supplierName: supplier.companyName,
        status: 'DRAFT' as const,
        currency: supplier.currency ?? 'USD',
        orderDate: new Date(),
        expectedDate,
        subtotalAmount: subtotal,
        totalAmount: subtotal,
        notes: input.notes ?? null,
        origin: origin.origin,
        originChannel: origin.originChannel ?? null,
        originMessageId: origin.originMessageId ?? null,
        originModel: origin.model ?? null,
        originPromptVersion: origin.promptVersion ?? null,
        createdById: userId,
        lines,
      });

      return manager.save(PurchaseOrder, po);
    });
  }
}
