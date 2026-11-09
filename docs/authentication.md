# Authentication and authorization

## Status

Core registration, login, session authentication, credential rotation, logout,
current identity, profile editing and role/permission guards are implemented.
The developer reports the combined verify command completed successfully; isolated
PostgreSQL auth integration results are still pending. Email verification,
forgot/reset password delivery, password changes, MFA and staff-management APIs
are pending. No verification or reset email is claimed to have been sent.

The existing session/user/role schema is sufficient; this change needs no migration.

## Session architecture

This API uses database-backed opaque sessions. It does not issue JWTs or put
refresh credentials in localStorage. Registration/login generates a fresh random
256-bit credential. Only its SHA-256 hash is stored in `sessions.refresh_token_hash`;
the database column name is retained from the existing schema.

The credential is sent in an HttpOnly, host-only, SameSite=Lax cookie with path `/`.
Development uses `zaryab_session`; production uses `__Host-zaryab_session` with
`Secure`. No cookie Domain is set. Configure HTTPS in production and serve the
storefront, admin and API on the same site, such as subdomains of one registrable
domain. Deployments across unrelated sites require a separate cookie/CSRF design;
these defaults intentionally do not use SameSite=None.

`SESSION_TTL_SECONDS` defaults to 86400, and must be an integer from 300 to 604800.
Every protected request reloads session expiry/revocation, user status, roles and
permissions from PostgreSQL. No authorization claims are trusted from a browser.
Authorization decisions already in flight are not retroactively cancelled.

`POST /auth/refresh` rotates the opaque session credential with an atomic
compare-and-swap. The old credential and its CSRF token stop working. Absolute
expiry is preserved; rotation cannot extend a session indefinitely. Concurrent
requests using the old credential can receive 401 and should not blindly retry
mutations. The database does not retain consumed hashes for family reuse detection.

Logout revokes the database session before clearing the cookie. Subsequent uses
of that credential receive 401. Other device sessions remain valid. Password
reset/change must revoke all sessions when that feature is added. Expired-session
cleanup and global account/device limits remain future operational work.

## Passwords and identity

Registration requires a 12–128 character password. Argon2id uses 64 MiB memory,
3 iterations and one lane. Login accepts passwords up to 128 characters, without
applying the registration minimum to existing accounts. Email is ASCII, trimmed,
lowercased and checked for email syntax; the database enforces normalized uniqueness.
Names are trimmed and bounded. Password characters are preserved.

New accounts receive only the seeded `CUSTOMER` role, in the same database
transaction as the user, session and registration audit event. The role seed must
exist. Public input cannot select roles, status or verification state. Duplicate
registration returns a generic 409; login returns the same generic 401 for unknown
emails, invalid passwords and inactive users. Unknown-user login still performs
Argon2 verification using a dummy hash. Registration's status can disclose that an
account already exists; full registration enumeration resistance is not claimed.

Accounts can log in while email is unverified. `emailVerifiedAt` remains null until
a real verification flow is implemented; do not assume verification has occurred.
Login and registration are limited to 10 requests per 15 minutes per IP per route.
The current limiter is process-local; shared rate limits and account-based abuse
controls are needed before deployment with multiple API replicas.

## CSRF and browser requests

All unsafe HTTP requests require an exact `Origin` from `CORS_ORIGINS`, including
public login/registration. Missing and `null` origins are rejected. Authenticated
mutations also require `X-CSRF-Token` containing the session-bound HMAC returned
in login/registration, `/auth/me` or `/auth/csrf`. The CSRF token cannot be used as
a session credential. Rotation returns a new CSRF token.

For a browser client:

1. Send JSON registration/login with credentials enabled.
2. Keep the returned CSRF token in memory; the browser stores the HttpOnly cookie.
3. After a page reload, fetch `/api/v1/auth/me` with credentials to restore identity
   and the CSRF token. Do not read or store the session cookie in JavaScript.
4. Include `X-CSRF-Token` on profile updates, refresh and logout.
5. On rotation, replace the in-memory CSRF token with the response value.

Axios in the existing storefront already enables credentials. Authentication UI
and CSRF request-header integration are not connected yet. Do not install generic
401 retry logic: an expired absolute session needs login, and rotations must be
coordinated across tabs. Authenticated responses and login/registration use
`Cache-Control: no-store`.

