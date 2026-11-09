import { ConfigService } from '@nestjs/config';
import { CommerceMaintenance } from './commerce-maintenance.module.js';
import type { InventoryService } from '../modules/inventory/inventory.service.js';
import type { CartService } from '../modules/cart/cart.service.js';
import type { OrdersService } from '../modules/orders/orders.service.js';

describe('bounded commerce expiry polling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('prevents overlap and stops polling on shutdown', async () => {
    let finish!: () => void;
    const inventory = { expireBatch: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) };
    const carts = { expireBatch: vi.fn().mockResolvedValue({ expired: 0 }) };
    const orders = { expireQuotes: vi.fn().mockResolvedValue(0) };
    const worker = new CommerceMaintenance(inventory as unknown as InventoryService, carts as unknown as CartService,
      new ConfigService({ COMMERCE_MAINTENANCE_ENABLED: true }),orders as unknown as OrdersService);
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(90000);
    expect(inventory.expireBatch).toHaveBeenCalledOnce();
    expect(carts.expireBatch).toHaveBeenCalledOnce();
    expect(orders.expireQuotes).toHaveBeenCalledWith(100);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(carts.expireBatch).toHaveBeenCalledWith(100);
    await worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60000);
    expect(inventory.expireBatch).toHaveBeenCalledOnce();
  });

  it('does not schedule work when maintenance is disabled', async () => {
    const expiry = vi.fn();
    const worker = new CommerceMaintenance({ expireBatch: expiry } as unknown as InventoryService,
      { expireBatch: expiry } as unknown as CartService, new ConfigService({ COMMERCE_MAINTENANCE_ENABLED: false }),{expireQuotes:expiry} as unknown as OrdersService);
    worker.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60000);
    expect(expiry).not.toHaveBeenCalled();
    await worker.onModuleDestroy();
  });
});
