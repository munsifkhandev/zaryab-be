import 'reflect-metadata';
import { Body, Controller, Get, Module, Post, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import request from 'supertest';
import { configureApp } from '../src/config/configure-app.js';
import { validateEnvironment } from '../src/config/environment.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DatabaseHealthController } from '../src/health/database-health.controller.js';

class TestInput {
  @IsString()
  @Length(1, 30)
  name!: string;
}

@Controller('test')
class TestController {
  @Post('payload')
  create(@Body() body: TestInput) { return { name: body.name }; }

  @Get('limited')
  limited() { return { ok: true }; }

  @Get('failure')
  failure() { throw new Error('postgresql://user:secret@internal/private'); }
}

// Vite strips TypeScript's decorator metadata; specify it for the HTTP DTO fixture.
Reflect.defineMetadata('design:paramtypes', [TestInput], TestController.prototype, 'create');

const query = vi.fn();
const settings = validateEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/not_connected',
});

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 2 }])],
  controllers: [TestController, DatabaseHealthController],
  providers: [
    { provide: ConfigService, useValue: new ConfigService(settings) },
    { provide: PrismaService, useValue: { $queryRaw: query } },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
class TestModule {}

describe('HTTP foundation (no database connection)', () => {
  let app: INestApplication;

  async function createApp(production = false) {
    const builder = Test.createTestingModule({ imports: [TestModule] });
    if (production) builder.overrideProvider(ConfigService).useValue(new ConfigService({
      ...settings, NODE_ENV: 'production', CORS_ORIGINS: 'https://shop.example.com',
    }));
    const module = await builder.compile();
    app = module.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  }

  beforeEach(async () => {
    query.mockReset().mockResolvedValue([{ ok: 1 }]);
    await createApp();
  });

  afterEach(async () => { await app.close(); });

  it('applies the prefix, security headers and locally generated request IDs', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live').set('X-Request-Id', 'forged-id').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(query).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get('/health/live').expect(404);
  });

  it('validates DTOs, rejects unexpected fields and does not echo submitted values', async () => {
    await request(app.getHttpServer()).post('/api/v1/test/payload')
      .send({ name: 'valid' }).expect(201).expect({ name: 'valid' });
    const response = await request(app.getHttpServer()).post('/api/v1/test/payload')
      .send({ name: 'valid', password: 'never-echo-this' }).expect(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.meta.requestId).toBe(response.headers['x-request-id']);
    expect(JSON.stringify(response.body)).not.toContain('never-echo-this');
  });

  it('rejects invalid field types', async () => {
    await request(app.getHttpServer()).post('/api/v1/test/payload')
      .send({ name: 42 }).expect(422);
  });

  it('limits request body size and handles malformed JSON', async () => {
    const oversized = await request(app.getHttpServer()).post('/api/v1/test/payload')
      .send({ name: 'x'.repeat(110000) }).expect(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const malformed = await request(app.getHttpServer()).post('/api/v1/test/payload')
      .set('Content-Type', 'application/json').send('{invalid').expect(400);
    expect(malformed.body.error.code).toBe('BAD_REQUEST');
  });

  it('only grants browser credential access to allowlisted origins', async () => {
    const allowed = await request(app.getHttpServer()).get('/api/v1/health/live')
      .set('Origin', 'http://localhost:3000').expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    const denied = await request(app.getHttpServer()).get('/api/v1/health/live')
      .set('Origin', 'https://untrusted.example').expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('supports preflight for JSON requests and CSRF headers', async () => {
    const response = await request(app.getHttpServer()).options('/api/v1/test/payload')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type,X-CSRF-Token').expect(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(response.headers['access-control-allow-headers']).toContain('X-CSRF-Token');
  });

  it('returns a sanitized 503 when readiness fails but keeps liveness available', async () => {
    query.mockRejectedValue(new Error('postgresql://user:secret@internal/private'));
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('secret');
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
  });

  it('does not expose internal exceptions or stack traces', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/test/failure').expect(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toMatch(/secret|postgresql|stack/);
  });

  it('enforces rate limits and leaves health probes available', async () => {
    await request(app.getHttpServer()).get('/api/v1/test/limited').expect(200);
    await request(app.getHttpServer()).get('/api/v1/test/limited').expect(200);
    const response = await request(app.getHttpServer()).get('/api/v1/test/limited').expect(429);
    expect(response.body.error.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
  });

  it('serves OpenAPI at the documented location', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(response.body.paths['/api/v1/health/ready']).toBeDefined();
  });

  it('does not expose Swagger in production', async () => {
    await app.close();
    await createApp(true);
    await request(app.getHttpServer()).get('/api/docs').expect(404);
    await request(app.getHttpServer()).get('/api/docs-json').expect(404);
  });
});
