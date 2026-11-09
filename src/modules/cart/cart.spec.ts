import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../database/prisma.service.js';
import { AddCartItemDto, CartQuantityDto } from './cart.dto.js';
import { lineAmount, mergeQuantities } from './cart.policy.js';
import { CartService } from './cart.service.js';

describe('cart pricing and merge policy', () => {
  it('calculates exact integer cents at the supported limits', () => {
    expect(lineAmount(39, 3)).toBe(117);
    expect(lineAmount(1000000000, 99) * 50).toBe(4950000000000);
    for (const [price, quantity] of [[0.1, 1], [-1, 1], [1, 0], [1, 100], [1, 1.5]]) expect(() => lineAmount(price, quantity)).toThrow();
  });

  it('combines matching variants exactly without changing the input carts', () => {
    const destination = [{ variantId: 'a', quantity: 2 }];
    const source = [{ variantId: 'a', quantity: 3 }, { variantId: 'b', quantity: 1 }];
    const result = mergeQuantities(destination, source);
    expect([...result.quantities!]).toEqual([['a', 5], ['b', 1]]);
    expect(destination[0].quantity).toBe(2);
    expect(source[0].quantity).toBe(3);
  });

  it('defers over-limit merges instead of clipping or dropping items', () => {
    expect(mergeQuantities([{ variantId: 'a', quantity: 98 }], [{ variantId: 'a', quantity: 2 }])).toEqual({ quantities: null, reason: 'QUANTITY_LIMIT' });
    const full = Array.from({ length: 50 }, (_, index) => ({ variantId: String(index), quantity: 1 }));
    expect(mergeQuantities(full, [{ variantId: 'extra', quantity: 1 }])).toEqual({ quantities: null, reason: 'CART_LIMIT' });
  });

  it('keeps guest credentials in host-only Secure HttpOnly production cookies', () => {
    const service = new CartService({} as PrismaService, new ConfigService({ NODE_ENV: 'production' }));
    const cookie = vi.fn();
    const expires = new Date(Date.now() + 100000);
    service.setCookie({ cookie } as unknown as Response, 'opaque-credential', expires);
    expect(cookie).toHaveBeenCalledWith('__Host-zaryab_cart', 'opaque-credential', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires });
  });
});

describe('cart input boundaries', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, errorHttpStatusCode: 422 });
  it.each([0, 100, 1.5, '2', null])('rejects invalid cart quantity %j', async (quantity) => {
    await expect(pipe.transform({ quantity }, { type: 'body', metatype: CartQuantityDto })).rejects.toMatchObject({ status: 422 });
  });
  it('rejects caller prices, user IDs and forged variant IDs', async () => {
    for (const body of [
      { quantity: 1, variantId: randomUUID(), price: 1 },
      { quantity: 1, variantId: randomUUID(), userId: randomUUID() },
      { quantity: 1, variantId: 'not-a-uuid' },
    ]) await expect(pipe.transform(body, { type: 'body', metatype: AddCartItemDto })).rejects.toMatchObject({ status: 422 });
  });
});
