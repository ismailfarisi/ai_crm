import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_DEFINITIONS,
  splitPermission,
  type Permission,
} from '@saas/shared';
import { RbacService, type RbacActor } from './rbac.service';
import { Role } from './entities/role.entity';
import { Permission as PermissionEntity } from './entities/permission.entity';
import { TenantContextService } from '@/common/context/tenant-context.service';

describe('RbacService', () => {
  let service: RbacService;
  let rolesRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let permissionsRepo: {
    find: jest.Mock;
    insert: jest.Mock;
    save: jest.Mock;
  };
  let dataSource: {
    getRepository: jest.Mock;
    manager: {
      getRepository: jest.Mock;
    };
  };
  let tenantContext: {
    runAsSystem: jest.Mock;
    runWithTenant: jest.Mock;
    getTenantId: jest.Mock;
    setTenantId: jest.Mock;
    isSystem: jest.Mock;
  };

  const orgId = 'org-1';

  beforeEach(() => {
    rolesRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'role-1' })),
      save: jest.fn().mockImplementation(async (r) => r),
      remove: jest.fn().mockImplementation(async (r) => r),
      createQueryBuilder: jest.fn(),
    };

    permissionsRepo = {
      find: jest.fn().mockResolvedValue([]),
      insert: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockImplementation(async (p) => p),
    };

    dataSource = {
      getRepository: jest.fn().mockReturnValue({
        find: jest.fn().mockResolvedValue([]),
      }),
      manager: {
        getRepository: jest.fn(),
      },
    };

    tenantContext = {
      runAsSystem: jest.fn().mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      runWithTenant: jest.fn().mockImplementation(async (_tenantId: string, fn: () => Promise<unknown>) => fn()),
      getTenantId: jest.fn().mockReturnValue(null),
      setTenantId: jest.fn(),
      isSystem: jest.fn().mockReturnValue(false),
    };

    service = new RbacService(
      rolesRepo as unknown as Repository<Role>,
      permissionsRepo as unknown as Repository<PermissionEntity>,
      dataSource as unknown as DataSource,
      tenantContext as unknown as TenantContextService,
    );
  });

  describe('onModuleInit', () => {
    it('executes syncPermissionCatalog and syncSystemRolesForAllOrganizations inside runAsSystem', async () => {
      const syncCatalogSpy = jest.spyOn(service, 'syncPermissionCatalog').mockResolvedValue(undefined);
      const syncRolesSpy = jest.spyOn(service, 'syncSystemRolesForAllOrganizations').mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(tenantContext.runAsSystem).toHaveBeenCalledTimes(1);
      expect(syncCatalogSpy).toHaveBeenCalledTimes(1);
      expect(syncRolesSpy).toHaveBeenCalledTimes(1);
    });

    it('ensures runAsSystem wraps the entire initialization workflow', async () => {
      let insideSystemContext = false;
      tenantContext.runAsSystem.mockImplementationOnce(async (fn: () => Promise<unknown>) => {
        insideSystemContext = true;
        try {
          return await fn();
        } finally {
          insideSystemContext = false;
        }
      });

      jest.spyOn(service, 'syncPermissionCatalog').mockImplementation(async () => {
        expect(insideSystemContext).toBe(true);
      });
      jest.spyOn(service, 'syncSystemRolesForAllOrganizations').mockImplementation(async () => {
        expect(insideSystemContext).toBe(true);
      });

      await service.onModuleInit();
    });
  });

  describe('syncPermissionCatalog', () => {
    it('inserts missing permissions from ALL_PERMISSIONS', async () => {
      permissionsRepo.find.mockResolvedValue([]);

      await service.syncPermissionCatalog();

      expect(permissionsRepo.insert).toHaveBeenCalledTimes(1);
      const inserted = permissionsRepo.insert.mock.calls[0][0] as Partial<PermissionEntity>[];
      expect(inserted.length).toBe(ALL_PERMISSIONS.length);
      expect(inserted[0]).toHaveProperty('key');
      expect(inserted[0]).toHaveProperty('subject');
      expect(inserted[0]).toHaveProperty('action');
      expect(inserted[0]).toHaveProperty('description');
    });

    it('updates existing permissions if description changed', async () => {
      const firstKey = ALL_PERMISSIONS[0];
      const { subject, action } = splitPermission(firstKey);
      const existing: PermissionEntity[] = [
        {
          key: firstKey,
          subject,
          action,
          description: 'Old outdated description',
        } as PermissionEntity,
        ...ALL_PERMISSIONS.slice(1).map((key) => {
          const s = splitPermission(key);
          return {
            key,
            subject: s.subject,
            action: s.action,
            description: PERMISSION_DESCRIPTIONS[key],
          } as PermissionEntity;
        }),
      ];
      permissionsRepo.find.mockResolvedValue(existing);

      await service.syncPermissionCatalog();

      expect(permissionsRepo.insert).not.toHaveBeenCalled();
      expect(permissionsRepo.save).toHaveBeenCalledTimes(1);
      const updated = permissionsRepo.save.mock.calls[0][0] as PermissionEntity[];
      expect(updated.length).toBe(1);
      expect(updated[0].key).toBe(firstKey);
      expect(updated[0].description).toBe(PERMISSION_DESCRIPTIONS[firstKey]);
    });
  });

  describe('syncSystemRolesForAllOrganizations', () => {
    it('returns early when there are no organizations', async () => {
      const orgRepoFind = jest.fn().mockResolvedValue([]);
      dataSource.getRepository.mockReturnValue({ find: orgRepoFind });

      await service.syncSystemRolesForAllOrganizations();

      expect(rolesRepo.find).not.toHaveBeenCalled();
    });

    it('syncs system roles for organizations whose permissions diverge from code definitions', async () => {
      const orgRepoFind = jest.fn().mockResolvedValue([{ id: orgId }]);
      dataSource.getRepository.mockReturnValue({ find: orgRepoFind });

      const adminDef = SYSTEM_ROLE_DEFINITIONS.find((r) => r.slug === SYSTEM_ROLES.ADMIN)!;
      const catalog = (adminDef.permissions ?? []).map((key) => {
        const { subject, action } = splitPermission(key);
        return { key, subject, action, description: '' } as PermissionEntity;
      });
      permissionsRepo.find.mockResolvedValue(catalog);

      const existingRole: Partial<Role> = {
        id: 'role-admin',
        tenantId: orgId,
        slug: SYSTEM_ROLES.ADMIN,
        isSystem: true,
        permissions: [], // empty permissions, needs sync
      };
      rolesRepo.find.mockResolvedValue([existingRole]);

      await service.syncSystemRolesForAllOrganizations();

      expect(rolesRepo.save).toHaveBeenCalledTimes(1);
      expect(existingRole.permissions?.length).toBe(adminDef.permissions?.length);
    });
  });

  describe('resolveAccess', () => {
    it('resolves permissions from user roles and handles caching', async () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'role-viewer',
            slug: SYSTEM_ROLES.VIEWER,
            level: 40,
            grantsAllPermissions: false,
            permissions: [{ key: 'contacts:read' }],
          },
        ]),
      };
      rolesRepo.createQueryBuilder.mockReturnValue(qb);

      const access1 = await service.resolveAccess('user-1', orgId);
      expect(access1.permissions).toEqual(['contacts:read']);
      expect(access1.roles).toEqual([SYSTEM_ROLES.VIEWER]);
      expect(access1.level).toBe(40);
      expect(access1.isOwner).toBe(false);

      // Second call uses accessCache, does not query DB again
      const access2 = await service.resolveAccess('user-1', orgId);
      expect(access2).toEqual(access1);
      expect(rolesRepo.createQueryBuilder).toHaveBeenCalledTimes(1);

      // Invalidation clears cache
      service.invalidate(orgId, 'user-1');
      await service.resolveAccess('user-1', orgId);
      expect(rolesRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
    });

    it('grants all permissions when role grantsAllPermissions is true', async () => {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'role-owner',
            slug: SYSTEM_ROLES.OWNER,
            level: 0,
            grantsAllPermissions: true,
            permissions: [],
          },
        ]),
      };
      rolesRepo.createQueryBuilder.mockReturnValue(qb);

      const access = await service.resolveAccess('user-owner', orgId);
      expect(access.isOwner).toBe(true);
      expect(access.permissions).toEqual(ALL_PERMISSIONS);
      expect(access.level).toBe(0);
    });
  });

  describe('role management', () => {
    const actorOwner: RbacActor = {
      id: 'actor-1',
      level: 0,
      permissions: ALL_PERMISSIONS,
      isOwner: true,
    };

    const actorAdmin: RbacActor = {
      id: 'actor-2',
      level: 10,
      permissions: ['contacts:read', 'contacts:create'],
      isOwner: false,
    };

    it('createRole rejects duplicate name slug', async () => {
      rolesRepo.findOne.mockResolvedValueOnce({ id: 'existing' });

      await expect(
        service.createRole(orgId, actorOwner, { name: 'Support Rep', permissions: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('createRole prevents privilege escalation if actor does not hold requested permissions', async () => {
      rolesRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.createRole(orgId, actorAdmin, {
          name: 'Super Agent',
          permissions: ['org:manage_billing'] as unknown as Permission[],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('createRole succeeds when actor is owner or holds all permissions', async () => {
      rolesRepo.findOne.mockResolvedValueOnce(null);
      permissionsRepo.find.mockResolvedValueOnce([
        { key: 'contacts:read', subject: 'contacts', action: 'read', description: '' },
      ]);

      const dto = await service.createRole(orgId, actorOwner, {
        name: 'Guest Rep',
        permissions: ['contacts:read'],
      });

      expect(dto.name).toBe('Guest Rep');
      expect(dto.slug).toBe('guest-rep');
      expect(rolesRepo.save).toHaveBeenCalled();
    });

    it('updateRole prevents modifying owner role', async () => {
      rolesRepo.findOne.mockResolvedValueOnce({
        id: 'role-owner',
        tenantId: orgId,
        grantsAllPermissions: true,
        level: 0,
      });

      await expect(
        service.updateRole(orgId, actorOwner, 'role-owner', { name: 'New Name' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updateRole prevents modifying role at or above actor level', async () => {
      rolesRepo.findOne.mockResolvedValueOnce({
        id: 'role-target',
        tenantId: orgId,
        level: 5,
        grantsAllPermissions: false,
      });

      await expect(
        service.updateRole(orgId, actorAdmin, 'role-target', { name: 'New Name' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deleteRole prevents deleting system roles', async () => {
      rolesRepo.findOne.mockResolvedValueOnce({
        id: 'role-sys',
        tenantId: orgId,
        isSystem: true,
        level: 30,
        users: [],
      });

      await expect(
        service.deleteRole(orgId, actorOwner, 'role-sys'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deleteRole prevents deleting role with users still assigned', async () => {
      rolesRepo.findOne.mockResolvedValueOnce({
        id: 'role-custom',
        tenantId: orgId,
        isSystem: false,
        level: 100,
        users: [{ id: 'user-1' }],
      });

      await expect(
        service.deleteRole(orgId, actorOwner, 'role-custom'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deleteRole deletes unassigned custom role', async () => {
      const customRole = {
        id: 'role-custom',
        tenantId: orgId,
        isSystem: false,
        level: 100,
        users: [],
      };
      rolesRepo.findOne.mockResolvedValueOnce(customRole);

      await service.deleteRole(orgId, actorOwner, 'role-custom');

      expect(rolesRepo.remove).toHaveBeenCalledWith(customRole);
    });

    it('findRole throws NotFoundException if role does not exist', async () => {
      rolesRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.findRole(orgId, 'missing-id')).rejects.toThrow(NotFoundException);
    });
  });
});
