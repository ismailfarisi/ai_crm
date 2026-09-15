import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceModule } from '../finance/finance.module';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { PurchaseOrder } from '../purchasing/entities/purchase-order.entity';
import { PurchaseOrderLine } from '../purchasing/entities/purchase-order-line.entity';
import { PurchasePolicyEntity } from '../purchasing/entities/purchase-policy.entity';
import {
  GoodsReceipt,
  GoodsReceiptLine,
} from './entities/goods-receipt.entity';
import { StockItem } from './entities/stock-item.entity';
import { StockLocation } from './entities/stock-location.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';

@Module({
  imports: [
    NotificationsModule,
    TypeOrmModule.forFeature([
      StockItem,
      StockMovement,
      StockLocation,
      GoodsReceipt,
      GoodsReceiptLine,
      PurchaseOrder,
      PurchaseOrderLine,
      PurchasePolicyEntity,
      JournalEntry,
    ]),
    FinanceModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
