import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS,
  DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
  DocumentType,
} from '@saas/shared';
import { PERMISSIONS_KEY } from '@/common/decorators';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';
import { DocumentTemplatesController } from './document-templates.controller';
import { DocumentTemplatesService } from './document-templates.service';

describe('DocumentTemplatesController', () => {
  let controller: DocumentTemplatesController;
  let mockService: Partial<DocumentTemplatesService>;
  const reflector = new Reflector();

  const actor: AuthenticatedUser = {
    id: 'user-admin',
    organizationId: 'org-111',
    email: 'admin@acme.example.com',
    firstName: 'Admin',
    lastName: 'User',
    roles: ['admin'],
    level: 10,
    permissions: [],
    isOwner: false,
    teamId: null,
    managerId: null,
  };

  beforeEach(() => {
    mockService = {
      findAll: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue({ id: 'tmpl-1' }),
      create: jest.fn().mockResolvedValue({ id: 'tmpl-1' }),
      update: jest.fn().mockResolvedValue({ id: 'tmpl-1' }),
      delete: jest.fn().mockResolvedValue(undefined),
      setDefault: jest.fn().mockResolvedValue({ id: 'tmpl-1', isDefault: true }),
      generateAi: jest.fn().mockResolvedValue(DEFAULT_DOCUMENT_TEMPLATE_CONFIG),
      previewPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test preview')),
    };

    controller = new DocumentTemplatesController(
      mockService as DocumentTemplatesService,
    );
  });

  describe('RBAC & Route Metadata', () => {
    it('should protect findAll with DOCUMENT_TEMPLATE_READ', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.findAll,
      );
      expect(perms).toEqual([PERMISSIONS.DOCUMENT_TEMPLATE_READ]);
    });

    it('should protect findById with DOCUMENT_TEMPLATE_READ', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.findById,
      );
      expect(perms).toEqual([PERMISSIONS.DOCUMENT_TEMPLATE_READ]);
    });

    it('should protect create with DOCUMENT_TEMPLATE_MANAGE', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.create,
      );
      expect(perms).toEqual([PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE]);
    });

    it('should protect update with DOCUMENT_TEMPLATE_MANAGE', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.update,
      );
      expect(perms).toEqual([PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE]);
    });

    it('should protect delete with DOCUMENT_TEMPLATE_MANAGE', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.delete,
      );
      expect(perms).toEqual([PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE]);
    });

    it('should protect setDefault with DOCUMENT_TEMPLATE_MANAGE', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.setDefault,
      );
      expect(perms).toEqual([PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE]);
    });

    it('should protect generateAi with DOCUMENT_TEMPLATE_MANAGE', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.generateAi,
      );
      expect(perms).toEqual([PERMISSIONS.DOCUMENT_TEMPLATE_MANAGE]);
    });

    it('should protect previewPdf with DOCUMENT_TEMPLATE_READ', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.previewPdf,
      );
      expect(perms).toEqual([PERMISSIONS.DOCUMENT_TEMPLATE_READ]);
    });
  });

  describe('Controller delegations', () => {
    it('findAll delegates to service.findAll with tenant organizationId', async () => {
      await controller.findAll(actor);
      expect(mockService.findAll).toHaveBeenCalledWith('org-111');
    });

    it('findById delegates to service.findById with tenant organizationId and id', async () => {
      await controller.findById(actor, 'tmpl-1');
      expect(mockService.findById).toHaveBeenCalledWith('org-111', 'tmpl-1');
    });

    it('create delegates to service.create with tenant organizationId, userId and body', async () => {
      const body = {
        name: 'New Template',
        config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      };
      await controller.create(actor, body);
      expect(mockService.create).toHaveBeenCalledWith(
        'org-111',
        'user-admin',
        body,
      );
    });

    it('update delegates to service.update with tenant organizationId, id and body', async () => {
      const body = { name: 'Renamed Template' };
      await controller.update(actor, 'tmpl-1', body);
      expect(mockService.update).toHaveBeenCalledWith('org-111', 'tmpl-1', body);
    });

    it('delete delegates to service.delete with tenant organizationId and id', async () => {
      await controller.delete(actor, 'tmpl-1');
      expect(mockService.delete).toHaveBeenCalledWith('org-111', 'tmpl-1');
    });

    it('setDefault delegates to service.setDefault with documentTypes', async () => {
      const body = { documentTypes: ['INVOICE' as DocumentType] };
      await controller.setDefault(actor, 'tmpl-1', body);
      expect(mockService.setDefault).toHaveBeenCalledWith('org-111', 'tmpl-1', [
        'INVOICE',
      ]);
    });

    it('setDefault accepts appliesTo as alias for documentTypes', async () => {
      const body = { appliesTo: ['QUOTE' as DocumentType] };
      await controller.setDefault(actor, 'tmpl-1', body);
      expect(mockService.setDefault).toHaveBeenCalledWith('org-111', 'tmpl-1', [
        'QUOTE',
      ]);
    });

    it('generateAi delegates to service.generateAi with prompt and baseConfig', async () => {
      const body = {
        prompt: 'Minimalist monochrome invoice design',
        baseConfig: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      };
      await controller.generateAi(actor, body);
      expect(mockService.generateAi).toHaveBeenCalledWith(
        'org-111',
        'user-admin',
        'Minimalist monochrome invoice design',
        DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      );
    });

    it('previewPdf delegates to service.previewPdf and streams response', async () => {
      const body = {
        config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        documentType: 'INVOICE' as DocumentType,
      };
      const mockRes = {
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.previewPdf(actor, body, mockRes);

      expect(mockService.previewPdf).toHaveBeenCalledWith(
        'org-111',
        DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        'INVOICE',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/pdf',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'inline; filename="preview-invoice.pdf"',
      );
      expect(mockRes.end).toHaveBeenCalledWith(
        Buffer.from('%PDF-1.4 test preview'),
      );
    });

    it('previewPdf defaults documentType to INVOICE if omitted', async () => {
      const body = {
        config: DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
      };
      const mockRes = {
        setHeader: jest.fn(),
        end: jest.fn(),
      } as any;

      await controller.previewPdf(actor, body, mockRes);

      expect(mockService.previewPdf).toHaveBeenCalledWith(
        'org-111',
        DEFAULT_DOCUMENT_TEMPLATE_CONFIG,
        'INVOICE',
      );
    });
  });
});
