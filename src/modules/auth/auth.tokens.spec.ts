import { csrfTokenFor, matchesCsrf, newSessionToken, tokenHash } from './auth.tokens.js';

describe('session credentials', () => {
  it('generates distinct high-entropy tokens and stores a separate SHA-256 hash', () => {
    const tokens = Array.from({ length: 20 }, newSessionToken);
    expect(new Set(tokens).size).toBe(20);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(tokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
      expect(tokenHash(token)).not.toBe(token);
    }
  });

  it('binds CSRF tokens to a session and rejects malformed credentials', () => {
    const token = newSessionToken();
    const csrf = csrfTokenFor(token);
    expect(csrf).not.toBe(token);
    expect(matchesCsrf(csrf, csrf)).toBe(true);
    expect(matchesCsrf(csrfTokenFor(newSessionToken()), csrf)).toBe(false);
    for (const invalid of [undefined, null, '', 'x'.repeat(100000), [csrf], 42]) {
      expect(matchesCsrf(invalid, csrf)).toBe(false);
    }
  });
});
