import { integrationConfig } from '../infrastructure/integration-config.js';
export function validateEnvironment(config: Record<string, unknown>) {
  const nodeEnv = config.NODE_ENV ?? 'development';
  if (
    typeof nodeEnv !== 'string' ||
    !['development', 'test', 'production'].includes(nodeEnv)
  ) {
    throw new Error('NODE_ENV must be development, test or production.');
  }
  const port = Number(config.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  if (typeof config.DATABASE_URL !== 'string' || !config.DATABASE_URL.trim()) {
    throw new Error('DATABASE_URL is required.');
  }
  try {
    const url = new URL(config.DATABASE_URL);
    if (
      !['postgresql:', 'postgres:'].includes(url.protocol) ||
      !url.hostname ||
      url.pathname.length < 2
    ) {
      throw new Error('Invalid database URL');
    }
  } catch {
    throw new Error(
      'DATABASE_URL must be a valid PostgreSQL connection URL with a database name.',
    );
  }
  const rawOrigins = config.CORS_ORIGINS ??
    (nodeEnv === 'production' ? '' : 'http://localhost:3000,http://localhost:3001');
  if (typeof rawOrigins !== 'string' || !rawOrigins.trim()) {
    throw new Error('CORS_ORIGINS must contain explicit allowed origins.');
  }
  const origins = rawOrigins.split(',').map((value) => value.trim());
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.origin !== origin ||
        (nodeEnv === 'production' && url.protocol !== 'https:')
      ) throw new Error('Invalid origin');
    } catch {
      throw new Error('CORS_ORIGINS must contain HTTP origins without paths; production requires HTTPS.');
    }
  }
  const rateLimit = Number(config.RATE_LIMIT_MAX ?? 120);
  const rateTtl = Number(config.RATE_LIMIT_TTL_MS ?? 60000);
  if (!Number.isSafeInteger(rateLimit) || rateLimit < 1 || rateLimit > 10000) {
    throw new Error('RATE_LIMIT_MAX must be an integer between 1 and 10000.');
  }
  if (!Number.isSafeInteger(rateTtl) || rateTtl < 1000 || rateTtl > 86400000) {
    throw new Error('RATE_LIMIT_TTL_MS must be an integer between 1000 and 86400000.');
  }
  const observeKey = config.OBSERVE_APP_KEY;
  const cod=config.COD_ENABLED??'true';
  if(cod!==true&&cod!==false&&cod!=='true'&&cod!=='false')throw new Error('COD_ENABLED must be true or false.');
  const maintenance = config.COMMERCE_MAINTENANCE_ENABLED ?? (nodeEnv === 'test' ? 'false' : 'true');
  if (maintenance !== true && maintenance !== false && maintenance !== 'true' && maintenance !== 'false') {
    throw new Error('COMMERCE_MAINTENANCE_ENABLED must be true or false.');
  }
  const sessionTtl = Number(config.SESSION_TTL_SECONDS ?? 86400);
  if (!Number.isSafeInteger(sessionTtl) || sessionTtl < 300 || sessionTtl > 604800) {
    throw new Error('SESSION_TTL_SECONDS must be an integer between 300 and 604800.');
  }
  const observeSecret = config.OBSERVE_APP_SECRET;
  if (Boolean(observeKey) !== Boolean(observeSecret)) {
    throw new Error('OBSERVE_APP_KEY and OBSERVE_APP_SECRET must be configured together.');
  }
  return {
    ...config,
    ...integrationConfig(config,nodeEnv),
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: config.DATABASE_URL,
    CORS_ORIGINS: [...new Set(origins)].join(','),
    RATE_LIMIT_MAX: rateLimit,
    RATE_LIMIT_TTL_MS: rateTtl,
    SESSION_TTL_SECONDS: sessionTtl,
    COD_ENABLED: cod===true||cod==='true',
    COMMERCE_MAINTENANCE_ENABLED: maintenance === true || maintenance === 'true',
  };
}
