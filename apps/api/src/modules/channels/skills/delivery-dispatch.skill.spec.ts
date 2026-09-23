import { PERMISSIONS } from '@saas/shared';
import { DeliveryDispatchSkill } from './delivery-dispatch.skill';
import type { DeliveryNotesService } from '../../orders/delivery-notes.service';
import type { OrdersService } from '../../orders/orders.service';
import type { SkillContext } from './skill.types';

describe('DeliveryDispatchSkill', () => {
  let deliveryNotesService: jest.Mocked<Partial<DeliveryNotesService>>;
  let ordersService: jest.Mocked<Partial<OrdersService>>;
  let skill: DeliveryDispatchSkill;

  const ctx: SkillContext = {
    organizationId: 'org-1',
    userId: 'user-1',
    provider: 'META_WHATSAPP' as any,
    senderIdentifier: '+1234567890',
    permissions: [PERMISSIONS.DELIVERY_NOTE_DISPATCH, PERMISSIONS.DELIVERY_NOTE_CREATE],
    message: 'dispatch DN-2026-0001',
  };

  beforeEach(() => {
    deliveryNotesService = {
      get: jest.fn(),
      listForOrder: jest.fn(),
      create: jest.fn(),
      dispatch: jest.fn(),
    };
    ordersService = {
      list: jest.fn(),
      get: jest.fn(),
    };
    skill = new DeliveryDispatchSkill(
      deliveryNotesService as unknown as DeliveryNotesService,
      ordersService as unknown as OrdersService,
    );
  });

  it('resolves an existing draft delivery note by number', async () => {
    deliveryNotesService.get = jest.fn().mockResolvedValue({
      id: 'dn-1',
      deliveryNoteNumber: 'DN-2026-0001',
      status: 'DRAFT',
      salesOrderId: 'so-1',
      customerName: 'Acme Corp',
      lines: [{ salesOrderLineId: 'sol-1', description: '350gsm board', qty: 100, uom: 'pcs' }],
    } as any);

    const res = await skill.resolve({ deliveryNoteNumber: 'DN-2026-0001' }, ctx);
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.mode).toBe('EXISTING_NOTE');
      expect(res.value.deliveryNoteNumber).toBe('DN-2026-0001');
      expect(res.value.customerName).toBe('Acme Corp');
      expect(res.value.lines).toHaveLength(1);
    }
  });

  it('refuses if the delivery note is already dispatched', async () => {
    deliveryNotesService.get = jest.fn().mockResolvedValue({
      id: 'dn-1',
      deliveryNoteNumber: 'DN-2026-0001',
      status: 'DISPATCHED',
      salesOrderId: 'so-1',
      customerName: 'Acme Corp',
      lines: [],
    } as any);

    const res = await skill.resolve({ deliveryNoteNumber: 'DN-2026-0001' }, ctx);
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain('already dispatched');
    }
  });

  it('refuses if the delivery note is cancelled', async () => {
    deliveryNotesService.get = jest.fn().mockResolvedValue({
      id: 'dn-1',
      deliveryNoteNumber: 'DN-2026-0001',
      status: 'CANCELLED',
      salesOrderId: 'so-1',
      customerName: 'Acme Corp',
      lines: [],
    } as any);

    const res = await skill.resolve({ deliveryNoteNumber: 'DN-2026-0001' }, ctx);
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain('already cancelled');
    }
  });

  it('refuses if the delivery note cannot be found', async () => {
    deliveryNotesService.get = jest.fn().mockRejectedValue(new Error('Not found'));
    ordersService.list = jest.fn().mockResolvedValue([]);

    const res = await skill.resolve({ deliveryNoteNumber: 'DN-2026-9999' }, { ...ctx, message: 'dispatch DN-2026-9999' });
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain("couldn't find delivery note DN-2026-9999");
    }
  });

  it('resolves directly from a sales order with open quantities', async () => {
    ordersService.list = jest.fn().mockResolvedValue([
      {
        id: 'so-1',
        orderNumber: 'SO-2026-0005',
        status: 'OPEN',
        customerName: 'Starlight Corp',
        lines: [{ id: 'sol-1', description: 'Brochures', qtyOrdered: 50, qtyFulfilled: 0, uom: 'pcs' }],
      } as any,
    ]);
    ordersService.get = jest.fn().mockResolvedValue({
      id: 'so-1',
      orderNumber: 'SO-2026-0005',
      status: 'OPEN',
      customerName: 'Starlight Corp',
      lines: [{ id: 'sol-1', description: 'Brochures', qtyOrdered: 50, qtyFulfilled: 0, uom: 'pcs' }],
    } as any);
    deliveryNotesService.listForOrder = jest.fn().mockResolvedValue([]);

    const res = await skill.resolve(
      { salesOrderNumber: 'SO-2026-0005' },
      { ...ctx, message: 'ship order SO-2026-0005' },
    );
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.mode).toBe('FROM_ORDER');
      expect(res.value.salesOrderNumber).toBe('SO-2026-0005');
      expect(res.value.customerName).toBe('Starlight Corp');
      expect(res.value.lines).toHaveLength(1);
      expect(res.value.lines[0].qty).toBe(50);
    }
  });

  it('refuses if the sales order is already CANCELLED, CLOSED, or FULFILLED', async () => {
    ordersService.list = jest.fn().mockResolvedValue([
      {
        id: 'so-1',
        orderNumber: 'SO-2026-0005',
        status: 'FULFILLED',
        customerName: 'Starlight Corp',
      } as any,
    ]);
    ordersService.get = jest.fn().mockResolvedValue({
      id: 'so-1',
      orderNumber: 'SO-2026-0005',
      status: 'FULFILLED',
      customerName: 'Starlight Corp',
      lines: [],
    } as any);

    const res = await skill.resolve(
      { salesOrderNumber: 'SO-2026-0005' },
      { ...ctx, message: 'ship order SO-2026-0005' },
    );
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain('already fulfilled');
    }
  });

  it('refuses if all lines on the sales order are already fulfilled or drafted', async () => {
    ordersService.list = jest.fn().mockResolvedValue([
      {
        id: 'so-1',
        orderNumber: 'SO-2026-0005',
        status: 'OPEN',
        customerName: 'Starlight Corp',
      } as any,
    ]);
    ordersService.get = jest.fn().mockResolvedValue({
      id: 'so-1',
      orderNumber: 'SO-2026-0005',
      status: 'OPEN',
      customerName: 'Starlight Corp',
      lines: [{ id: 'sol-1', description: 'Brochures', qtyOrdered: 50, qtyFulfilled: 50, uom: 'pcs' }],
    } as any);
    deliveryNotesService.listForOrder = jest.fn().mockResolvedValue([]);

    const res = await skill.resolve(
      { salesOrderNumber: 'SO-2026-0005' },
      { ...ctx, message: 'ship order SO-2026-0005' },
    );
    expect(res.kind).toBe('refused');
    if (res.kind === 'refused') {
      expect(res.reason).toContain('already been fulfilled or drafted');
    }
  });

  it('resolves by customer name when unique open order exists', async () => {
    ordersService.list = jest.fn().mockResolvedValue([
      {
        id: 'so-1',
        orderNumber: 'SO-2026-0007',
        status: 'OPEN',
        customerName: 'Acme Special Products',
      } as any,
    ]);
    ordersService.get = jest.fn().mockResolvedValue({
      id: 'so-1',
      orderNumber: 'SO-2026-0007',
      status: 'OPEN',
      customerName: 'Acme Special Products',
      lines: [{ id: 'sol-1', description: 'Labels', qtyOrdered: 100, qtyFulfilled: 0, uom: 'pcs' }],
    } as any);
    deliveryNotesService.listForOrder = jest.fn().mockResolvedValue([]);

    const res = await skill.resolve(
      { customerName: 'Acme' },
      { ...ctx, message: 'ship goods for Acme' },
    );
    expect(res.kind).toBe('resolved');
    if (res.kind === 'resolved') {
      expect(res.value.mode).toBe('FROM_ORDER');
      expect(res.value.salesOrderNumber).toBe('SO-2026-0007');
    }
  });

  it('asks which order if multiple orders match customer name', async () => {
    ordersService.list = jest.fn().mockResolvedValue([
      { id: 'so-1', orderNumber: 'SO-2026-0001', status: 'OPEN', customerName: 'Acme One' } as any,
      { id: 'so-2', orderNumber: 'SO-2026-0002', status: 'OPEN', customerName: 'Acme Two' } as any,
    ]);

    const res = await skill.resolve(
      { customerName: 'Acme' },
      { ...ctx, message: 'ship goods for Acme' },
    );
    expect(res.kind).toBe('question');
    if (res.kind === 'question') {
      expect(res.question).toContain('Found several open orders');
      expect(res.question).toContain('SO-2026-0001');
      expect(res.question).toContain('SO-2026-0002');
    }
  });

  it('asks for delivery note or sales order when neither is provided', async () => {
    ordersService.list = jest.fn().mockResolvedValue([]);

    const res = await skill.resolve({}, { ...ctx, message: 'ship it' });
    expect(res.kind).toBe('question');
    if (res.kind === 'question') {
      expect(res.question).toContain('Which delivery or order?');
    }
  });

  it('generates a clear preview and executes dispatch for EXISTING_NOTE', async () => {
    const resolved = {
      mode: 'EXISTING_NOTE' as const,
      deliveryNoteId: 'dn-1',
      deliveryNoteNumber: 'DN-2026-0001',
      salesOrderId: 'so-1',
      salesOrderNumber: 'SO-2026-0005',
      customerName: 'Acme Corp',
      lines: [{ salesOrderLineId: 'sol-1', description: '350gsm board', qty: 100, uom: 'pcs', hasStockMaterial: true }],
    };

    const preview = await skill.preview(resolved, ctx);
    expect(preview).toContain('DN-2026-0001');
    expect(preview).toContain('SO-2026-0005');
    expect(preview).toContain('100x 350gsm board');
    expect(preview).toContain('Reply YES to confirm or NO to cancel.');

    deliveryNotesService.dispatch = jest.fn().mockResolvedValue({
      id: 'dn-1',
      deliveryNoteNumber: 'DN-2026-0001',
      status: 'DISPATCHED',
    } as any);

    const outcome = await skill.execute(resolved, ctx);
    expect(outcome.resultType).toBe('DELIVERY_NOTE');
    expect(outcome.resultId).toBe('dn-1');
    expect(deliveryNotesService.dispatch).toHaveBeenCalledWith('org-1', 'dn-1', 'user-1');
  });

  it('generates a clear preview and creates then dispatches for FROM_ORDER', async () => {
    const resolved = {
      mode: 'FROM_ORDER' as const,
      salesOrderId: 'so-1',
      salesOrderNumber: 'SO-2026-0005',
      customerName: 'Starlight Corp',
      lines: [{ salesOrderLineId: 'sol-1', description: 'Brochures', qty: 50, uom: 'pcs', hasStockMaterial: false }],
    };

    const preview = await skill.preview(resolved, ctx);
    expect(preview).toContain('SO-2026-0005');
    expect(preview).toContain('50x Brochures');
    expect(preview).toContain('Reply YES to confirm or NO to cancel.');

    deliveryNotesService.create = jest.fn().mockResolvedValue({
      id: 'dn-new',
      deliveryNoteNumber: 'DN-2026-0003',
      status: 'DRAFT',
    } as any);
    deliveryNotesService.dispatch = jest.fn().mockResolvedValue({
      id: 'dn-new',
      deliveryNoteNumber: 'DN-2026-0003',
      status: 'DISPATCHED',
    } as any);

    const outcome = await skill.execute(resolved, ctx);
    expect(outcome.resultType).toBe('DELIVERY_NOTE');
    expect(outcome.resultId).toBe('dn-new');
    expect(deliveryNotesService.create).toHaveBeenCalledWith('org-1', 'user-1', 'so-1', {
      lines: [{ salesOrderLineId: 'sol-1', qty: 50 }],
      shipTo: null,
      carrier: null,
      trackingReference: null,
      notes: null,
    });
    expect(deliveryNotesService.dispatch).toHaveBeenCalledWith('org-1', 'dn-new', 'user-1');
  });
});
