import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomObjectDefinition } from './entities/custom-object-definition.entity';
import { CustomAttributeDefinition } from './entities/custom-attribute-definition.entity';
import { CustomRelationshipDefinition } from './entities/custom-relationship-definition.entity';
import { CustomRecord } from './entities/custom-record.entity';
import { CustomRecordLink } from './entities/custom-record-link.entity';
import { Customer } from '@/modules/customers/entities/customer.entity';
import { Contact } from '@/modules/contacts/entities/contact.entity';
import { Quote } from '@/modules/quotes/entities/quote.entity';
import { WorkOrder } from '@/modules/production/entities/work-order.entity';
import { CustomObjectsService } from './services/custom-objects.service';
import { CustomRecordsService } from './services/custom-records.service';
import { RecordValidationService } from './services/record-validation.service';
import { CoreEntityBridgeService } from './services/core-entity-bridge.service';
import { CustomObjectsController } from './controllers/custom-objects.controller';
import { CustomRecordsController } from './controllers/custom-records.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CustomObjectDefinition,
      CustomAttributeDefinition,
      CustomRelationshipDefinition,
      CustomRecord,
      CustomRecordLink,
      Customer,
      Contact,
      Quote,
      WorkOrder,
    ]),
  ],
  controllers: [CustomObjectsController, CustomRecordsController],
  providers: [
    CustomObjectsService,
    CustomRecordsService,
    RecordValidationService,
    CoreEntityBridgeService,
  ],
  exports: [
    CustomObjectsService,
    CustomRecordsService,
    CoreEntityBridgeService,
  ],
})
export class CustomObjectsModule {}
