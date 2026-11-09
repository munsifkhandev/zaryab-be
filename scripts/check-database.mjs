import 'reflect-metadata';

// This diagnostic must never start expiry jobs against the database it inspects.
process.env.COMMERCE_MAINTENANCE_ENABLED = 'false';
process.env.ASYNC_JOBS_ENABLED = 'false';
process.env.EMAIL_PROVIDER = 'disabled';

let app;
const deadline = setTimeout(() => {
  console.error('Database verification timed out.');
  process.exit(1);
}, 120000);
deadline.unref();
try {
  console.log('Starting temporary backend for database verification...');
  const { NestFactory } = await import('@nestjs/core');
  console.log('Nest runtime loaded.');
  const { AppModule, ObserveInstrument } =
    await import('../dist/app.module.js');
  console.log('Backend configuration loaded.');
  const { PrismaService } = await import('../dist/database/prisma.service.js');
  const { configureApp } = await import('../dist/config/configure-app.js');
  app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    logger: ['error', 'warn'],
    abortOnError: false,
    bodyParser: false,
  });
  configureApp(app);
  console.log(
    'Connecting to the database and opening a temporary loopback listener...',
  );
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const response = await fetch(`${url}/api/v1/health/database`, {
    signal: AbortSignal.timeout(10000),
  });
  const health = await response.json();
  if (
    !response.ok ||
    health.status !== 'ok' ||
    health.database !== 'connected'
  ) {
    throw new Error('Database health endpoint failed.');
  }
  const original = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!original.ok || (await original.text()) !== 'Hello World!') {
    throw new Error('Existing application route failed.');
  }
  const database = await app.get(PrismaService).$queryRaw`
    SELECT current_database() AS database_name,
           current_user AS username,
           version() AS postgres_version
  `;
  console.log(
    JSON.stringify({ health, database, originalRoute: 'ok' }, null, 2),
  );
} catch {
  console.error(
    'Database verification failed. Check PostgreSQL availability, backend environment and build output.',
  );
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  clearTimeout(deadline);
}