CLI clients and API tools must explicitly send an allowed Origin for mutations.
Swagger's UI origin is the backend origin, which is not in the default two-client
allowlist; use a client with an allowed Origin or explicitly allow that development
origin when exercising login through Swagger. Swagger is disabled in production.

## Endpoints

All paths below begin with `/api/v1`.

| Method | Path | Access | Response |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public, allowed Origin | 201: user, csrfToken, expiresAt; session cookie |
| POST | `/auth/login` | Public, allowed Origin | 200: user, csrfToken, expiresAt; session cookie |
| GET | `/auth/me` | Session | user, csrfToken, expiresAt |
| GET | `/auth/csrf` | Session | csrfToken, expiresAt |
| GET | `/auth/admin/me` | Session and staff/admin role | user, csrfToken, expiresAt |
| POST | `/auth/refresh` | Session, Origin, CSRF | csrfToken, expiresAt; rotated cookie |
| POST | `/auth/logout` | Session, Origin, CSRF | 204; cookie cleared |
| GET | `/customer/profile` | Session | Current user's profile |
| PATCH | `/customer/profile` | Session, Origin, CSRF | Updated profile |

Profiles expose id, names, email, phone, emailVerifiedAt, role names and permission
codes. They exclude password hashes, credential hashes and bearer credentials.
Profile updates accept only firstName, lastName and phone. A user cannot supply
another user's ID or change email, roles, status or password through that route.

## Guards and future endpoints

Authentication is required by default. Use `@Public()` only for intentionally public
controller routes. Root greeting and health probes retain public access.
Cart routes now use `@GuestAllowed()`: a valid session selects its customer, an
absent session permits a separate guest capability, and invalid supplied sessions
are rejected. Login/registration invoke server-side guest merge and add optional
cartMerge results. These new changes need another verify run. See
[inventory-and-cart.md](inventory-and-cart.md) for guest CSRF and merge limits.
`@Roles(...)` requires at least one listed role. `@Permissions(...)` requires every
listed permission. If both are declared, both checks must pass. SUPER_ADMIN is not
an implicit bypass: its actual database grants determine permission access.
The current-user decorator returns only server-populated authentication context.

The staff identity endpoint verifies access to the caller's own identity only.
Actual admin catalog, inventory and order routes must declare their specific
permissions. Customer resource services must enforce ownership as profile updates
already do. Future payment webhooks need a deliberate signature-verification route
and a narrowly scoped exception to browser Origin/CSRF handling.

## First administrator

Run `npm run db:seed` before bootstrapping. The CLI creates a new SUPER_ADMIN user
and audit entry atomically; it refuses to overwrite or elevate an existing account.
There are no default admin credentials. Run this only against the intended database.

In PowerShell, prompt for credentials instead of putting the password in command
history or committing it to an environment file:

```powershell
$env:BOOTSTRAP_ADMIN_EMAIL = Read-Host 'New administrator email'
$adminPassword = Read-Host 'New administrator password (12–128 characters)' -AsSecureString
try {
  $env:BOOTSTRAP_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $adminPassword).Password
  npm run auth:create-admin
} finally {
  Remove-Item Env:BOOTSTRAP_ADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  $adminPassword.Dispose()
}
```

The administrator then uses the same login endpoint as customers. User-management
and role-assignment HTTP endpoints are not implemented yet.

## Developer-run verification

```sh
npm run typecheck
npm test
npm run test:foundation
npm run test:auth
npm run lint
npm run build
npm run db:check
```

`test:auth` uses mocked persistence to test the actual HTTP guards, DTO validation,
cookies, CSRF, Origin checks, role/permission policy, login throttling and profile
ownership. Unit tests cover token derivation, production cookies and stale refresh
rejection. No database connection is opened by those tests.

After provisioning/migrating the isolated `_test` database as described in
[database.md](database.md), run `npm run test:integration`. This also tests actual
Argon2 hashing, registration persistence, login, credential rotation, expiry,
logout revocation, suspension and permission reloads against PostgreSQL. Every
auth fixture is enclosed in a database transaction that is always rolled back.
These are not multi-process race/load tests. Bootstrap CLI execution and frontend
browser integration still require developer verification.
