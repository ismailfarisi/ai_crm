import { DEFAULT_DOCUMENT_TEMPLATE_CONFIG } from '@saas/shared';
import { PackingSlipPdfService } from './packing-slip-pdf.service';
import {
  DeliveryNote,
  DeliveryNoteLine,
} from '../credits/entities/credit-note.entity';
import { SalesOrder } from './entities/sales-order.entity';
import { DocumentTemplatesService } from '../document-templates/document-templates.service';
import { DocumentPdfRendererService } from '../document-templates/document-pdf-renderer.service';
import { DocumentLocalizationService } from '../document-templates/document-localization.service';
import { Organization } from '../organizations/entities/organization.entity';
import { Repository } from 'typeorm';

describe('PackingSlipPdfService', () => {
  let service: PackingSlipPdfService;
  let pdfRenderer: jest.Mocked<Partial<DocumentPdfRendererService>>;
  let documentTemplatesService: jest.Mocked<Partial<DocumentTemplatesService>>;
  let orgRepo: jest.Mocked<Partial<Repository<Organization>>>;

  const tenantId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    pdfRenderer = {
      render: jest
        .fn()
        .mockResolvedValue(Buffer.from('%PDF-1.4 mock packing slip')),
    };
    documentTemplatesService = {
      resolveForDocumentType: jest.fn().mockResolvedValue({
        id: 'tmpl-del-1',
        name: 'Delivery Note Template',
        config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      } as any),
    };
    orgRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: tenantId,
        name: 'Relay Logistics',
      }),
    };

    service = new PackingSlipPdfService(
      pdfRenderer as DocumentPdfRendererService,
      documentTemplatesService as DocumentTemplatesService,
      orgRepo as unknown as Repository<Organization>,
    );
  });

  it('delegates to DocumentPdfRendererService and DocumentTemplatesService', async () => {
    const note = {
      id: 'dn-1',
      tenantId,
      deliveryNoteNumber: 'DN-2026-0001',
      customerName: 'Wayne Enterprises',
      shipTo: '100 Gotham Way',
      carrier: 'Wayne Air',
      trackingReference: 'TRK-12345',
      status: 'DISPATCHED',
      dispatchedAt: new Date('2026-03-01'),
      notes: 'Fragile package',
    } as unknown as DeliveryNote;

    const lines = [
      {
        salesOrderLineId: 'line-1',
        description: 'Corrugated Box',
        qty: 50,
        uom: 'pcs',
      } as DeliveryNoteLine,
    ];

    const order = {
      orderNumber: 'SO-2026-0001',
    } as SalesOrder;

    const buffer = await service.generate(
      note,
      lines,
      order,
      'Relay Logistics',
    );

    expect(
      documentTemplatesService.resolveForDocumentType,
    ).toHaveBeenCalledWith(tenantId, 'DELIVERY_NOTE');
    expect(pdfRenderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'DELIVERY_NOTE',
        number: 'DN-2026-0001',
        party: expect.objectContaining({
          name: 'Wayne Enterprises',
          address: '100 Gotham Way',
        }),
        secondaryParty: expect.objectContaining({
          carrier: 'Wayne Air',
          trackingReference: 'TRK-12345',
        }),
        items: expect.arrayContaining([
          expect.objectContaining({
            description: 'Corrugated Box (pcs)',
            quantity: 50,
          }),
        ]),
      }),
      expect.anything(),
    );
    expect(buffer).toEqual(Buffer.from('%PDF-1.4 mock packing slip'));
  });

  it("prints the quote line's Arabic description on each delivery line", async () => {
    const localization = {
      orderLineDescriptionsAr: jest
        .fn()
        .mockResolvedValue(new Map([['line-1', 'صندوق مموج']])),
      localize: jest.fn(async (_t, _c, doc) => ({
        ...doc,
        language: 'ar',
        party: { ...doc.party, nameAr: 'حلويات النور', addressAr: 'دبي' },
      })),
    };
    service = new PackingSlipPdfService(
      pdfRenderer as DocumentPdfRendererService,
      documentTemplatesService as DocumentTemplatesService,
      orgRepo as unknown as Repository<Organization>,
      localization as unknown as DocumentLocalizationService,
    );
    const note = {
      id: 'dn-1',
      tenantId,
      deliveryNoteNumber: 'DN-2026-0002',
      customerName: 'Al Noor Sweets',
      shipTo: 'Warehouse 4, Al Quoz',
      status: 'DISPATCHED',
    } as unknown as DeliveryNote;
    const lines = [
      { salesOrderLineId: 'line-1', description: 'Box', qty: 5, uom: null },
      { salesOrderLineId: 'line-2', description: 'Lid', qty: 5, uom: null },
    ] as DeliveryNoteLine[];
    const order = {
      orderNumber: 'SO-1',
      quoteId: 'quote-1',
      customerId: 'cust-1',
    } as SalesOrder;

    await service.generate(note, lines, order, 'Relay Logistics');

    expect(localization.orderLineDescriptionsAr).toHaveBeenCalledWith(
      tenantId,
      'quote-1',
      ['line-1', 'line-2'],
    );
    const doc = (pdfRenderer.render as jest.Mock).mock.calls[0][0];
    expect(doc.items[0]).toMatchObject({
      description: 'Box',
      descriptionAr: 'صندوق مموج',
    });
    expect(doc.items[1].descriptionAr).toBeUndefined();
    expect(doc.items[0].code).toBeUndefined();
    expect(doc.party).toMatchObject({
      nameAr: 'حلويات النور',
      address: 'Warehouse 4, Al Quoz',
    });
    expect(doc.party.addressAr).toBeUndefined();
  });
});
