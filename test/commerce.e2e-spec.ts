import 'reflect-metadata';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { configureApp } from '../src/config/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { LoginDto } from '../src/modules/auth/dto/auth.dto.js';
import type { AuthContext } from '../src/modules/auth/auth.types.js';
import { csrfTokenFor, newSessionToken } from '../src/modules/auth/auth.tokens.js';
import { CartService } from '../src/modules/cart/cart.service.js';
import { CartController } from '../src/modules/cart/cart.controller.js';
import { AddCartItemDto, CartQuantityDto } from '../src/modules/cart/cart.dto.js';
import { InventoryModule } from '../src/modules/inventory/inventory.module.js';
import { InventoryService } from '../src/modules/inventory/inventory.service.js';
import { InventoryController } from '../src/modules/inventory/inventory.controller.js';
import { AdjustmentDto, InventoryQueryDto } from '../src/modules/inventory/inventory.dto.js';

Reflect.defineMetadata('design:paramtypes', [AddCartItemDto, Object, Object], CartController.prototype, 'add');
Reflect.defineMetadata('design:paramtypes', [String, CartQuantityDto, Object, Object], CartController.prototype, 'update');
Reflect.defineMetadata('design:paramtypes', [InventoryQueryDto], InventoryController.prototype, 'balances');
Reflect.defineMetadata('design:paramtypes', [AdjustmentDto, String, Object], InventoryController.prototype, 'adjust');
Reflect.defineMetadata('design:paramtypes', [LoginDto, Object, Object], AuthController.prototype, 'login');

