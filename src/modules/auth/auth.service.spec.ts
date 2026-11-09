import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { PrismaService } from '../../database/prisma.service.js';
import { AuthService } from './auth.service.js';
import type { AuthContext } from './auth.types.js';
import { csrfTokenFor, newSessionToken, tokenHash } from './auth.tokens.js';

describe('session policy', () => {
  it('uses host-only, Secure, HttpOnly production cookies with a matching deletion policy', () => {
    const service = new AuthService({} as PrismaService, new ConfigService({ NODE_ENV: 'production' }));
    const res = { cookie: vi.fn(), clearCookie: vi.fn() };
    const expiry = new Date(Date.now() + 60000);
    service.setCookie(res as unknown as Response, 'credential', expiry);
    expect(res.cookie).toHaveBeenCalledWith('__Host-zaryab_session', 'credential', {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires: expiry,
    });
    service.clearCookie(res as unknown as Response);
    expect(res.clearCookie).toHaveBeenCalledWith('__Host-zaryab_session', {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/',
    });
  });

  it('only accepts well-formed string credentials from its own cookie', () => {
    const service = new AuthService({} as PrismaService, new ConfigService({ NODE_ENV: 'test' }));
    const token = newSessionToken();
    expect(service.tokenFromRequest({ cookies: { zaryab_session: token } } as unknown as Request)).toBe(token);
    for (const value of [undefined, 42, {}, [], 'x', 'x'.repeat(100000)]) {
      expect(service.tokenFromRequest({ cookies: { zaryab_session: value } } as unknown as Request)).toBeUndefined();
    }
  });

  it('uses compare-and-swap to reject stale concurrent refresh requests', async () => {
    const update = vi.fn().mockResolvedValue({ count: 0 });
    const service = new AuthService({ session: { updateMany: update } } as unknown as PrismaService, new ConfigService({ NODE_ENV: 'test' }));
    const token = newSessionToken();
    const auth = { sessionId: 'session', expiresAt: new Date(Date.now() + 60000), csrfToken: csrfTokenFor(token), user: {} } as AuthContext;
    await expect(service.refresh(auth, token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).toHaveBeenCalledWith({
      where: {
        id: 'session', refreshTokenHash: tokenHash(token), revokedAt: null,
        expiresAt: { gt: expect.any(Date) }, user: { status: 'ACTIVE' },
      },
      data: { refreshTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });
  });
});
