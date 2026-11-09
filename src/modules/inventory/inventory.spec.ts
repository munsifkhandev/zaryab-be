import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../database/prisma.service.js';
import { AdjustmentDto, ReservationDto } from './inventory.dto.js';
import { inventoryKey, InventoryService } from './inventory.service.js';

describe('inventory input and idempotency boundaries', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, errorHttpStatusCode: 422 });
  const base = { variantId: randomUUID(), locationId: randomUUID(), reason: 'Warehouse stock count' };

  it('accepts bounded opaque keys and rejects ambiguous/malformed values', () => {
    expect(inventoryKey('count-2026-0001')).toBe('count-2026-0001');
    for (const key of [undefined, null, [], 'short', 'with whitespace', 'x'.repeat(129), '\nattack-key']) expect(() => inventoryKey(key)).toThrow(BadRequestException);
  });

  it('requires nonzero integer stock deltas', async () => {
    for (const delta of [0, 0.5, 1000000001, '5']) {
      await expect(pipe.transform({ ...base, delta }, { type: 'body', metatype: AdjustmentDto })).rejects.toMatchObject({ status: 422 });
    }
  });

  it('bounds reservation quantity and expiry', async () => {
    for (const fields of [{ quantity: 0 }, { quantity: 10001 }, { quantity: 1, ttlSeconds: 59 }, { quantity: 1, ttlSeconds: 3601 }]) {
      await expect(pipe.transform({ ...base, ...fields }, { type: 'body', metatype: ReservationDto })).rejects.toMatchObject({ status: 422 });
    }
    expect(await pipe.transform({ ...base, quantity: 1 }, { type: 'body', metatype: ReservationDto })).toMatchObject({ ttlSeconds: 900 });
  });

  it('refuses negative returns before any database operation', async () => {
    const service = new InventoryService({} as PrismaService);
    await expect(service.adjust({ ...base, delta: -1, type: 'RETURN' }, 'return-0001', randomUUID())).rejects.toBeInstanceOf(BadRequestException);
  });
});
