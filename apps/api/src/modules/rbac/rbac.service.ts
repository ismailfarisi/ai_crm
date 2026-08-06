import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  ALL_PERMISSIONS,
  CUSTOM_ROLE_LEVEL,
  PERMISSION_DESCRIPTIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_DEFINITIONS,
  splitPermission,
  type CreateRoleInput,
  type Permission,
  type RoleDto,
  type SystemRoleSlug,
  type UpdateRoleInput,
} from '@saas/shared';
import { Permission as PermissionEntity } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { Organization } from '@/modules/organizations/entities/organization.entity';

interface ResolvedAccess {
  permissions: Permission[];
  roles: string[];
  level: number;
  isOwner: boolean;
}

/** The subset of the authenticated user that role administration needs. */
export interface RbacActor {
  id: string;
  level: number;
  permissions: Permission[];
  isOwner: boolean;
}

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name);

  /**
   * Effective permissions are read on every authenticated request, so they are
   * cached — but only for a few seconds. A role edit propagates almost
   * immediately without us needing cache invalidation plumbing across instances.
   */
  private readonly accessCache = new Map<
    string,
    { value: ResolvedAccess; expiresAt: number }
  >();
  private static readonly CACHE_TTL_MS = 5_000;

  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(PermissionEntity)
    private readonly permissions: Repository<PermissionEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /** Keep the permission catalog in sync with the code on every boot. */
  async onModuleInit(): Promise<void> {
    await this.syncPermissionCatalog();
    await this.syncSystemRolesForAllOrganizations();
  }

  async syncPermissionCatalog(): Promise<void> {
    const existing = await this.permissions.find();
    const existingByKey = new Map(existing.map((p) => [p.key, p]));

    const toInsert: Partial<PermissionEntity>[] = [];
    const toUpdate: PermissionEntity[] = [];

    for (const key of ALL_PERMISSIONS) {
      const { subject, action } = splitPermission(key);
      const description = PERMISSION_DESCRIPTIONS[key];
      const current = existingByKey.get(key);

      if (!current) {
        toInsert.push({ key, subject, action, description });
      } else if (current.description !== description) {
        current.description = description;
        toUpdate.push(current);
      }
    }

    if (toInsert.length) {
      await this.permissions.insert(toInsert);
    }
    if (toUpdate.length) {
      await this.permissions.save(toUpdate);
    }

    const stale = existing.filter(
      (p) => !(ALL_PERMISSIONS as string[]).includes(p.key),
    );
    if (stale.length) {
      this.logger.warn(
        `Permission catalog contains ${stale.length} key(s) no longer defined in code: ` +
          `${stale.map((p) => p.key).join(', ')}. Left in place — remove them with a migration.`,
      );
    }

    if (toInsert.length || toUpdate.length) {
      this.logger.log(
        `Permission catalog synced (${toInsert.length} added, ${toUpdate.length} updated, ${ALL_PERMISSIONS.length} total).`,
      );
    }
  }

  /**
   * System role definitions evolve in code. New orgs get the current set at
   * signup, but orgs created before a definition changed keep their old
   * permission sets. On boot we re-sync every org's system roles to the code's
   * definition — except the owner's wildcard, which must never be narrowed, and
   * never touching custom roles.
   */
  async syncSystemRolesForAllOrganizations(): Promise<void> {
    const orgs = await this.dataSource
      .getRepository(Organization)
      .find({ select: { id: true } });
    if (!orgs.length) return;

    const catalog = await this.permissions.find();
    const byKey = new Map(catalog.map((p) => [p.key, p]));

    const definitionsBySlug = new Map(
      SYSTEM_ROLE_DEFINITIONS.map((r) => [r.slug, r]),
    );

    let updated = 0;
    for (const org of orgs) {
      const roles = await this.roles.find({
        where: { organizationId: org.id },
        relations: { permissions: true },
      });

      for (const role of roles) {
        if (!role.isSystem) continue;
        const definition = definitionsBySlug.get(role.slug as SystemRoleSlug);
        if (!definition) continue;

        // The owner role is intentionally a wildcard — never overwrite it.
        if (definition.permissions === null) continue;

        const currentKeys = new Set((role.permissions ?? []).map((p) => p.key));
        const targetKeys = new Set(definition.permissions);
        const same =
          currentKeys.size === targetKeys.size &&
          [...targetKeys].every((k) => currentKeys.has(k));

        if (same) continue;

        role.permissions = definition.permissions
          .map((key) => byKey.get(key))
          .filter((p): p is PermissionEntity => !!p);
        await this.roles.save(role);
        updated += 1;
      }
    }

    if (updated) {
      this.logger.log(
        `Re-synced ${updated} system role(s) to the current definitions.`,
      );
      // Drop the whole cache — the permission change affects every org.
      this.accessCache.clear();
    }
  }

  /**
   * Creates this tenant's copy of the system roles. Called once, inside the
   * signup transaction, so a half-provisioned org can never exist.
   */
  async provisionSystemRoles(
    organizationId: string,
    manager = this.dataSource.manager,
  ): Promise<Role[]> {
    const permissionRepo = manager.getRepository(PermissionEntity);
    const roleRepo = manager.getRepository(Role);

    const catalog = await permissionRepo.find();
    const byKey = new Map(catalog.map((p) => [p.key, p]));

    const created: Role[] = [];
    for (const definition of SYSTEM_ROLE_DEFINITIONS) {
      const role = roleRepo.create({
        organizationId,
        name: definition.name,
        slug: definition.slug,
        description: definition.description,
        isSystem: true,
        level: definition.level,
        grantsAllPermissions: definition.permissions === null,
        permissions:
          definition.permissions === null
            ? []
            : definition.permissions
                .map((key) => byKey.get(key))
                .filter((p): p is PermissionEntity => !!p),
      });
      created.push(await roleRepo.save(role));
    }

    return created;
  }

  /** Resolves the union of permissions across every role the user holds. */
  async resolveAccess(
    userId: string,
    organizationId: string,
  ): Promise<ResolvedAccess> {
    const cacheKey = `${organizationId}:${userId}`;
    const cached = this.accessCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const roles = await this.roles
      .createQueryBuilder('role')
      .innerJoin('role.users', 'user', 'user.id = :userId', { userId })
      .leftJoinAndSelect('role.permissions', 'permission')
      .where('role.organizationId = :organizationId', { organizationId })
      .getMany();

    const grantsEverything = roles.some((role) => role.grantsAllPermissions);
    const permissions = grantsEverything
      ? [...ALL_PERMISSIONS]
      : [
          ...new Set(
            roles.flatMap((role) =>
              role.permissions.map((p) => p.key as Permission),
            ),
          ),
        ];

    const value: ResolvedAccess = {
      permissions,
      roles: roles.map((role) => role.slug),
      level: roles.length
        ? Math.min(...roles.map((role) => role.level))
        : Number.MAX_SAFE_INTEGER,
      isOwner: roles.some((role) => role.slug === SYSTEM_ROLES.OWNER),
    };

    this.accessCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + RbacService.CACHE_TTL_MS,
    });
    return value;
  }

  /** Drop cached access for a user (or a whole org) after a role change. */
  invalidate(organizationId: string, userId?: string): void {
    if (userId) {
      this.accessCache.delete(`${organizationId}:${userId}`);
      return;
    }
    for (const key of this.accessCache.keys()) {
      if (key.startsWith(`${organizationId}:`)) {
        this.accessCache.delete(key);
      }
    }
  }

  // ─── Role administration ────────────────────────────────────────────────────

  async listRoles(organizationId: string): Promise<RoleDto[]> {
    const roles = await this.roles.find({
      where: { organizationId },
      relations: { permissions: true, users: true },
      order: { level: 'ASC', name: 'ASC' },
    });

    return roles.map((role) => this.toDto(role));
  }

  async findRole(organizationId: string, roleId: string): Promise<Role> {
    const role = await this.roles.findOne({
      where: { id: roleId, organizationId },
      relations: { permissions: true, users: true },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  async getRole(organizationId: string, roleId: string): Promise<RoleDto> {
    return this.toDto(await this.findRole(organizationId, roleId));
  }

  async createRole(
    organizationId: string,
    actor: RbacActor,
    input: CreateRoleInput,
  ): Promise<RoleDto> {
    const slug = this.slugify(input.name);
    const clash = await this.roles.findOne({ where: { organizationId, slug } });
    if (clash) {
      throw new BadRequestException(
        `A role named "${input.name}" already exists`,
      );
    }

    const requested = (input.permissions ?? []) as Permission[];
    this.assertActorCanGrant(actor, requested);

    const role = this.roles.create({
      organizationId,
      name: input.name,
      slug,
      description: input.description ?? '',
      isSystem: false,
      level: CUSTOM_ROLE_LEVEL,
      grantsAllPermissions: false,
      permissions: await this.loadPermissions(requested),
    });

    const saved = await this.roles.save(role);
    this.invalidate(organizationId);
    return this.toDto({ ...saved, users: [] });
  }

  async updateRole(
    organizationId: string,
    actor: RbacActor,
    roleId: string,
    input: UpdateRoleInput,
  ): Promise<RoleDto> {
    const role = await this.findRole(organizationId, roleId);

    if (role.grantsAllPermissions) {
      throw new ForbiddenException('The Owner role cannot be modified');
    }
    if (role.level <= actor.level) {
      throw new ForbiddenException(
        'You cannot modify a role at or above your own level',
      );
    }
    if (role.isSystem && input.name && input.name !== role.name) {
      throw new BadRequestException('System roles cannot be renamed');
    }

    if (input.name && !role.isSystem) {
      role.name = input.name;
      role.slug = this.slugify(input.name);
    }
    if (input.description !== undefined) {
      role.description = input.description;
    }
    if (input.permissions) {
      const requested = input.permissions as Permission[];
      this.assertActorCanGrant(actor, requested);
      role.permissions = await this.loadPermissions(requested);
    }

    const saved = await this.roles.save(role);
    this.invalidate(organizationId);
    return this.toDto(saved);
  }

  async deleteRole(
    organizationId: string,
    actor: RbacActor,
    roleId: string,
  ): Promise<void> {
    const role = await this.findRole(organizationId, roleId);

    if (role.isSystem) {
      throw new ForbiddenException('System roles cannot be deleted');
    }
    if (role.level <= actor.level) {
      throw new ForbiddenException(
        'You cannot delete a role at or above your own level',
      );
    }
    if (role.users.length > 0) {
      throw new BadRequestException(
        `${role.users.length} user(s) still hold this role. Reassign them before deleting it.`,
      );
    }

    await this.roles.remove(role);
    this.invalidate(organizationId);
  }

  async findRolesByIds(
    organizationId: string,
    roleIds: string[],
  ): Promise<Role[]> {
    if (!roleIds.length) return [];

    const roles = await this.roles.find({
      where: { organizationId, id: In(roleIds) },
      relations: { permissions: true },
    });

    if (roles.length !== new Set(roleIds).size) {
      throw new BadRequestException(
        'One or more roles do not exist in this organization',
      );
    }
    return roles;
  }

  async findRoleBySlug(organizationId: string, slug: string): Promise<Role> {
    const role = await this.roles.findOne({ where: { organizationId, slug } });
    if (!role) {
      throw new NotFoundException(`Role "${slug}" not found`);
    }
    return role;
  }

  /**
   * You cannot hand out access you do not have yourself. Without this, an admin
   * could mint a custom role holding `org:manage_billing` and assign it to
   * themselves.
   *
   * This checks against the actor's OWN effective permissions — the set the auth
   * guard already resolved for this request. Deriving it from their role level
   * instead would be wrong: "every role at or above level N" sweeps in the more
   * powerful roles the actor does not hold, including the owner's wildcard.
   */
  private assertActorCanGrant(actor: RbacActor, requested: Permission[]): void {
    if (actor.isOwner) return;

    const held = new Set(actor.permissions);
    const escalation = requested.filter((permission) => !held.has(permission));

    if (escalation.length) {
      throw new ForbiddenException(
        `You cannot grant permissions you do not hold: ${escalation.join(', ')}`,
      );
    }
  }

  private async loadPermissions(
    keys: Permission[],
  ): Promise<PermissionEntity[]> {
    if (!keys.length) return [];
    const found = await this.permissions.find({ where: { key: In(keys) } });
    if (found.length !== new Set(keys).size) {
      const missing = keys.filter((k) => !found.some((f) => f.key === k));
      throw new BadRequestException(
        `Unknown permission(s): ${missing.join(', ')}`,
      );
    }
    return found;
  }

  private toDto(role: Role): RoleDto {
    return {
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      isSystem: role.isSystem,
      level: role.level,
      permissions: role.grantsAllPermissions
        ? [...ALL_PERMISSIONS]
        : (role.permissions ?? []).map((p) => p.key as Permission),
      userCount: role.users?.length ?? 0,
      createdAt: role.createdAt?.toISOString(),
      updatedAt: role.updatedAt?.toISOString(),
    };
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }
}
