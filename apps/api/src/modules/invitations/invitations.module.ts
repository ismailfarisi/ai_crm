import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '@/modules/mail/mail.module';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { RbacModule } from '@/modules/rbac/rbac.module';
import { Team } from '@/modules/teams/entities/team.entity';
import { UsersModule } from '@/modules/users/users.module';
import { Invitation } from './entities/invitation.entity';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invitation, Team, Organization]),
    RbacModule,
    UsersModule,
    MailModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
