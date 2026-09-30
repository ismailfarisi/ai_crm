import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PERMISSIONS,
  generateTemplateAiSchema,
  type GenerateTemplateAiInput,
  type DocumentTemplateConfig,
} from '@saas/shared';
import { CurrentUser, RequirePermissions } from '@/common/decorators';
import { zodBody } from '@/common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { DocumentTemplatesService } from './document-templates.service';
import { DocumentTemplate } from './entities/document-template.entity';
import {
  createDocumentTemplateSchema,
  updateDocumentTemplateSchema,
  setDefaultTemplateSchema,
  previewTemplatePdfSchema,
  type CreateDocumentTemplateDto,
  type UpdateDocumentTemplateDto,
  type SetDefaultTemplateDto,
  type PreviewTemplatePdfDto,
} from './dto/document-template.dto';

@ApiTags('document-templates')
@Controller('settings/document-templates')
export class DocumentTemplatesController {
  constructor(
    private readonly templatesService: DocumentTemplatesService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.DOCUMENT_TEMPLATE_READ)
  @ApiOperation({ summary: 'List all document templates for current organization' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DocumentTemplate[]> {
    return this.templatesService.findAll(user.organizationId);
  }

  @Post('generate-ai')
  @RequirePermissions(PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Generate or refine template configuration using AI' })
  async generateAi(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(generateTemplateAiSchema)) body: GenerateTemplateAiInput,
  ): Promise<DocumentTemplateConfig> {
    return this.templatesService.generateAi(
      user.organizationId,
      user.id,
      body.prompt,
      body.baseConfig,
    );
  }

  @Post('preview-pdf')
  @RequirePermissions(PERMISSIONS.DOCUMENT_TEMPLATE_READ)
  @ApiOperation({ summary: 'Generate sample PDF preview for template configuration' })
  async previewPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(previewTemplatePdfSchema)) body: PreviewTemplatePdfDto,
    @Res() res: Response,
  ): Promise<void> {
    const docType = body.documentType || 'INVOICE';
    const buffer = await this.templatesService.previewPdf(
      user.organizationId,
      body.config,
      docType,
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="preview-${docType.toLowerCase()}.pdf"`,
    );
    res.end(buffer);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENT_TEMPLATE_READ)
  @ApiOperation({ summary: 'Get a document template by ID' })
  async findById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentTemplate> {
    return this.templatesService.findById(user.organizationId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Create a new document template' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createDocumentTemplateSchema)) body: CreateDocumentTemplateDto,
  ): Promise<DocumentTemplate> {
    return this.templatesService.create(user.organizationId, user.id, body);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Update an existing document template' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateDocumentTemplateSchema)) body: UpdateDocumentTemplateDto,
  ): Promise<DocumentTemplate> {
    return this.templatesService.update(user.organizationId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Delete a document template' })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.templatesService.delete(user.organizationId, id);
  }

  @Post(':id/set-default')
  @RequirePermissions(PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE)
  @ApiOperation({ summary: 'Designate template as default for document types' })
  async setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(setDefaultTemplateSchema)) body: SetDefaultTemplateDto,
  ): Promise<DocumentTemplate> {
    const docTypes = body.documentTypes || body.appliesTo || [];
    return this.templatesService.setDefault(user.organizationId, id, docTypes);
  }
}
