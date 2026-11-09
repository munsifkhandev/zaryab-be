import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { ProductQueryDto } from './catalog.dto.js';

export const productInclude = {
  images: { orderBy: [{ position: 'asc' }, { id: 'asc' }] },
  categories: { include: { category: true }, orderBy: { category: { name: 'asc' } } },
  collections: { include: { collection: true } },
  variants: { orderBy: [{ price: 'asc' }, { id: 'asc' }], include: {
    optionValues: { include: { value: { include: { option: true } } } },
    balances: { where: { location: { isActive: true } }, select: { onHand: true, reserved: true } },
  } },
} satisfies Prisma.ProductInclude;

export type CatalogProduct = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
type Variant = CatalogProduct['variants'][number];

export function variantChoices(variant: Variant) {
  const size = variant.optionValues.find(({ value }) => value.option.name === 'Size')?.value.value;
  const color = variant.optionValues.find(({ value }) => value.option.name === 'Color')?.value;
  return size && color?.colorHex ? { size, color: { name: color.value, value: color.colorHex } } : null;
}

export function eligibleVariants(product: CatalogProduct) {
  return product.variants.filter((variant) => variant.status === 'ACTIVE' && variantChoices(variant));
}

export function assertPublishable(product: CatalogProduct): void {
  const active = product.variants.filter((variant) => variant.status === 'ACTIVE');
  if (!product.images.length || !product.categories.length || !active.length || active.some((variant) => !variantChoices(variant))) {
    throw new BadRequestException();
  }
}

export function storeProduct(product: CatalogProduct) {
  const variants = eligibleVariants(product).map((variant) => ({
    id: variant.id, sku: variant.sku, price: variant.price,
    originalPrice: variant.compareAtPrice ?? variant.price, currency: variant.currency,
    available: variant.balances.reduce((total, balance) => total + balance.onHand - balance.reserved, 0),
    ...variantChoices(variant)!,
  }));
  if (!variants.length || !product.images.length || !product.categories.length) throw new BadRequestException();
  const stock = Math.min(99, variants.reduce((sum, variant) => sum + variant.available, 0));
  const representative = variants[0];
  return {
    id: product.id, slug: product.slug, name: product.name, description: product.description,
    price: representative.price, originalPrice: representative.originalPrice, currency: 'USD' as const,
    images: product.images.map((image) => image.url), category: product.categories[0].category.name,
    collections: product.collections.filter(({ collection }) => collection.isPublished).map(({ collection }) => collection.slug).sort(),
    availability: stock === 0 ? 'Out of Stock' : stock <= 3 ? 'Limited Pieces' : 'In Stock', stock,
    colors: [...new Map(variants.map((variant) => [variant.color.name, variant.color])).values()],
    sizes: [...new Set(variants.map((variant) => variant.size))],
    ...(representative.originalPrice > representative.price ? { badge: 'Sale' } : {}),
    material: product.material, care: product.care,
    variants: variants.map(({ available, ...variant }) => ({ ...variant, stock: Math.min(99, available) })),
  };
}

export function publicProductSql(query: ProductQueryDto, slug?: string) {
  if (query.minPrice !== undefined && query.maxPrice !== undefined && query.minPrice > query.maxPrice) throw new BadRequestException();
  const conditions: Prisma.Sql[] = [];
  if (query.category) conditions.push(Prisma.sql`EXISTS (
    SELECT 1 FROM product_categories pc JOIN categories c ON c.id = pc.category_id
    WHERE pc.product_id = p.id AND (c.name = ${query.category} OR c.slug = ${query.category}))`);
  if (query.collection) conditions.push(Prisma.sql`EXISTS (
    SELECT 1 FROM product_collections pc JOIN collections c ON c.id = pc.collection_id
    WHERE pc.product_id = p.id AND c.slug = ${query.collection} AND c.is_published)`);
  if (query.search) {
    const literal = query.search.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
    conditions.push(Prisma.sql`p.name ILIKE ${`%${literal}%`} ESCAPE '!'`);
  }
  if (query.minPrice !== undefined) conditions.push(Prisma.sql`s.price >= ${query.minPrice}`);
  if (query.maxPrice !== undefined) conditions.push(Prisma.sql`s.price <= ${query.maxPrice}`);
  if (query.availability === 'In Stock') conditions.push(Prisma.sql`s.stock > 3`);
  if (query.availability === 'Limited Pieces') conditions.push(Prisma.sql`s.stock BETWEEN 1 AND 3`);
  if (query.availability === 'Out of Stock') conditions.push(Prisma.sql`s.stock = 0`);
  return Prisma.sql`
    WITH variant_stock AS (
      SELECT v.id, v.product_id, v.price,
        COALESCE(SUM(b.on_hand::bigint - b.reserved) FILTER (WHERE l.is_active), 0) AS stock
      FROM product_variants v
      LEFT JOIN inventory_balances b ON b.variant_id = v.id
      LEFT JOIN inventory_locations l ON l.id = b.location_id
      WHERE v.status = 'ACTIVE'
        ${slug ? Prisma.sql`AND v.product_id = (SELECT id FROM products WHERE slug = ${slug})` : Prisma.empty}
        AND EXISTS (SELECT 1 FROM variant_option_values ov JOIN product_option_values pv ON pv.id = ov.value_id
          JOIN product_options o ON o.id = pv.option_id WHERE ov.variant_id = v.id AND o.name = 'Size' AND pv.value <> '')
        AND EXISTS (SELECT 1 FROM variant_option_values ov JOIN product_option_values pv ON pv.id = ov.value_id
          JOIN product_options o ON o.id = pv.option_id WHERE ov.variant_id = v.id AND o.name = 'Color' AND pv.color_hex IS NOT NULL)
      GROUP BY v.id, v.product_id, v.price
    ), product_stock AS (
      SELECT product_id, MIN(price) AS price, SUM(stock) AS stock FROM variant_stock GROUP BY product_id
    )
    SELECT p.id, p.published_at, s.price FROM products p JOIN product_stock s ON s.product_id = p.id
    WHERE p.status = 'PUBLISHED' AND p.published_at <= CURRENT_TIMESTAMP
      AND EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)
      AND EXISTS (SELECT 1 FROM product_categories c WHERE c.product_id = p.id)
      ${conditions.length ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}` : Prisma.empty}`;
}
