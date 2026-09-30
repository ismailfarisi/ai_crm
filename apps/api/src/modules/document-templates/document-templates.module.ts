import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { Organization } from '../organizations/entities/organization.entity';
import { DocumentTemplate } from './entities/document-template.entity';
import { DocumentTemplatesController } from './document-templates.controller';
import { DocumentTemplatesService } from './document-templates.service';
import { DocumentPdfRendererService } from './document-pdf-renderer.service';
import { DocumentTemplateAiService } from './document-template-ai.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentTemplate, Organization]),
    AiModule,
  ],
  controllers: [DocumentTemplatesController],
  providers: [
    DocumentTemplatesService,
    DocumentPdfRendererService,
    DocumentTemplateAiService,
  ],
  exports: [
    DocumentTemplatesService,
    DocumentPdfRendererService,
    DocumentTemplateAiService,
  ],
})
export class DocumentTemplatesModule {}
