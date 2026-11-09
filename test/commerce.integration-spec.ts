import { ConfigService } from '@nestjs/config';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { argon2id, hash } from 'argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service.js';
import { CartService, type CartOwner } from '../src/modules/cart/cart.service.js';
import { tokenHash } from '../src/modules/auth/auth.tokens.js';
import { InventoryService } from '../src/modules/inventory/inventory.service.js';
import { testDatabaseUrl } from './helpers/test-database.js';

type Fixture = {
  userId: string; otherUserId: string; productId: string; categoryId: string; variantId: string; locationId: string;
  guestTokens: string[];
};

describe('inventory/cart transactions and concurrent requests (isolated test database)', () => {
  let database: PrismaService;
  let inventory: InventoryService;
  let carts: CartService;
  let passwordHash: string;

  beforeAll(async () => {
    database = new PrismaService(new ConfigService({ DATABASE_URL: testDatabaseUrl() }));
    await database.$connect();
    inventory = new InventoryService(database);
    carts = new CartService(database, new ConfigService({ NODE_ENV: 'test' }));
    passwordHash = await hash('commerce-isolated-fixture-password', { type: argon2id, parallelism: 1 });
  });
  afterAll(async () => { await database?.$disconnect(); });

  async function createFixture(): Promise<Fixture> {
    return database.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { firstName: 'Commerce', lastName: 'Fixture', email: `${randomUUID()}@example.com`, passwordHash } });
      const other = await tx.user.create({ data: { firstName: 'Other', lastName: 'Fixture', email: `${randomUUID()}@example.com`, passwordHash } });
      const category = await tx.category.create({ data: { name: 'Commerce fixture', slug: `fixture-${randomUUID()}` } });
      const [time] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const product = await tx.product.create({ data: { name: 'Commerce fixture', slug: `fixture-${randomUUID()}`, status: 'PUBLISHED', publishedAt: time.now,
        images: { create: { url: 'https://example.com/fixture.jpg' } }, categories: { create: { categoryId: category.id } } } });
      const size = await tx.productOption.create({ data: { productId: product.id, name: 'Size' } });
      const color = await tx.productOption.create({ data: { productId: product.id, name: 'Color' } });
      const sizeValue = await tx.productOptionValue.create({ data: { productId: product.id, optionId: size.id, value: 'M' } });
      const colorValue = await tx.productOptionValue.create({ data: { productId: product.id, optionId: color.id, value: 'Black', colorHex: '#282828' } });
      const variant = await tx.productVariant.create({ data: { productId: product.id, sku: `FIX-${randomUUID()}`, price: 1000 } });
      await tx.variantOptionValue.createMany({ data: [
        { variantId: variant.id, productId: product.id, optionId: size.id, valueId: sizeValue.id },
        { variantId: variant.id, productId: product.id, optionId: color.id, valueId: colorValue.id },
      ] });
      const location = await tx.inventoryLocation.create({ data: { code: `FIX_${randomUUID().replaceAll('-', '').toUpperCase()}`, name: 'Fixture warehouse' } });
      await tx.inventoryBalance.create({ data: { variantId: variant.id, locationId: location.id, onHand: 5 } });
      return { userId: user.id, otherUserId: other.id, productId: product.id, categoryId: category.id, variantId: variant.id, locationId: location.id, guestTokens: [] };
    });
  }

  async function cleanup(f: Fixture) {
    // Concurrency tests need committed fixtures. Delete only their recorded UUIDs in the guarded _test database.
    await database.$transaction(async (tx) => {
      const users = [f.userId, f.otherUserId];
      const hashes = f.guestTokens.map(tokenHash);
      const ownedCarts = await tx.cart.findMany({ where: { OR: [{ userId: { in: users } }, { guestTokenHash: { in: hashes } }] }, select: { id: true } });
      const movements = await tx.stockMovement.findMany({ where: { variantId: f.variantId }, select: { id: true } });
      const reservations = await tx.stockReservation.findMany({ where: { variantId: f.variantId }, select: { id: true } });
      const entityIds = [f.variantId, f.productId, f.locationId, ...ownedCarts.map(({ id }) => id), ...movements.map(({ id }) => id), ...reservations.map(({ id }) => id)];
      await tx.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { entityId: { in: entityIds } }] } });
      await tx.cartItem.deleteMany({ where: { cartId: { in: ownedCarts.map(({ id }) => id) } } });
      await tx.cart.deleteMany({ where: { guestTokenHash: { in: hashes } } });
      await tx.cart.deleteMany({ where: { userId: { in: users } } });
      await tx.stockMovement.deleteMany({ where: { variantId: f.variantId } });
      await tx.stockReservation.deleteMany({ where: { variantId: f.variantId } });
      await tx.inventoryBalance.deleteMany({ where: { variantId: f.variantId } });
      await tx.variantOptionValue.deleteMany({ where: { variantId: f.variantId } });
      await tx.productVariant.delete({ where: { id: f.variantId } });
      await tx.productOptionValue.deleteMany({ where: { productId: f.productId } });
      await tx.productOption.deleteMany({ where: { productId: f.productId } });
      await tx.productImage.deleteMany({ where: { productId: f.productId } });
      await tx.productCategory.deleteMany({ where: { productId: f.productId } });
      await tx.product.delete({ where: { id: f.productId } });
      await tx.category.delete({ where: { id: f.categoryId } });
      await tx.inventoryLocation.delete({ where: { id: f.locationId } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    }, { timeout: 15000 });
  }

  async function fixture(work: (f: Fixture) => Promise<void>) {
    const f = await createFixture();
    try { await work(f); } finally { await cleanup(f); }
  }
  async function guest(f: Fixture) {
    const result = await carts.initialize(); f.guestTokens.push(result.token);
    return { owner: { kind: 'guest', token: result.token } as CartOwner, ...result };
  }
  function user(f: Fixture): CartOwner { return { kind: 'user', userId: f.userId }; }
  function balance(f: Fixture) { return database.inventoryBalance.findUniqueOrThrow({ where: { variantId_locationId: { variantId: f.variantId, locationId: f.locationId } } }); }

  it('deduplicates simultaneous stock adjustments and rejects changed-payload key reuse', async () => {
    await fixture(async (f) => {
      const dto = { variantId: f.variantId, locationId: f.locationId, delta: 3, reason: 'Physical stock count', type: 'ADJUSTMENT' as const };
      const key = randomUUID();
      const [a, b] = await Promise.all([inventory.adjust(dto, key, f.userId), inventory.adjust(dto, key, f.userId)]);
      expect(a.id).toBe(b.id);
      expect((await balance(f)).onHand).toBe(8);
      await expect(inventory.adjust({ ...dto, delta: 4 }, key, f.userId)).rejects.toBeInstanceOf(ConflictException);
      expect((await balance(f)).onHand).toBe(8);
    });
  });

  it('prevents concurrent overselling and commits a reservation exactly once', async () => {
    await fixture(async (f) => {
      const dto = { variantId: f.variantId, locationId: f.locationId, quantity: 4, ttlSeconds: 900, reason: 'Concurrent reservation test' };
      const keys = [randomUUID(), randomUUID()];
      const results = await Promise.allSettled(keys.map((key) => inventory.reserve(dto, key, f.userId)));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const index = results.findIndex((result) => result.status === 'fulfilled');
      const success = results[index];
      if (success.status !== 'fulfilled') throw new Error('Expected one successful reservation');
      expect((await balance(f)).reserved).toBe(4);
      expect((await inventory.reserve(dto, keys[index], f.userId)).id).toBe(success.value.id);
      await expect(inventory.adjust({ variantId: f.variantId, locationId: f.locationId, delta: -2, reason: 'Attempt reserved-stock reduction', type: 'ADJUSTMENT' }, randomUUID(), f.userId)).rejects.toBeInstanceOf(ConflictException);
      await Promise.all([inventory.commit(success.value.id, f.userId), inventory.commit(success.value.id, f.userId)]);
      expect(await balance(f)).toMatchObject({ onHand: 1, reserved: 0 });
      expect(await database.stockMovement.count({ where: { variantId: f.variantId, type: 'COMMIT' } })).toBe(1);
    });
  });

  it('releases once and expires a late commitment without consuming stock', async () => {
    await fixture(async (f) => {
      const dto = { variantId: f.variantId, locationId: f.locationId, quantity: 2, ttlSeconds: 60, reason: 'Reservation lifecycle test' };
      const first = await inventory.reserve(dto, randomUUID(), f.userId);
      await Promise.all([inventory.release(first.id, f.userId), inventory.release(first.id, f.userId)]);
      expect(await balance(f)).toMatchObject({ onHand: 5, reserved: 0 });
      const second = await inventory.reserve(dto, randomUUID(), f.userId);
      await database.stockReservation.update({ where: { id: second.id }, data: {
        createdAt: new Date(second.createdAt.getTime() - 7200000), expiresAt: new Date(second.createdAt.getTime() - 3600000),
      } });
      await expect(inventory.commit(second.id, f.userId)).rejects.toBeInstanceOf(ConflictException);
      expect((await inventory.reservation(second.id)).status).toBe('EXPIRED');
      expect(await balance(f)).toMatchObject({ onHand: 5, reserved: 0 });
      expect(await database.stockMovement.count({ where: { variantId: f.variantId, type: 'RELEASE' } })).toBe(2);
    });
  });

  it('serializes cart adds, reprices reads and protects item ownership', async () => {
    await fixture(async (f) => {
      await carts.get(user(f));
      await Promise.all([carts.add(user(f), f.variantId, 1), carts.add(user(f), f.variantId, 1)]);
      let cart = await carts.get(user(f));
      expect(cart.items).toHaveLength(1);
      expect(cart.items[0].quantity).toBe(2);
      expect(cart.subtotal).toBe(2000);
      expect((await balance(f)).reserved).toBe(0);
      await expect(carts.update({ kind: 'user', userId: f.otherUserId }, cart.items[0].id, 1)).rejects.toBeInstanceOf(NotFoundException);
      await database.productVariant.update({ where: { id: f.variantId }, data: { price: 1200 } });
      cart = await carts.get(user(f));
      expect(cart.subtotal).toBe(2400);
      await inventory.reserve({ variantId: f.variantId, locationId: f.locationId, quantity: 4, ttlSeconds: 900, reason: 'Another checkout reservation' }, randomUUID(), f.userId);
      cart = await carts.get(user(f));
      expect(cart.items[0]).toMatchObject({ available: false, availableQuantity: 1, issue: 'INSUFFICIENT_STOCK' });
      expect(cart.canCheckout).toBe(false);
      await database.product.update({ where: { id: f.productId }, data: { status: 'DRAFT', publishedAt: null } });
      cart = await carts.get(user(f));
      expect(cart.items[0]).toMatchObject({ product: null, unitPrice: null, issue: 'UNAVAILABLE' });
      expect(cart.subtotal).toBeNull();
      await carts.update(user(f), cart.items[0].id, 1);
      expect((await carts.clear(user(f))).itemCount).toBe(0);
    });
  });

  it('merges a guest cart once even when login requests race', async () => {
    await fixture(async (f) => {
      const g = await guest(f);
      await carts.add(g.owner, f.variantId, 2);
      await carts.add(user(f), f.variantId, 1);
      const results = await Promise.all([carts.mergeOnLogin(f.userId, g.token), carts.mergeOnLogin(f.userId, g.token)]);
      expect(results.map((result) => result.status).sort()).toEqual(['already_merged', 'merged']);
      expect((await carts.get(user(f))).items[0].quantity).toBe(3);
      await expect(carts.get(g.owner)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(carts.get({ kind: 'guest', token: randomUUID() })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(await database.cartItem.count({ where: { cartId: g.cart.id } })).toBe(0);
    });
  });

  it('defers over-limit merges without losing either cart and permits a later retry', async () => {
    await fixture(async (f) => {
      await inventory.adjust({ variantId: f.variantId, locationId: f.locationId, delta: 95, reason: 'Stock for quantity-limit test', type: 'ADJUSTMENT' }, randomUUID(), f.userId);
      const g = await guest(f);
      await carts.add(g.owner, f.variantId, 2);
      await carts.add(user(f), f.variantId, 98);
      expect(await carts.mergeOnLogin(f.userId, g.token)).toEqual({ status: 'deferred', reason: 'QUANTITY_LIMIT' });
      expect((await carts.get(g.owner)).items[0].quantity).toBe(2);
      const current = await carts.get(user(f));
      expect(current.items[0].quantity).toBe(98);
      await carts.update(user(f), current.items[0].id, 97);
      expect((await carts.mergeOnLogin(f.userId, g.token)).status).toBe('merged');
      expect((await carts.get(user(f))).items[0].quantity).toBe(99);
    });
  });

  it('rejects expired guest access and safely resets an expired customer cart', async () => {
    await fixture(async (f) => {
      const g = await guest(f);
      await carts.add(g.owner, f.variantId, 1);
      const customer = await carts.add(user(f), f.variantId, 1);
      const [time] = await database.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      await database.cart.updateMany({ where: { id: { in: [g.cart.id, customer.id] } }, data: {
        createdAt: new Date(time.now.getTime() - 7200000), expiresAt: new Date(time.now.getTime() - 3600000),
      } });
      await expect(carts.get(g.owner)).rejects.toBeInstanceOf(UnauthorizedException);
      expect((await carts.get(user(f))).items).toEqual([]);
    });
  });
});
