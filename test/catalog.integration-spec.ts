import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { hash, argon2id } from 'argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { ProductQueryDto, type CreateProductDto } from '../src/modules/catalog/catalog.dto.js';
import { testDatabaseUrl } from './helpers/test-database.js';

describe('catalog publishing and persistence (isolated test database)', () => {
  let database: PrismaService | undefined;
  let passwordHash: string;
  const rollback = new Error('rollback catalog fixtures');

  beforeAll(async () => {
    database = new PrismaService(new ConfigService({ DATABASE_URL: testDatabaseUrl() }));
    await database.$connect();
    passwordHash = await hash('catalog-test-fixture-password', { type: argon2id });
  });

  afterAll(async () => { await database?.$disconnect(); });

  async function inTransaction(work: (service: CatalogService, tx: Prisma.TransactionClient, actorId: string) => Promise<void>) {
    if (!database) throw new Error('Test database is not initialized.');
    try {
      await database.$transaction(async (tx) => {
        await tx.inventoryLocation.upsert({ where: { code: 'PRIMARY' }, update: {}, create: { code: 'PRIMARY', name: 'Primary fixture warehouse' } });
        const actor = await tx.user.create({ data: { firstName: 'Catalog', lastName: 'Fixture', email: `${randomUUID()}@example.com`, passwordHash } });
        const persistence = {
          product: tx.product, category: tx.category, collection: tx.collection,
          $queryRaw: tx.$queryRaw.bind(tx),
          $transaction: (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => callback(tx),
        } as unknown as PrismaService;
        await work(new CatalogService(persistence), tx, actor.id);
        throw rollback;
      }, { timeout: 20000 });
    } catch (error) { if (error !== rollback) throw error; }
  }

  async function fixture(service: CatalogService, actorId: string) {
    const suffix = randomUUID();
    const category = await service.createCategory({ name: `Shirts ${suffix}`, slug: `shirts-${suffix}` }, actorId);
    const collection = await service.createCollection({ name: `Summer ${suffix}`, slug: `summer-${suffix}`, title: 'Summer', description: '' }, actorId);
    const dto: CreateProductDto = {
      name: 'Linen Shirt', slug: `linen-shirt-${suffix}`, description: 'A linen shirt.', material: 'Linen', care: 'Wash cold',
      categoryIds: [category.id], collectionIds: [collection.id], images: [{ url: 'https://example.com/shirt.jpg', altText: 'Linen Shirt' }],
      variants: [{ sku: `LINEN-${suffix}`, size: 'M', colorName: 'Black', colorHex: '#282828', price: 1000, compareAtPrice: 1200 }],
    };
    const product = await service.createProduct(dto, actorId);
    return { product, dto, category, collection, query: Object.assign(new ProductQueryDto(), { category: category.slug }) };
  }

  it('keeps drafts private, publishes a real product and hides it again on unpublish/archive', async () => {
    await inTransaction(async (service, tx, actorId) => {
      const { product, dto, category, query } = await fixture(service, actorId);
      expect(product.status).toBe('DRAFT');
      expect(await service.list(query)).toEqual({ items: [], total: 0 });
      await expect(service.bySlug(dto.slug)).rejects.toBeInstanceOf(NotFoundException);
      await service.publish(product.id, actorId);
      const publicProduct = await service.bySlug(dto.slug);
      expect(publicProduct).toMatchObject({ name: dto.name, price: 1000, originalPrice: 1200, currency: 'USD', stock: 0, availability: 'Out of Stock', category: category.name, collections: [] });
      expect(publicProduct.variants).toHaveLength(1);
      expect((await service.list(query)).total).toBe(1);
      expect(await tx.auditLog.count({ where: { entityId: product.id, action: 'product.publish' } })).toBe(1);
      await service.unpublish(product.id, actorId);
      await expect(service.bySlug(dto.slug)).rejects.toBeInstanceOf(NotFoundException);
      await service.archive(product.id, actorId);
      expect((await service.adminProduct(product.id)).variants).toHaveLength(1);
      await expect(service.publish(product.id, actorId)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('filters exact available stock across active locations without trusting client prices', async () => {
    await inTransaction(async (service, tx, actorId) => {
      const { product, query, dto } = await fixture(service, actorId);
      const variant = (await service.adminProduct(product.id)).variants[0];
      const first = await tx.inventoryLocation.create({ data: { code: randomUUID(), name: 'First fixture location' } });
      const second = await tx.inventoryLocation.create({ data: { code: randomUUID(), name: 'Second fixture location' } });
      await tx.inventoryBalance.createMany({ data: [
        { variantId: variant.id, locationId: first.id, onHand: 5, reserved: 2 },
        { variantId: variant.id, locationId: second.id, onHand: 4, reserved: 1 },
      ] });
      await service.publish(product.id, actorId);
      expect((await service.bySlug(dto.slug)).stock).toBe(6);
      expect((await service.list(Object.assign(new ProductQueryDto(), query, { availability: 'In Stock' }))).total).toBe(1);
      await tx.inventoryLocation.update({ where: { id: second.id }, data: { isActive: false } });
      expect((await service.bySlug(dto.slug)).stock).toBe(3);
      expect((await service.list(Object.assign(new ProductQueryDto(), query, { availability: 'In Stock' }))).total).toBe(0);
      expect((await service.list(Object.assign(new ProductQueryDto(), query, { availability: 'Limited Pieces' }))).total).toBe(1);
      expect((await service.list(Object.assign(new ProductQueryDto(), query, { maxPrice: 999 }))).total).toBe(0);
      expect((await service.list(Object.assign(new ProductQueryDto(), query, { search: '%' }))).total).toBe(0);
      expect((await service.list(Object.assign(new ProductQueryDto(), query, { search: 'linen', minPrice: 1000, maxPrice: 1000 }))).total).toBe(1);
      const page = await service.list(Object.assign(new ProductQueryDto(), query, { page: 2, limit: 1 }));
      expect(page).toEqual({ items: [], total: 1 });
    });
  });

  it('does not publish invalid products or archive the last published variant', async () => {
    await inTransaction(async (service, tx, actorId) => {
      const { product } = await fixture(service, actorId);
      const stored = await service.adminProduct(product.id);
      await service.publish(product.id, actorId);
      await expect(service.archiveVariant(product.id, stored.variants[0].id, actorId)).rejects.toBeInstanceOf(BadRequestException);
      expect((await service.adminProduct(product.id)).variants[0].status).toBe('ACTIVE');
      await service.unpublish(product.id, actorId);
      await tx.productImage.deleteMany({ where: { productId: product.id } });
      await expect(service.publish(product.id, actorId)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('rejects duplicate active option combinations and conflicting color definitions', async () => {
    await inTransaction(async (service, _tx, actorId) => {
      const { product, dto } = await fixture(service, actorId);
      const variant=dto.variants[0];
      const fields={price:variant.price,compareAtPrice:variant.compareAtPrice,size:variant.size,colorName:variant.colorName,colorHex:variant.colorHex};
      await expect(service.createVariant(product.id, { ...fields, sku: `DUP-${randomUUID()}` }, actorId)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.createVariant(product.id, { ...fields, sku: `COLOR-${randomUUID()}`, size: 'L', colorHex: '#ffffff' }, actorId)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('isolates draft collections, validates variant ownership and recalculates public prices', async () => {
    await inTransaction(async (service, tx, actorId) => {
      const { product, dto, collection } = await fixture(service, actorId);
      await expect(service.collection(collection.slug)).rejects.toBeInstanceOf(NotFoundException);
      await service.publishCollection(collection.id, true, actorId);
      expect((await service.collection(collection.slug)).slug).toBe(collection.slug);
      await service.publish(product.id, actorId);
      expect((await service.bySlug(dto.slug)).collections).toEqual([collection.slug]);
      const variant = (await service.adminProduct(product.id)).variants[0];
      await service.priceVariant(product.id, variant.id, { price: 900, compareAtPrice: 1000 }, actorId);
      expect((await service.bySlug(dto.slug)).price).toBe(900);
      await expect(service.priceVariant(product.id, randomUUID(), { price: 1000 }, actorId)).rejects.toBeInstanceOf(NotFoundException);
      await tx.product.update({ where: { id: product.id }, data: { publishedAt: new Date(Date.now() + 86400000) } });
      await expect(service.bySlug(dto.slug)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
