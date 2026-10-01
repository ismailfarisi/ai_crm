import { Test, TestingModule } from '@nestjs/testing';
import { ClsModule, ClsService } from 'nestjs-cls';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { TenantContextService } from './tenant-context.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';

describe('TenantContextService', () => {
  let service: TenantContextService;
  let cls: ClsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ClsModule.forRoot({
          global: true,
          middleware: { mount: true },
        }),
      ],
      providers: [TenantContextService, TenantContextInterceptor],
    }).compile();

    service = module.get<TenantContextService>(TenantContextService);
    cls = module.get<ClsService>(ClsService);
  });

  it('returns null when no tenant context is set', async () => {
    await cls.run(async () => {
      expect(service.getTenantId()).toBeNull();
      expect(service.isSystem()).toBe(false);
    });
  });

  it('manages tenantId inside runWithTenant', async () => {
    const tenantId = '00000000-0000-0000-0000-000000000001';
    await service.runWithTenant(tenantId, async () => {
      expect(service.getTenantId()).toBe(tenantId);
      expect(service.isSystem()).toBe(false);
    });
  });

  it('manages system mode inside runAsSystem', async () => {
    await service.runAsSystem(async () => {
      expect(service.isSystem()).toBe(true);
      expect(service.getTenantId()).toBeNull();
    });
  });

  it('allows setting tenantId manually within an active context', async () => {
    await cls.run(async () => {
      service.setTenantId('tenant-123');
      expect(service.getTenantId()).toBe('tenant-123');
    });
  });

  it('TenantContextInterceptor extracts organizationId from request and sets tenantId', async () => {
    const interceptor = new TenantContextInterceptor(service);
    const mockUser: Partial<AuthenticatedUser> = {
      organizationId: 'tenant-abc-xyz',
    };
    const mockRequest = {
      user: mockUser,
    };
    const mockExecutionContext = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as unknown as ExecutionContext;

    const mockCallHandler: CallHandler = {
      handle: () => of({ success: true }),
    };

    await cls.run(async () => {
      let emitted = false;
      interceptor.intercept(mockExecutionContext, mockCallHandler).subscribe({
        next: () => {
          emitted = true;
          expect(service.getTenantId()).toBe('tenant-abc-xyz');
        },
      });
      expect(emitted).toBe(true);
      expect(service.getTenantId()).toBe('tenant-abc-xyz');
    });
  });
});
