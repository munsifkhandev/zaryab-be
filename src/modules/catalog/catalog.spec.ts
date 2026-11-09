import { ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateProductDto, ProductQueryDto, UpdateProductDto } from './catalog.dto.js';
import { assertPublishable, publicProductSql, storeProduct, type CatalogProduct } from './catalog.policy.js';

function productFixture(): CatalogProduct {
  return {
    id: 'product', slug: 'linen-shirt', name: 'Linen Shirt', description: 'Plain text', material: 'Linen', care: 'Wash cold',
    images: [{ url: 'https://example.com/shirt.jpg' }], categories: [{ category: { name: 'Shirts' } }],
    collections: [{ collection: { isPublished: true, slug: 'summer' } }, { collection: { isPublished: false, slug: 'private-campaign' } }],
    variants: [{ id: 'variant', sku: 'LINEN-M-BLACK', status: 'ACTIVE', price: 1000, compareAtPrice: 1200, currency: 'USD',
      balances: [{ onHand: 5, reserved: 2 }],
      optionValues: [
        { value: { value: 'M', colorHex: null, option: { name: 'Size' } } },
        { value: { value: 'Black', colorHex: '#282828', option: { name: 'Color' } } },
      ],
    }],
  } as unknown as CatalogProduct;
}

describe('store catalog policy', () => {
  it('matches the storefront shape while excluding unpublished collection links', () => {
    const product = storeProduct(productFixture());
    expect(product).toMatchObject({
      price: 1000, originalPrice: 1200, currency: 'USD', category: 'Shirts', collections: ['summer'],
      stock: 3, availability: 'Limited Pieces', sizes: ['M'], colors: [{ name: 'Black', value: '#282828' }], badge: 'Sale',
    });
    expect(product.variants[0]).toMatchObject({ id: 'variant', stock: 3, size: 'M', price: 1000 });
    expect(JSON.stringify(product)).not.toContain('private-campaign');
  });

  it('subtracts reserved stock, caps display quantities and excludes archived variants', () => {
    const fixture = productFixture();
    fixture.variants.push({ ...fixture.variants[0], id: 'archived', price: 1, status: 'ARCHIVED' });
    fixture.variants[0].balances = [{ onHand: 500, reserved: 2 }];
    expect(storeProduct(fixture)).toMatchObject({ stock: 99, availability: 'In Stock', price: 1000 });
    fixture.variants[0].balances = [];
    expect(storeProduct(fixture)).toMatchObject({ stock: 0, availability: 'Out of Stock' });
  });

  it('rejects publication without images, categories or valid active variants', () => {
    for (const field of ['images', 'categories', 'variants'] as const) {
      const fixture = productFixture();
      fixture[field] = [];
      expect(() => assertPublishable(fixture)).toThrow();
    }
    const fixture = productFixture();
    fixture.variants[0].optionValues = [];
    expect(() => assertPublishable(fixture)).toThrow();
  });

  it('parameterizes search/filter input and rejects inverted price bounds', () => {
    const query = Object.assign(new ProductQueryDto(), { search: "%' OR true --", category: "x' OR true --" });
    const sql = publicProductSql(query);
    expect(sql.text).not.toContain('OR true');
    expect(sql.values).toContain("%!%' OR true --%");
    expect(sql.values).toContain("x' OR true --");
    expect(() => publicProductSql(Object.assign(new ProductQueryDto(), { minPrice: 200, maxPrice: 100 }))).toThrow();
  });
});

describe('catalog input boundaries', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, errorHttpStatusCode: 422 });
  const input = () => ({
    name: 'Linen Shirt', slug: 'linen-shirt', description: '', material: 'Linen', care: 'Wash cold',
    categoryIds: [randomUUID()], collectionIds: [], images: [{ url: 'https://example.com/shirt.jpg' }],
    variants: [{ sku: 'linen-m-black', price: 1000, size: 'm', colorName: 'Black', colorHex: '#282828' }],
  });

  it('normalizes variant identifiers and validates nested data', async () => {
    const result = await pipe.transform(input(), { type: 'body', metatype: CreateProductDto });
    expect(result.variants[0]).toMatchObject({ sku: 'LINEN-M-BLACK', size: 'M' });
  });

  it('rejects publication injection, negative/fractional prices and unsafe image protocols', async () => {
    for (const body of [
      { ...input(), status: 'PUBLISHED' },
      { ...input(), images: [{ url: 'javascript:alert(1)' }] },
      { ...input(), images: [] },
      { ...input(), categoryIds: [] },
      { ...input(), variants: [{ ...input().variants[0], price: 1.5 }] },
      { ...input(), variants: [{ ...input().variants[0], price: -1 }] },
      { ...input(), variants: [null] },
    ]) await expect(pipe.transform(body, { type: 'body', metatype: CreateProductDto })).rejects.toMatchObject({ status: 422 });
  });

  it('rejects null edits and validates pagination/filter bounds', async () => {
    await expect(pipe.transform({ name: null }, { type: 'body', metatype: UpdateProductDto })).rejects.toMatchObject({ status: 422 });
    for (const query of [{ limit: '121' }, { page: '0' }, { minPrice: '-1' }, { sort: 'sql' }, { availability: 'unknown' }]) {
      await expect(pipe.transform(query, { type: 'query', metatype: ProductQueryDto })).rejects.toMatchObject({ status: 422 });
    }
    expect(await pipe.transform({ page: '2', limit: '6' }, { type: 'query', metatype: ProductQueryDto })).toMatchObject({ page: 2, limit: 6 });
  });
});
