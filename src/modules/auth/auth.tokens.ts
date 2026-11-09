import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function csrfTokenFor(token: string): string {
  // Bind the CSRF credential to the secret HttpOnly session credential.
  return createHmac('sha256', token).update('zaryab-session-csrf-v1').digest('base64url');
}

export function matchesCsrf(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(provided)) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
