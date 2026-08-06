import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvitationsModule } from '@/modules/invitations/invitations.module';
import { Organization } from '@/modules/organizations/entities/organization.entity';
import { UsersModule } from '@/modules/users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenHousekeepingService } from './token-housekeeping.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    // Secrets are passed per-call in TokensService because access and refresh
    // tokens are signed with different keys.
    JwtModule.register({}),
    TypeOrmModule.forFeature([RefreshToken, Organization]),
    UsersModule,
    InvitationsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    JwtStrategy,
    JwtAuthGuard,
    TokenHousekeepingService,
  ],
  exports: [AuthService, TokensService, JwtAuthGuard],
})
export class AuthModule {}
