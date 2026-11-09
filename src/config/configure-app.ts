import { RequestMethod, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { HttpExceptionFilter } from '../common/http/http-exception.filter.js';
import { requestContext } from '../common/http/request-context.middleware.js';

// Shared by the real server and HTTP tests so validation/security behavior agrees.
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const production = config.get<string>('NODE_ENV') === 'production';
  app.use(requestContext);
  app.use(helmet({ strictTransportSecurity: production ? undefined : false }));
  app.enableCors({
    origin: config.getOrThrow<string>('CORS_ORIGINS').split(','),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  app.use(json({ limit: '100kb' }));
  app.use(urlencoded({ extended: false, limit: '100kb', parameterLimit: 100 }));
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: '/', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    errorHttpStatusCode: 422,
    validationError: { target: false, value: false },
  }));
  app.useGlobalFilters(new HttpExceptionFilter());
  if (!production) {
    const document = new DocumentBuilder()
      .setTitle('Zaryab Commerce API')
      .setDescription('Storefront and admin API. Only implemented routes are documented.')
      .setVersion('1.0')
      .addCookieAuth('zaryab_session')
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, document), {
      jsonDocumentUrl: 'api/docs-json',
      swaggerOptions: { persistAuthorization: false },
    });
  }
}