describe('inventory and cart HTTP boundaries (mocked persistence)', () => {
  let app: INestApplication;
  let auth: AuthContext;
  let guestToken: string;
  let sessionToken: string;
  const cartCookies=new CartService({} as PrismaService,new ConfigService({NODE_ENV:'test'}));
  const authCookies=new AuthService({} as PrismaService,new ConfigService({NODE_ENV:'test'}));
  let snapshot: { id: string; items: never[]; currency: string; subtotal: number; itemCount: number; canCheckout: boolean; expiresAt: Date; requiresInitialization: boolean };
  const carts = {
    cookieName: 'zaryab_cart', cookieOptions: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
    tokenFromRequest: cartCookies.tokenFromRequest.bind(cartCookies), setCookie: cartCookies.setCookie.bind(cartCookies), clearCookie: cartCookies.clearCookie.bind(cartCookies),
    ownerFromRequest:cartCookies.ownerFromRequest.bind(cartCookies),
    initialize: vi.fn(), get: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn(), clear: vi.fn(), mergeOnLogin: vi.fn(),
  };
  const authentication = {
    cookieName: 'zaryab_session', cookieOptions: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
    tokenFromRequest: authCookies.tokenFromRequest.bind(authCookies), setCookie: authCookies.setCookie.bind(authCookies),
    authenticate: vi.fn(), login: vi.fn(),
  };
  const inventory = { balances: vi.fn(), adjust: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    guestToken = newSessionToken(); sessionToken = newSessionToken();
    auth = { sessionId: randomUUID(), csrfToken: csrfTokenFor(sessionToken), expiresAt: new Date(Date.now() + 60000),
      user: { id: randomUUID(), firstName: 'Test', lastName: 'User', email: 'fixture@example.com', phone: null, emailVerifiedAt: null, roles: ['CUSTOMER'], permissions: [] } };
    snapshot = { id: randomUUID(), items: [], currency: 'USD', subtotal: 0, itemCount: 0, canCheckout: false, expiresAt: new Date(Date.now() + 86400000), requiresInitialization: false };
    authentication.authenticate.mockImplementation(async (token: string) => { if (token !== sessionToken) throw new UnauthorizedException(); return auth; });
    authentication.login.mockResolvedValue({ user: auth.user, token: sessionToken, expiresAt: auth.expiresAt });
    for (const operation of [carts.get, carts.add, carts.update, carts.remove, carts.clear]) operation.mockResolvedValue(snapshot);
    carts.initialize.mockResolvedValue({ token: guestToken, cart: snapshot });
    carts.mergeOnLogin.mockResolvedValue({ status: 'merged' });
    inventory.balances.mockResolvedValue({ items: [], total: 0 });
    inventory.adjust.mockResolvedValue({ id: randomUUID() });
    const module = await Test.createTestingModule({ imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/unused' })] }),
      AuthModule, InventoryModule,
    ] }).overrideProvider(PrismaService).useValue({}).overrideProvider(AuthService).useValue(authentication)
      .overrideProvider(CartService).useValue(carts).overrideProvider(InventoryService).useValue(inventory).compile();
    app = module.createNestApplication({ bodyParser: false }); configureApp(app); await app.init();
  });
  afterEach(async () => { await app.close(); });

  const origin = 'http://localhost:3000';
  function guestHeaders() { return { Cookie: `zaryab_cart=${guestToken}`, Origin: origin, 'X-CSRF-Token': csrfTokenFor(guestToken) }; }
  function userHeaders() { return { Cookie: `zaryab_session=${sessionToken}`, Origin: origin, 'X-CSRF-Token': auth.csrfToken }; }

  it('reads an empty guest cart without creating identity/state on GET', async () => {
    const result = await request(app.getHttpServer()).get('/api/v1/customer/cart').expect(200);
    expect(result.body).toMatchObject({ id: null, items: [], requiresInitialization: true, csrfToken: null });
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(result.headers['cache-control']).toBe('no-store');
    expect(carts.initialize).not.toHaveBeenCalled();
  });

  it('requires an allowed Origin to initialize and only returns a CSRF credential in JSON', async () => {
    await request(app.getHttpServer()).post('/api/v1/customer/cart/session').expect(403);
    const result = await request(app.getHttpServer()).post('/api/v1/customer/cart/session').set('Origin', origin).expect(201);
    expect(result.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(result.body.csrfToken).toBe(csrfTokenFor(guestToken));
    expect(JSON.stringify(result.body)).not.toContain(guestToken);
  });

  it('requires guest CSRF and rejects caller-controlled prices', async () => {
    const body = { variantId: randomUUID(), quantity: 1 };
    await request(app.getHttpServer()).post('/api/v1/customer/cart/items').set({ ...guestHeaders(), 'X-CSRF-Token': 'wrong' }).send(body).expect(403);
    await request(app.getHttpServer()).post('/api/v1/customer/cart/items').set(guestHeaders()).send({ ...body, price: 1 }).expect(422);
    expect(carts.add).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post('/api/v1/customer/cart/items').set(guestHeaders()).send(body).expect(201);
    expect(carts.add).toHaveBeenCalledWith({ kind: 'guest', token: guestToken }, body.variantId, 1);
  });

  it('selects the logged-in customer and does not fall back from invalid sessions to guest access', async () => {
    await request(app.getHttpServer()).get('/api/v1/customer/cart').set(userHeaders()).expect(200);
    expect(carts.get).toHaveBeenCalledWith({ kind: 'user', userId: auth.user.id });
    await request(app.getHttpServer()).get('/api/v1/customer/cart')
      .set('Cookie', `zaryab_session=malformed; zaryab_cart=${guestToken}`).expect(401);
  });

  it('binds quantity updates to the authenticated customer', async () => {
    const itemId = randomUUID();
    await request(app.getHttpServer()).patch(`/api/v1/customer/cart/items/${itemId}`).set(userHeaders()).send({ quantity: 2 }).expect(200);
    expect(carts.update).toHaveBeenCalledWith({ kind: 'user', userId: auth.user.id }, itemId, 2);
    await request(app.getHttpServer()).patch(`/api/v1/customer/cart/items/${itemId}`).set(userHeaders()).send({ quantity: 2, userId: randomUUID() }).expect(422);
  });

  it('merges on login and retains the guest cookie when a merge is deferred', async () => {
    carts.mergeOnLogin.mockResolvedValue({ status: 'deferred', reason: 'QUANTITY_LIMIT' });
    const result = await request(app.getHttpServer()).post('/api/v1/auth/login').set(guestHeaders())
      .send({ email: 'fixture@example.com', password: 'password' }).expect(200);
    expect(carts.mergeOnLogin).toHaveBeenCalledWith(auth.user.id, guestToken);
    expect(result.body.cartMerge).toEqual({ status: 'deferred', reason: 'QUANTITY_LIMIT' });
    expect(result.headers['set-cookie']).toHaveLength(1);
    expect(result.headers['set-cookie'][0]).toContain('zaryab_session=');
  });

  it('enforces inventory permissions independently of catalog permissions', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/inventory').set(userHeaders()).expect(403);
    auth.user.permissions = ['inventory.read'];
    await request(app.getHttpServer()).get('/api/v1/admin/inventory').set(userHeaders()).expect(200);
    const body = { variantId: randomUUID(), locationId: randomUUID(), delta: 5, reason: 'Physical stock count' };
    await request(app.getHttpServer()).post('/api/v1/admin/inventory/adjustments').set(userHeaders()).set('Idempotency-Key', 'adjust-0001').send(body).expect(403);
    auth.user.permissions = ['inventory.adjust'];
    await request(app.getHttpServer()).post('/api/v1/admin/inventory/adjustments').set(userHeaders()).set('Idempotency-Key', 'adjust-0001').send(body).expect(201);
    expect(inventory.adjust).toHaveBeenCalledWith(expect.objectContaining(body), 'adjust-0001', auth.user.id);
  });
});
