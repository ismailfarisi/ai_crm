import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { Attachment } from './entities/attachment.entity';
import { StorageService } from './storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([Attachment, User])],
  controllers: [AttachmentsController],
  providers: [AttachmentsService, StorageService],
  exports: [StorageService, AttachmentsService],
})
export class StorageModule {}
