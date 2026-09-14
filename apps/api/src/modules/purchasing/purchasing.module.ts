import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Material } from '../catalog/entities/material.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { PurchasePolicyEntity } from './entities/purchase-policy.entity';
import { PurchaseOrderLifecycleService } from './purchase-order-lifecycle.service';
import { PurchaseOrderPdfService } from './purchase-order-pdf.service';
import { MailModule } from '../mail/mail.module';
import { CatalogModule } from '../catalog/catalog.module';
import { QuotesModule } from '../quotes/quotes.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { Supplier } from './entities/supplier.entity';
import { SupplierMaterial } from './entities/supplier-material.entity';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Supplier,
      SupplierMaterial,
      PurchaseOrder,
      PurchaseOrderLine,
      Material,
      Organization,
      PurchasePolicyEntity,
    ]),
    MailModule,
    CatalogModule,
    QuotesModule,
    InventoryModule,
  ],
  controllers: [PurchasingController],
  providers: [
    PurchasingService,
    PurchaseOrderLifecycleService,
    PurchaseOrderPdfService,
  ],
  exports: [PurchasingService, PurchaseOrderLifecycleService],
})
export class PurchasingModule {}
