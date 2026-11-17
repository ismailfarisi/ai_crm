import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { Customer } from '../customers/entities/customer.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { DocumentTemplate } from './entities/document-template.entity';
import { DocumentTemplatesController } from './document-templates.controller';
import { DocumentTemplatesService } from './document-templates.service';
import { DocumentLocalizationService } from './document-localization.service';
import { DocumentPdfRendererService } from './document-pdf-renderer.service';
import { DocumentTemplateAiService } from './document-template-ai.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentTemplate, Organization, Customer]),
    AiModule,
  ],
  controllers: [DocumentTemplatesController],
  providers: [
    DocumentTemplatesService,
    DocumentLocalizationService,
    DocumentPdfRendererService,
    DocumentTemplateAiService,
  ],
  exports: [
    DocumentTemplatesService,
    DocumentLocalizationService,
    DocumentPdfRendererService,
    DocumentTemplateAiService,
  ],
})
export class DocumentTemplatesModule {}
