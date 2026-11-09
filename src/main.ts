import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ConsoleLogger } from '@nestjs/common';
import { AppModule, ObserveInstrument } from './app.module.js';
import { configureApp } from './config/configure-app.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    bodyParser: false,
    logger: new ConsoleLogger({ json: true }),
  });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'));
}
await bootstrap();
