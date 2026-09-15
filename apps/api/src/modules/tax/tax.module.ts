import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogItem } from '../catalog/entities/catalog-item.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CreditNote } from '../credits/entities/credit-note.entity';
import { SupplierBill } from '../payables/entities/supplier-bill.entity';
import { Supplier } from '../purchasing/entities/supplier.entity';
import { Invoice } from '../quotes/entities/invoice.entity';
import { TaxCode, TaxRule } from './entities/tax.entity';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';

/**
 * Depends on entities only, never on the modules that own them: quotes,
 * payables and credits all call into tax, so tax importing any of them would
 * be a cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaxCode,
      TaxRule,
      Customer,
      Supplier,
      CatalogItem,
      Invoice,
      CreditNote,
      SupplierBill,
    ]),
  ],
  controllers: [TaxController],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}
