import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanceModule } from '../finance/finance.module';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { Invoice } from '../quotes/entities/invoice.entity';
import { TaxCode } from '../tax/entities/tax.entity';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';
import {
  CreditNote,
  CreditNoteLine,
  CreditNoteRefund,
} from './entities/credit-note.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CreditNote,
      CreditNoteLine,
      CreditNoteRefund,
      Invoice,
      FinanceAccount,
      TaxCode,
    ]),
    FinanceModule,
  ],
  controllers: [CreditNotesController],
  providers: [CreditNotesService],
  exports: [CreditNotesService],
})
export class CreditsModule {}
