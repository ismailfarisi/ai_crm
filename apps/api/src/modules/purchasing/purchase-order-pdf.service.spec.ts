import { DEFAULT_DOCUMENT_TEMPLATE_CONFIG } from '@saas/shared';
import { PurchaseOrderPdfService } from './purchase-order-pdf.service';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { Supplier } from './entities/supplier.entity';
import { DocumentTemplatesService } from '../document-templates/document-templates.service';
import { DocumentPdfRendererService } from '../document-templates/document-pdf-renderer.service';
import { Organization } from '../organizations/entities/organization.entity';
import { Repository } from 'typeorm';

describe('PurchaseOrderPdfService', () => {
  let service: PurchaseOrderPdfService;
  let pdfRenderer: jest.Mocked<Partial<DocumentPdfRendererService>>;
  let documentTemplatesService: jest.Mocked<Partial<DocumentTemplatesService>>;
  let orgRepo: jest.Mocked<Partial<Repository<Organization>>>;

  const tenantId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    pdfRenderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock purchase order')),
    };
    documentTemplatesService = {
      resolveForDocumentType: jest.fn().mockResolvedValue({
        id: 'tmpl-po-1',
        name: 'Purchase Order Template',
        config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      } as any),
    };
    orgRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: tenantId,
        name: 'Acme Packaging',
      }),
    };

    service = new PurchaseOrderPdfService(
      pdfRenderer as DocumentPdfRendererService,
      documentTemplatesService as DocumentTemplatesService,
      orgRepo as unknown as Repository<Organization>,
    );
  });

  it('delegates to DocumentPdfRendererService and DocumentTemplatesService', async () => {
    const order = {
      id: 'po-1',
      tenantId,
      poNumber: 'PO-2026-0001',
      supplierName: 'Paper Supply Co',
      status: 'APPROVED',
      orderDate: new Date('2026-03-01'),
      currency: 'USD',
      subtotalAmount: 1000,
      totalAmount: 1000,
      lines: [
        {
          materialId: 'mat-1',
          description: 'Kraft Paper',
          qtyOrdered: 100,
          unitCost: 10,
          lineTotal: 1000,
          uom: 'roll',
        },
      ],
    } as unknown as PurchaseOrder;

    const supplier = {
      id: 'sup-1',
      companyName: 'Paper Supply Co',
      email: 'orders@papersupply.com',
      phone: '+1 555-0199',
    } as Supplier;

    const buffer = await service.generate(order, supplier, 'Acme Packaging');

    expect(documentTemplatesService.resolveForDocumentType).toHaveBeenCalledWith(
      tenantId,
      'PURCHASE_ORDER',
    );
    expect(pdfRenderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PURCHASE_ORDER',
        number: 'PO-2026-0001',
        status: 'APPROVED',
        party: expect.objectContaining({
          name: 'Paper Supply Co',
          email: 'orders@papersupply.com',
        }),
        items: expect.arrayContaining([
          expect.objectContaining({
            description: 'Kraft Paper (roll)',
            quantity: 100,
            unitPrice: 10,
            amount: 1000,
          }),
        ]),
        totals: expect.objectContaining({
          total: 1000,
        }),
      }),
      DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
    );
    expect(buffer).toEqual(Buffer.from('%PDF-1.4 mock purchase order'));
  });
});
