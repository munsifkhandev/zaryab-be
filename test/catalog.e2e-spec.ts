import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { configureApp } from '../src/config/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import type { AuthContext } from '../src/modules/auth/auth.types.js';
import { csrfTokenFor, newSessionToken } from '../src/modules/auth/auth.tokens.js';
import { CatalogModule } from '../src/modules/catalog/catalog.module.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { StoreCatalogController } from '../src/modules/catalog/store-catalog.controller.js';
import { AdminProductsController } from '../src/modules/catalog/admin-catalog.controller.js';
import { AdminProductQueryDto, CreateProductDto, ProductQueryDto, SlugParamDto } from '../src/modules/catalog/catalog.dto.js';

Reflect.defineMetadata('design:paramtypes', [ProductQueryDto], StoreCatalogController.prototype, 'list');
Reflect.defineMetadata('design:paramtypes', [SlugParamDto], StoreCatalogController.prototype, 'product');
Reflect.defineMetadata('design:paramtypes', [CreateProductDto, Object], AdminProductsController.prototype, 'create');
Reflect.defineMetadata('design:paramtypes', [AdminProductQueryDto], AdminProductsController.prototype, 'list');

describe('catalog HTTP access boundaries (mocked persistence)', () => {
  let app: INestApplication;
  let auth: AuthContext;
  let token: string;
  const catalog = { list: vi.fn(), adminList: vi.fn(), bySlug: vi.fn(), createProduct: vi.fn(), publish: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    token = newSessionToken();
    auth = { sessionId: randomUUID(), csrfToken: csrfTokenFor(token), expiresAt: new Date(Date.now() + 60000),
      user: { id: randomUUID(), firstName: 'Test', lastName: 'User', email: 'fixture@example.com', phone: null, emailVerifiedAt: null, roles: ['CUSTOMER'], permissions: [] } };
    catalog.list.mockResolvedValue({ items: [], total: 0 });
    catalog.adminList.mockResolvedValue({ items: [], total: 0 });
    catalog.createProduct.mockResolvedValue({ id: randomUUID(), slug: 'linen-shirt', status: 'DRAFT' });
    catalog.publish.mockResolvedValue({ id: randomUUID(), slug: 'linen-shirt', status: 'PUBLISHED' });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/unused' })] }),
      AuthModule, CatalogModule,
    ] }).overrideProvider(PrismaService).useValue({})
      .overrideProvider(AuthService).useValue({ tokenFromRequest: (req: { cookies?: Record<string, string> }) => req.cookies?.zaryab_session === token ? token : undefined, authenticate: vi.fn(async () => auth) })
      .overrideProvider(CatalogService).useValue(catalog).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  function headers() { return { Cookie: `zaryab_session=${token}`, Origin: 'http://localhost:3001', 'X-CSRF-Token': auth.csrfToken }; }

  it('supports public storefront paths and the documented store aliases', async () => {
    for (const path of ['/products', '/store/products', '/store/search']) {
      await request(app.getHttpServer()).get(`/api/v1${path}?limit=6`).expect(200).expect({ items: [], total: 0 });
    }
    expect(catalog.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 6, page: 1 }));
  });

  it('rejects invalid public pagination and slugs', async () => {
    await request(app.getHttpServer()).get('/api/v1/products?limit=999').expect(422);
    await request(app.getHttpServer()).get('/api/v1/products/Invalid_SLUG').expect(422);
    expect(catalog.list).not.toHaveBeenCalled();
    expect(catalog.bySlug).not.toHaveBeenCalled();
  });

  it('requires authentication and actual catalog permissions for admin reads', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/products').expect(401);
    await request(app.getHttpServer()).get('/api/v1/admin/products').set(headers()).expect(403);
    auth.user.permissions = ['products.read'];
    await request(app.getHttpServer()).get('/api/v1/admin/products').set(headers()).expect(200);
    await request(app.getHttpServer()).get('/api/v1/admin/products?limit=999').set(headers()).expect(422);
  });

  it('checks publication permission and CSRF before invoking the service', async () => {
    const path = `/api/v1/admin/products/${randomUUID()}/publish`;
    await request(app.getHttpServer()).post(path).set(headers()).expect(403);
    auth.user.permissions = ['products.update'];
    await request(app.getHttpServer()).post(path).set({ ...headers(), 'X-CSRF-Token': '' }).expect(403);
    expect(catalog.publish).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post(path).set(headers()).expect(200);
    expect(catalog.publish).toHaveBeenCalledWith(expect.any(String), auth.user.id);
  });

  it('rejects caller-controlled publication/actor fields on creation', async () => {
    auth.user.permissions = ['products.create'];
    await request(app.getHttpServer()).post('/api/v1/admin/products').set(headers()).send({
      name: 'Linen Shirt', slug: 'linen-shirt', description: '', material: 'Linen', care: '', categoryIds: [randomUUID()], collectionIds: [],
      images: [{ url: 'https://example.com/shirt.jpg' }], variants: [{ sku: 'TEST-M-BLACK', size: 'M', colorName: 'Black', colorHex: '#282828', price: 1000 }],
      status: 'PUBLISHED', actorId: randomUUID(),
    }).expect(422);
    expect(catalog.createProduct).not.toHaveBeenCalled();
  });
});
