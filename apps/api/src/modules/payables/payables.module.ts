import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceModule } from '../finance/finance.module';
import { TaxModule } from '../tax/tax.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { JournalEntry } from '../finance/entities/journal-entry.entity';
import { PurchaseOrder } from '../purchasing/entities/purchase-order.entity';
import { PurchaseOrderLine } from '../purchasing/entities/purchase-order-line.entity';
import { PurchasePolicyEntity } from '../purchasing/entities/purchase-policy.entity';
import { Supplier } from '../purchasing/entities/supplier.entity';
import {
  BillPayment,
  SupplierBill,
  SupplierBillLine,
} from './entities/supplier-bill.entity';
import { PayablesController } from './payables.controller';
import { PayablesService } from './payables.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SupplierBill,
      SupplierBillLine,
      BillPayment,
      Supplier,
      PurchaseOrder,
      PurchaseOrderLine,
      PurchasePolicyEntity,
      FinanceAccount,
      JournalEntry,
    ]),
    FinanceModule,
    TaxModule,
    NotificationsModule,
  ],
  controllers: [PayablesController],
  providers: [PayablesService],
  exports: [PayablesService],
})
export class PayablesModule {}
