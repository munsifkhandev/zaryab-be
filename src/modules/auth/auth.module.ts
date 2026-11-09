import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../../database/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { ProfileController } from './profile.controller.js';
import { AuthService } from './auth.service.js';
import { AuthGuard, AuthorizationGuard, CsrfGuard } from './auth.guards.js';
import { CartModule } from '../cart/cart.module.js';
import { IntegrationsModule } from '../../infrastructure/integrations.module.js';
import { RecoveryController } from './recovery.controller.js';
import { RecoveryService } from './recovery.service.js';

@Module({
  imports: [PrismaModule, CartModule, IntegrationsModule],
  controllers: [AuthController, ProfileController, RecoveryController],
  providers: [
    AuthService,
    RecoveryService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
