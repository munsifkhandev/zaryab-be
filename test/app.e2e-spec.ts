import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/config/configure-app.js';
import { CommerceMaintenance } from '../src/infrastructure/commerce-maintenance.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).overrideProvider(CommerceMaintenance).useValue({}).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/api/v1/health/database (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health/database')
      .expect(200)
      .expect({ status: 'ok', database: 'connected' });
  });

  it('/api/v1/health/ready (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200)
      .expect({ status: 'ok' });
  });

  afterEach(async () => {
    await app.close();
  });
});
