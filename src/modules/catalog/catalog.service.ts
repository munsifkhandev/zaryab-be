import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AdminProductQueryDto, CategoryDto, CollectionDto, CreateProductDto, CreateVariantDto,
  PageQueryDto, ProductQueryDto, UpdateProductDto, VariantPriceDto,
} from './catalog.dto.js';
import { assertPublishable, productInclude, publicProductSql, storeProduct } from './catalog.policy.js';

type Transaction = Prisma.TransactionClient;
const summarySelect = { id: true, slug: true, status: true } satisfies Prisma.ProductSelect;
type ProductSummary = Prisma.ProductGetPayload<{ select: typeof summarySelect }>;

@Injectable()
export class CatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async write<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(work, { timeout: 15000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ConflictException();
        if (['P2003', 'P2025'].includes(error.code)) throw new BadRequestException();
      }
      throw error;
    }
  }

  private async lock(tx: Transaction, id: string) {
    const rows = await tx.$queryRaw<{ id: string; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' }[]>`
      SELECT id, status FROM products WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  private audit(tx: Transaction, actorId: string, action: string, id: string, entityType = 'product') {
    return tx.auditLog.create({ data: { actorId, action, entityType, entityId: id } });
  }

  private async addVariant(tx: Transaction, productId: string, dto: CreateVariantDto) {
    if (dto.compareAtPrice != null && dto.compareAtPrice < dto.price) throw new BadRequestException();
    if (await tx.productVariant.count({ where: { productId } }) >= 60) throw new BadRequestException();
    const selections: { optionId: string; valueId: string; productId: string }[] = [];
    for (const choice of [
      { name: 'Size', value: dto.size.trim().toUpperCase(), hex: null, position: 0 },
      { name: 'Color', value: dto.colorName.trim(), hex: dto.colorHex.toLowerCase(), position: 1 },
    ]) {
      const option = await tx.productOption.upsert({
        where: { productId_name: { productId, name: choice.name } }, update: {},
        create: { productId, name: choice.name, position: choice.position },
      });
      let value = await tx.productOptionValue.findFirst({
        where: { optionId: option.id, value: { equals: choice.value, mode: 'insensitive' } },
      });
      if (value && value.colorHex?.toLowerCase() !== choice.hex && choice.name === 'Color') throw new BadRequestException();
      value ??= await tx.productOptionValue.create({
        data: { optionId: option.id, productId, value: choice.value, colorHex: choice.hex },
      });
      selections.push({ optionId: option.id, valueId: value.id, productId });
    }
    const duplicate = await tx.productVariant.findFirst({ where: {
      productId, status: 'ACTIVE', AND: selections.map(({ valueId }) => ({ optionValues: { some: { valueId } } })),
    }, select: { id: true } });
    if (duplicate) throw new ConflictException();
    const primary = await tx.inventoryLocation.findUnique({ where: { code: 'PRIMARY' }, select: { id: true } });
    if (!primary) throw new ServiceUnavailableException();
    return tx.productVariant.create({ data: {
      productId, sku: dto.sku.trim().toUpperCase(), price: dto.price, compareAtPrice: dto.compareAtPrice,
      optionValues: { create: selections.map(({ optionId, valueId }) => ({ optionId, valueId })) },
      balances: { create: { locationId: primary.id } },
    }, select: { id: true, sku: true, price: true, compareAtPrice: true, status: true } });
  }

  async createProduct(dto: CreateProductDto, actorId: string) {
    return this.write(async (tx) => {
      const { variants, images, categoryIds, collectionIds, ...fields } = dto;
      const product = await tx.product.create({ data: {
        ...fields,
        images: { create: images.map((image, position) => ({ url: image.url, altText: image.altText ?? '', position })) },
        categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
        collections: { create: collectionIds.map((collectionId) => ({ collectionId })) },
      }, select: summarySelect });
      for (const variant of variants) await this.addVariant(tx, product.id, variant);
      await this.audit(tx, actorId, 'product.create', product.id);
      return product;
    });
  }

  async updateProduct(id: string, dto: UpdateProductDto, actorId: string) {
    return this.write(async (tx) => {
      const product = await this.lock(tx, id);
      if (product.status === 'ARCHIVED') throw new ConflictException();
      const { images, categoryIds, collectionIds, ...fields } = dto;
      if (Object.values(dto).every((value) => value === undefined)) throw new BadRequestException();
      const updated = await tx.product.update({ where: { id }, data: {
        ...fields,
        ...(images !== undefined ? { images: { deleteMany: {}, create: images.map((image, position) => ({ url: image.url, altText: image.altText ?? '', position })) } } : {}),
        ...(categoryIds !== undefined ? { categories: { deleteMany: {}, create: categoryIds.map((categoryId) => ({ categoryId })) } } : {}),
        ...(collectionIds !== undefined ? { collections: { deleteMany: {}, create: collectionIds.map((collectionId) => ({ collectionId })) } } : {}),
      }, select: summarySelect });
      await this.audit(tx, actorId, 'product.update', id);
      return updated;
    });
  }

  async publish(id: string, actorId: string) {
    return this.write(async (tx) => {
      const locked = await this.lock(tx, id);
      if (locked.status === 'ARCHIVED') throw new ConflictException();
      const product = await tx.product.findUniqueOrThrow({ where: { id }, include: productInclude });
      assertPublishable(product);
      // Use the database clock, matching public eligibility and avoiding host clock skew.
      const [updated] = await tx.$queryRaw<ProductSummary[]>`
        UPDATE products SET status = 'PUBLISHED', published_at = COALESCE(published_at, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP WHERE id = ${id}::uuid RETURNING id, slug, status`;
      await this.audit(tx, actorId, 'product.publish', id);
      return updated;
    });
  }

  async unpublish(id: string, actorId: string) {
    return this.write(async (tx) => {
      const product = await this.lock(tx, id);
      if (product.status === 'ARCHIVED') throw new ConflictException();
      const updated = await tx.product.update({ where: { id }, data: { status: 'DRAFT', publishedAt: null }, select: summarySelect });
      await this.audit(tx, actorId, 'product.unpublish', id);
      return updated;
    });
  }

  async archive(id: string, actorId: string) {
    return this.write(async (tx) => {
      const product = await this.lock(tx, id);
      const updated = await tx.product.update({ where: { id }, data: { status: 'ARCHIVED' }, select: summarySelect });
      if (product.status !== 'ARCHIVED') await this.audit(tx, actorId, 'product.archive', id);
      return updated;
    });
  }

  async createVariant(id: string, dto: CreateVariantDto, actorId: string) {
    return this.write(async (tx) => {
      const product = await this.lock(tx, id);
      if (product.status === 'ARCHIVED') throw new ConflictException();
      const variant = await this.addVariant(tx, id, dto);
      await this.audit(tx, actorId, 'variant.create', variant.id, 'product_variant');
      return variant;
    });
  }

  async priceVariant(id: string, variantId: string, dto: VariantPriceDto, actorId: string) {
    if (dto.compareAtPrice != null && dto.compareAtPrice < dto.price) throw new BadRequestException();
    return this.write(async (tx) => {
      const product = await this.lock(tx, id);
      if (product.status === 'ARCHIVED') throw new ConflictException();
      const changed = await tx.productVariant.updateMany({ where: { id: variantId, productId: id, status: 'ACTIVE' }, data: { price: dto.price, compareAtPrice: dto.compareAtPrice ?? null } });
      if (changed.count !== 1) throw new NotFoundException();
      await this.audit(tx, actorId, 'variant.price', variantId, 'product_variant');
      return tx.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { id: true, sku: true, price: true, compareAtPrice: true, status: true } });
    });
  }

  async archiveVariant(id: string, variantId: string, actorId: string) {
    return this.write(async (tx) => {
      const product = await this.lock(tx, id);
      if (product.status === 'ARCHIVED') throw new ConflictException();
      const variant = await tx.productVariant.findFirst({ where: { id: variantId, productId: id } });
      if (!variant) throw new NotFoundException();
      if (variant.status === 'ARCHIVED') return { id: variantId, status: 'ARCHIVED' as const };
      if (product.status === 'PUBLISHED') {
        const current = await tx.product.findUniqueOrThrow({ where: { id }, include: productInclude });
        assertPublishable({ ...current, variants: current.variants.filter((item) => item.id !== variantId) });
      }
      await tx.productVariant.update({ where: { id: variantId }, data: { status: 'ARCHIVED' } });
      await this.audit(tx, actorId, 'variant.archive', variantId, 'product_variant');
      return { id: variantId, status: 'ARCHIVED' as const };
    });
  }

  async adminList(query: AdminProductQueryDto) {
    const where = query.status ? { status: query.status } : {};
    return this.prisma.$transaction(async (tx) => ({
      items: await tx.product.findMany({ where, select: { ...summarySelect, name: true, createdAt: true, updatedAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
      total: await tx.product.count({ where }),
    }), { isolationLevel: 'RepeatableRead' });
  }

  async adminProduct(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: productInclude });
    if (!product) throw new NotFoundException();
    // Product readers get available quantities; reserved/on-hand balances belong to inventory APIs.
    return { ...product, variants: product.variants.map(({ balances, ...variant }) => ({
      ...variant, stock: balances.reduce((sum, balance) => sum + balance.onHand - balance.reserved, 0),
    })) };
  }

  async list(query: ProductQueryDto) {
    const selection = publicProductSql(query);
    const order = query.sort === 'price-asc' ? Prisma.sql`q.price ASC, q.published_at DESC, q.id ASC`
      : query.sort === 'price-desc' ? Prisma.sql`q.price DESC, q.published_at DESC, q.id ASC`
      : Prisma.sql`q.published_at DESC, q.id ASC`;
    return this.prisma.$transaction(async (tx) => {
      const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total FROM (${selection}) q`;
      const ids = await tx.$queryRaw<{ id: string }[]>`
        SELECT q.id FROM (${selection}) q ORDER BY ${order}
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
      const products = await tx.product.findMany({ where: { id: { in: ids.map(({ id }) => id) } }, include: productInclude });
      const byId = new Map(products.map((product) => [product.id, product]));
      return { items: ids.map(({ id }) => storeProduct(byId.get(id)!)), total: count.total };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async bySlug(slug: string) {
    return this.prisma.$transaction(async (tx) => {
      const [eligible] = await tx.$queryRaw<{ id: string }[]>`
        SELECT q.id FROM (${publicProductSql(new ProductQueryDto(), slug)}) q`;
      if (!eligible) throw new NotFoundException();
      return storeProduct(await tx.product.findUniqueOrThrow({ where: { id: eligible.id }, include: productInclude }));
    }, { isolationLevel: 'RepeatableRead' });
  }

  async categories() {
    const rows = await this.prisma.$queryRaw<{ name: string }[]>`
      SELECT DISTINCT c.name FROM categories c JOIN product_categories pc ON pc.category_id = c.id
      JOIN (${publicProductSql(new ProductQueryDto())}) q ON q.id = pc.product_id ORDER BY c.name LIMIT 100`;
    return rows.map(({ name }) => name);
  }

  collections() {
    return this.prisma.collection.findMany({ where: { isPublished: true }, select: { slug: true, name: true, title: true, description: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100 });
  }

  async collection(slug: string) {
    const collection = await this.prisma.collection.findFirst({ where: { slug, isPublished: true }, select: { slug: true, name: true, title: true, description: true } });
    if (!collection) throw new NotFoundException();
    return collection;
  }

  adminCategories(query: PageQueryDto) {
    return this.prisma.category.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], take: query.limit, skip: (query.page - 1) * query.limit });
  }

  adminCollections(query: PageQueryDto) {
    return this.prisma.collection.findMany({ orderBy: [{ name: 'asc' }, { id: 'asc' }], take: query.limit, skip: (query.page - 1) * query.limit });
  }

  createCategory(dto: CategoryDto, actorId: string) {
    return this.write(async (tx) => {
      const category = await tx.category.create({ data: { name: dto.name, slug: dto.slug } });
      await this.audit(tx, actorId, 'category.create', category.id, 'category');
      return category;
    });
  }

  createCollection(dto: CollectionDto, actorId: string) {
    return this.write(async (tx) => {
      const collection = await tx.collection.create({ data: { name: dto.name, slug: dto.slug, title: dto.title, description: dto.description } });
      await this.audit(tx, actorId, 'collection.create', collection.id, 'collection');
      return collection;
    });
  }

  publishCollection(id: string, isPublished: boolean, actorId: string) {
    return this.write(async (tx) => {
      const changed = await tx.collection.updateMany({ where: { id }, data: { isPublished } });
      if (!changed.count) throw new NotFoundException();
      await this.audit(tx, actorId, 'collection.publication', id, 'collection');
      return tx.collection.findUniqueOrThrow({ where: { id } });
    });
  }
}
