import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Material } from '../catalog/entities/material.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { Supplier } from './entities/supplier.entity';
import { SupplierMaterial } from './entities/supplier-material.entity';
import { PurchasingService } from './purchasing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Supplier,
      SupplierMaterial,
      PurchaseOrder,
      PurchaseOrderLine,
      Material,
    ]),
  ],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
