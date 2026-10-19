import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { Branch } from './entities/branch.entity';
import { Organization } from './entities/organization.entity';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, Branch])],
  controllers: [OrganizationsController, BranchesController],
  providers: [OrganizationsService, BranchesService],
  exports: [OrganizationsService, BranchesService, TypeOrmModule],
})
export class OrganizationsModule {}
