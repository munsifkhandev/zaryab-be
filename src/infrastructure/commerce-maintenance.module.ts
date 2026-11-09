import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CartModule } from '../modules/cart/cart.module.js';
import { CartService } from '../modules/cart/cart.service.js';
import { InventoryModule } from '../modules/inventory/inventory.module.js';
import { InventoryService } from '../modules/inventory/inventory.service.js';
import { OrdersModule } from '../modules/orders/orders.module.js';
import { OrdersService } from '../modules/orders/orders.service.js';

@Injectable()
export class CommerceMaintenance implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CommerceMaintenance.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;

  constructor(@Inject(InventoryService) private readonly inventory: InventoryService, @Inject(CartService) private readonly carts: CartService,
    @Inject(ConfigService) private readonly config: ConfigService, @Inject(OrdersService) private readonly orders: OrdersService) {}

  onApplicationBootstrap() {
    if (!this.config.getOrThrow<boolean>('COMMERCE_MAINTENANCE_ENABLED')) return;
    // shortcut: bounded database polling; use queue workers when expiry throughput exceeds this batch rate.
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.tick().catch(() => this.logger.error('Commerce expiry batch failed; it will retry on the next interval.'))
        .finally(() => { this.running = undefined; });
    }, 30000);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    const results = await Promise.allSettled([this.inventory.expireBatch(100), this.carts.expireBatch(100), this.orders.expireQuotes(100)]);
    if (results.some((result) => result.status === 'rejected')) throw new Error('Commerce expiry batch failed.');
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}

@Module({ imports: [InventoryModule, CartModule, OrdersModule], providers: [CommerceMaintenance] })
export class CommerceMaintenanceModule {}
