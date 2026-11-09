import { validateEnvironment } from './environment.js';

const databaseUrl =
  'postgresql://zaryab:zaryab@localhost:5434/zaryab_ecommerce?schema=public';

describe('environment validation', () => {
  it('defaults the application port and preserves unrelated settings', () => {
    expect(
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        EXISTING_SETTING: 'keep',
      }),
    ).toMatchObject({
      DATABASE_URL: databaseUrl,
      PORT: 4000,
      NODE_ENV: 'development',
      EXISTING_SETTING: 'keep',
    });
  });
  it.each(['', '4000x', '-1', '65536', '1.5'])(
    'rejects invalid port %s',
    (port) => {
      expect(() =>
        validateEnvironment({ DATABASE_URL: databaseUrl, PORT: port }),
      ).toThrow('PORT');
    },
  );
  it('requires a PostgreSQL URL and does not echo credentials on failure', () => {
    expect(() => validateEnvironment({})).toThrow('DATABASE_URL is required');
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'https://user:private-value@example.com/db',
      }),
    ).toThrow('valid PostgreSQL');
    try {
      validateEnvironment({ DATABASE_URL: 'not-a-url-private-value' });
    } catch (error) {
      expect(String(error)).not.toContain('private-value');
    }
    expect(() =>
      validateEnvironment({ DATABASE_URL: 'postgresql://localhost/' }),
    ).toThrow('valid PostgreSQL');
  });
  it('rejects unknown runtime modes', () => {
    expect(() =>
      validateEnvironment({ DATABASE_URL: databaseUrl, NODE_ENV: 'invalid' }),
    ).toThrow('NODE_ENV');
  });

  it.each([
    '*', 'null', 'https://example.com/path', 'https://example.com/',
    'https://user:password@example.com', 'https://example.com,',
  ])('rejects an unsafe CORS origin %s', (origin) => {
    expect(() => validateEnvironment({
      DATABASE_URL: databaseUrl, CORS_ORIGINS: origin,
    })).toThrow('CORS_ORIGINS');
  });

  it('requires explicit HTTPS origins in production', () => {
    const config = { DATABASE_URL: databaseUrl, NODE_ENV: 'production' };
    expect(() => validateEnvironment(config)).toThrow('CORS_ORIGINS');
    expect(() => validateEnvironment({
      ...config, CORS_ORIGINS: 'http://example.com',
    })).toThrow('CORS_ORIGINS');
    expect(validateEnvironment({
      ...config, CORS_ORIGINS: 'https://shop.example.com,https://admin.example.com',
    }).CORS_ORIGINS).toBe('https://shop.example.com,https://admin.example.com');
  });

  it.each([
    { RATE_LIMIT_MAX: '0' }, { RATE_LIMIT_MAX: '1.5' },
    { RATE_LIMIT_MAX: '10001' }, { RATE_LIMIT_TTL_MS: '999' },
    { RATE_LIMIT_TTL_MS: 'invalid' }, { RATE_LIMIT_TTL_MS: '86400001' },
  ])('rejects invalid rate limiting configuration %j', (settings) => {
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, ...settings })).toThrow('RATE_LIMIT');
  });

  it('parses rate limits and rejects partially configured Observe credentials', () => {
    expect(validateEnvironment({
      DATABASE_URL: databaseUrl, RATE_LIMIT_MAX: '30', RATE_LIMIT_TTL_MS: '10000',
    })).toMatchObject({ RATE_LIMIT_MAX: 30, RATE_LIMIT_TTL_MS: 10000 });
    expect(() => validateEnvironment({
      DATABASE_URL: databaseUrl, OBSERVE_APP_KEY: 'key',
    })).toThrow('configured together');
  });

  it.each(['0', '299', '604801', '1.5', 'invalid'])('rejects unsafe session lifetimes %s', (value) => {
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, SESSION_TTL_SECONDS: value })).toThrow('SESSION_TTL_SECONDS');
  });

  it('disables background expiry by default in tests and validates explicit flags', () => {
    expect(validateEnvironment({ DATABASE_URL: databaseUrl, NODE_ENV: 'test' }).COMMERCE_MAINTENANCE_ENABLED).toBe(false);
    expect(validateEnvironment({ DATABASE_URL: databaseUrl, COMMERCE_MAINTENANCE_ENABLED: 'false' }).COMMERCE_MAINTENANCE_ENABLED).toBe(false);
    expect(() => validateEnvironment({ DATABASE_URL: databaseUrl, COMMERCE_MAINTENANCE_ENABLED: 'invalid' })).toThrow('COMMERCE_MAINTENANCE_ENABLED');
  });
});
