import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

it('refuses invalid bootstrap credentials before connecting and does not print secrets', async () => {
  try {
    await run(process.execPath, ['scripts/create-admin.mjs'], {
      env: {
        ...process.env,
        BOOTSTRAP_ADMIN_EMAIL: 'invalid-email',
        BOOTSTRAP_ADMIN_PASSWORD: 'private-short-password',
        DATABASE_URL: 'postgresql://private:do-not-log@127.0.0.1:1/unused',
      },
      timeout: 10000,
    });
    expect.fail('Expected bootstrap input validation to reject this request');
  } catch (error) {
    expect(error).toMatchObject({ code: 1, stdout: '', stderr: expect.stringContaining('Admin creation failed.') });
    const stderr = (error as { stderr: string }).stderr;
    expect(stderr).not.toContain('private-short-password');
    expect(stderr).not.toContain('do-not-log');
  }
}, 15000);
