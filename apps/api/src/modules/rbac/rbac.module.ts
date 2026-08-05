import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { PermissionsGuard } from './guards/permissions.guard';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

/**
 * Global because the JWT strategy and every feature guard need RbacService, and
 * threading it through each feature module adds noise without adding safety.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission])],
  controllers: [RbacController],
  providers: [RbacService, PermissionsGuard],
  exports: [RbacService, PermissionsGuard, TypeOrmModule],
})
export class RbacModule {}
