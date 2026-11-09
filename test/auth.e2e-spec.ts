import 'reflect-metadata';
import { Controller, Get, type INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { configureApp } from '../src/config/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { ProfileController } from '../src/modules/auth/profile.controller.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { CurrentAuth, Permissions } from '../src/modules/auth/auth.metadata.js';
import { csrfTokenFor, newSessionToken } from '../src/modules/auth/auth.tokens.js';
import type { AuthContext } from '../src/modules/auth/auth.types.js';
import { LoginDto, RegisterDto, UpdateProfileDto } from '../src/modules/auth/dto/auth.dto.js';

// Vite does not emit TypeScript decorator metadata; preserve real DTO checks in HTTP tests.
Reflect.defineMetadata('design:paramtypes', [RegisterDto, Object], AuthController.prototype, 'register');
Reflect.defineMetadata('design:paramtypes', [LoginDto, Object], AuthController.prototype, 'login');
Reflect.defineMetadata('design:paramtypes', [Object, UpdateProfileDto], ProfileController.prototype, 'update');

@Controller('admin/permission-test')
class PermissionFixtureController {
  @Get()
  @Permissions('products.update', 'inventory.adjust')
  get(@CurrentAuth() auth: AuthContext) { return { id: auth.user.id }; }
}

describe('auth HTTP boundaries (mocked persistence)', () => {
  let app: INestApplication;
  let token: string;
  let auth: AuthContext;
  const cookies=new AuthService({} as PrismaService,new ConfigService({NODE_ENV:'test'}));
  const service = {
    register: vi.fn(), login: vi.fn(), authenticate: vi.fn(), refresh: vi.fn(), logout: vi.fn(),
    updateProfile: vi.fn(), tokenFromRequest: cookies.tokenFromRequest.bind(cookies),
    setCookie: cookies.setCookie.bind(cookies), clearCookie: cookies.clearCookie.bind(cookies),
    cookieName: 'zaryab_session',
    cookieOptions: { httpOnly: true, secure: false, sameSite: 'lax', path: '/' },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    token = newSessionToken();
    auth = {
      sessionId: 'session-id', expiresAt: new Date(Date.now() + 600000), csrfToken: csrfTokenFor(token),
      user: { id: 'customer-a', firstName: 'First', lastName: 'Last', email: 'user@example.com', phone: null, emailVerifiedAt: null, roles: ['CUSTOMER'], permissions: [] },
    };
    service.register.mockResolvedValue({ token, expiresAt: auth.expiresAt, user: auth.user });
    service.login.mockResolvedValue({ token, expiresAt: auth.expiresAt, user: auth.user });
    service.authenticate.mockImplementation((provided: string) => {
      if (provided !== token) throw new UnauthorizedException();
      return Promise.resolve(auth);
    });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true, ignoreEnvFile: true,
          load: [() => validateEnvironment({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/unused' })],
        }),
        AuthModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
      ],
      controllers: [PermissionFixtureController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).overrideProvider(PrismaService).useValue({}).overrideProvider(AuthService).useValue(service).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it('rejects unauthenticated requests and malformed session cookies', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', 'zaryab_session=j:{"object":true}').expect(401);
    expect(service.authenticate).not.toHaveBeenCalled();
  });

  it('sets an HttpOnly cookie without exposing the bearer credential in the body', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000').send({ email: ' USER@example.com ', password: 'password' }).expect(200);
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(response.headers['set-cookie'][0]).toContain('Path=/');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.csrfToken).toBe(auth.csrfToken);
    expect(JSON.stringify(response.body)).not.toContain(token);
    expect(service.login).toHaveBeenCalledWith(expect.objectContaining({ email: 'user@example.com' }));
  });

  it('rejects untrusted or missing origins even on public login', async () => {
    const body = { email: 'user@example.com', password: 'password' };
    await request(app.getHttpServer()).post('/api/v1/auth/login').send(body).expect(403);
    await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'https://attacker.example').send(body).expect(403);
    expect(service.login).not.toHaveBeenCalled();
  });

  it('rejects attempts to assign roles during registration', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').set('Origin', 'http://localhost:3000')
      .send({ firstName: 'First', lastName: 'Last', email: 'user@example.com', password: 'long-enough-password', roles: ['SUPER_ADMIN'] }).expect(422);
    expect(service.register).not.toHaveBeenCalled();
  });

  it('returns a private current-user response and blocks customer admin access', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', `zaryab_session=${token}`).expect(200);
    expect(response.body.user.id).toBe('customer-a');
    expect(response.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer()).get('/api/v1/auth/admin/me').set('Cookie', `zaryab_session=${token}`).expect(403);
    auth.user.roles = ['STAFF'];
    await request(app.getHttpServer()).get('/api/v1/auth/admin/me').set('Cookie', `zaryab_session=${token}`).expect(200);
  });

  it('requires every declared permission, including for administrators', async () => {
    auth.user.roles = ['SUPER_ADMIN'];
    auth.user.permissions = ['products.update'];
    await request(app.getHttpServer()).get('/api/v1/admin/permission-test').set('Cookie', `zaryab_session=${token}`).expect(403);
    auth.user.permissions.push('inventory.adjust');
    await request(app.getHttpServer()).get('/api/v1/admin/permission-test').set('Cookie', `zaryab_session=${token}`).expect(200);
  });

  it('requires a session-bound CSRF token before logout', async () => {
    for (const csrf of ['', csrfTokenFor(newSessionToken())]) {
      await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', `zaryab_session=${token}`)
        .set('Origin', 'http://localhost:3000').set('X-CSRF-Token', csrf).expect(403);
    }
    expect(service.logout).not.toHaveBeenCalled();
    const response = await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', `zaryab_session=${token}`)
      .set('Origin', 'http://localhost:3000').set('X-CSRF-Token', auth.csrfToken).expect(204);
    expect(service.logout).toHaveBeenCalledWith(auth);
    expect(response.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970');
  });

  it('refreshes credentials only after authentication and CSRF checks', async () => {
    const rotated = newSessionToken();
    service.refresh.mockResolvedValue({ token: rotated, expiresAt: auth.expiresAt, csrfToken: csrfTokenFor(rotated) });
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', `zaryab_session=${token}`)
      .set('Origin', 'http://localhost:3000').expect(403);
    expect(service.refresh).not.toHaveBeenCalled();
    const response = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', `zaryab_session=${token}`)
      .set('Origin', 'http://localhost:3000').set('X-CSRF-Token', auth.csrfToken).expect(200);
    expect(service.refresh).toHaveBeenCalledWith(auth, token);
    expect(response.headers['set-cookie'][0]).toContain(rotated);
    expect(response.body.csrfToken).toBe(csrfTokenFor(rotated));
    expect(JSON.stringify(response.body)).not.toContain(rotated);
  });

  it('updates only the authenticated customer and rejects user-ID injection', async () => {
    service.updateProfile.mockResolvedValue({ ...auth.user, firstName: 'Updated' });
    await request(app.getHttpServer()).patch('/api/v1/customer/profile').set('Cookie', `zaryab_session=${token}`)
      .set('Origin', 'http://localhost:3000').set('X-CSRF-Token', auth.csrfToken).send({ firstName: 'Updated' }).expect(200);
    expect(service.updateProfile).toHaveBeenCalledWith('customer-a', expect.objectContaining({ firstName: 'Updated' }));
    await request(app.getHttpServer()).patch('/api/v1/customer/profile').set('Cookie', `zaryab_session=${token}`)
      .set('Origin', 'http://localhost:3000').set('X-CSRF-Token', auth.csrfToken).send({ userId: 'customer-b', firstName: 'Updated' }).expect(422);
  });

  it('throttles repeated login attempts', async () => {
    service.login.mockRejectedValue(new UnauthorizedException());
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'http://localhost:3000')
        .send({ email: 'user@example.com', password: 'wrong' }).expect(401);
    }
    await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', 'http://localhost:3000')
      .send({ email: 'user@example.com', password: 'wrong' }).expect(429);
  });
});
