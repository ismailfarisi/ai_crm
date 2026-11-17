import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactsModule } from '../contacts/contacts.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ImportRun } from './entities/import-run.entity';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportRun]),
    ContactsModule,
    InventoryModule,
  ],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
