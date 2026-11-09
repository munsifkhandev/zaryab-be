import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { fileURLToPath } from 'node:url';
import { validateEnvironment } from './config/environment.js';
import { PrismaModule } from './database/prisma.module.js';
import { HealthModule } from './health/health.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { CartModule } from './modules/cart/cart.module.js';
import { CommerceMaintenanceModule } from './infrastructure/commerce-maintenance.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { CustomerFeaturesModule } from './modules/customer/customer.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { AdministrationModule } from './modules/admin/admin.module.js';
import { MediaModule } from './modules/media/media.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: fileURLToPath(new URL('../.env', import.meta.url)),
      validate: validateEnvironment,
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    CatalogModule,
    InventoryModule,
    CartModule,
    OrdersModule,
    CustomerFeaturesModule,
    ContentModule,
    AdministrationModule,
    MediaModule,
    CommerceMaintenanceModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [{
        // shortcut: in-memory counters; use shared storage before running multiple API instances.
        ttl: config.getOrThrow<number>('RATE_LIMIT_TTL_MS'),
        limit: config.getOrThrow<number>('RATE_LIMIT_MAX'),
      }],
    }),
    ObserveModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        enabled: Boolean(config.get<string>('OBSERVE_APP_KEY') && config.get<string>('OBSERVE_APP_SECRET')),
        appKey: config.get<string>('OBSERVE_APP_KEY') ?? '',
        appSecret: config.get<string>('OBSERVE_APP_SECRET') ?? '',
        serviceId: 'backend',
      }),
    }),
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
