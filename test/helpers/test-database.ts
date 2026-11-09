export function testDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required; never use the development database.');
  let test: URL;
  let development: URL | undefined;
  try {
    test = new URL(value);
    if (process.env.DATABASE_URL) development = new URL(process.env.DATABASE_URL);
  } catch {
    throw new Error('Invalid database URL configuration.');
  }
  if (!['postgres:', 'postgresql:'].includes(test.protocol) || !test.pathname.endsWith('_test')) {
    throw new Error('The integration database name must end in _test.');
  }
  if (development && development.hostname === test.hostname &&
    (development.port || '5432') === (test.port || '5432') && development.pathname === test.pathname) {
    throw new Error('TEST_DATABASE_URL must point to a different database than DATABASE_URL.');
  }
  return value;
}
