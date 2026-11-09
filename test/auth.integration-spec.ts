import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { verify } from 'argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { RecoveryService } from '../src/modules/auth/recovery.service.js';
import { EmailService } from '../src/infrastructure/email.service.js';
import { newSessionToken, tokenHash } from '../src/modules/auth/auth.tokens.js';
import { testDatabaseUrl } from './helpers/test-database.js';

describe('authentication persistence (isolated test database)', () => {
  let database: PrismaService | undefined;
  const config = new ConfigService({ NODE_ENV: 'test', SESSION_TTL_SECONDS: 3600 });
  const password = 'isolated-auth-test-password';
  const rollback = new Error('rollback test fixtures');

  beforeAll(async () => {
    database = new PrismaService(new ConfigService({ DATABASE_URL: testDatabaseUrl() }));
    await database.$connect();
  });

  afterAll(async () => { await database?.$disconnect(); });

  async function inTransaction(test: (service: AuthService, tx: Prisma.TransactionClient) => Promise<void>) {
    if (!database) throw new Error('Test database is not initialized.');
    try {
      await database.$transaction(async (tx) => {
        await tx.role.upsert({ where: { name: 'CUSTOMER' }, update: {}, create: { name: 'CUSTOMER' } });
        // Reuse the enclosing rollback transaction instead of attempting nested transactions.
        const persistence = {
          role: tx.role, user: tx.user, session: tx.session,
          $transaction: (work: (transaction: Prisma.TransactionClient) => Promise<unknown>) => work(tx),
        } as unknown as PrismaService;
        await test(new AuthService(persistence, config), tx);
        throw rollback;
      }, { timeout: 15000 });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  function registration() {
    return { email: `auth-${randomUUID()}@example.com`, firstName: 'Test', lastName: 'Customer', password };
  }

  it('registers only a customer, hashes credentials and persists the audit record atomically', async () => {
    await inTransaction(async (service, tx) => {
      const dto = registration();
      const result = await service.register(dto);
      expect(result.user.roles).toEqual(['CUSTOMER']);
      const user = await tx.user.findUniqueOrThrow({ where: { id: result.user.id } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verify(user.passwordHash, password)).toBe(true);
      expect(JSON.stringify(result.user)).not.toContain('passwordHash');
      const session = await tx.session.findUniqueOrThrow({ where: { refreshTokenHash: tokenHash(result.token) } });
      expect(session.refreshTokenHash).not.toBe(result.token);
      expect(session.userId).toBe(user.id);
      expect(await tx.auditLog.count({ where: { actorId: user.id, action: 'auth.register' } })).toBe(1);
    });
  });

  it('logs in with valid credentials and rejects invalid credentials', async () => {
    await inTransaction(async (service) => {
      const dto = registration();
      const created = await service.register(dto);
      const login = await service.login({ email: dto.email.toUpperCase(), password });
      expect(login.user.id).toBe(created.user.id);
      expect(login.token).not.toBe(created.token);
      await expect(service.login({ email: dto.email, password: 'incorrect' })).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.login({ email: `missing-${randomUUID()}@example.com`, password })).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('rotates a session credential once and preserves its absolute expiry', async () => {
    await inTransaction(async (service) => {
      const created = await service.register(registration());
      const auth = await service.authenticate(created.token);
      const refreshed = await service.refresh(auth, created.token);
      expect(refreshed.token).not.toBe(created.token);
      expect(refreshed.expiresAt).toEqual(created.expiresAt);
      expect(refreshed.csrfToken).not.toBe(auth.csrfToken);
      await expect(service.authenticate(created.token)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.refresh(auth, created.token)).rejects.toBeInstanceOf(UnauthorizedException);
      expect((await service.authenticate(refreshed.token)).user.id).toBe(created.user.id);
    });
  });

  it('revokes sessions on logout and observes account suspension on the next request', async () => {
    await inTransaction(async (service, tx) => {
      const created = await service.register(registration());
      const auth = await service.authenticate(created.token);
      await service.logout(auth);
      await expect(service.authenticate(created.token)).rejects.toBeInstanceOf(UnauthorizedException);
      const login = await service.login({ email: created.user.email, password });
      await tx.user.update({ where: { id: created.user.id }, data: { status: 'SUSPENDED' } });
      await expect(service.authenticate(login.token)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.login({ email: created.user.email, password })).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('rejects expired sessions', async () => {
    await inTransaction(async (service, tx) => {
      const created = await service.register(registration());
      const session = await service.authenticate(created.token);
      await tx.session.update({ where: { id: session.sessionId }, data: {
        createdAt: new Date(Date.now() - 7200000), expiresAt: new Date(Date.now() - 3600000),
      } });
      await expect(service.authenticate(created.token)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
  it('uses reset tokens once, changes the hash and revokes every existing session',async()=>{
    await inTransaction(async(service,tx)=>{
      const created=await service.register(registration()),token=newSessionToken();
      await tx.passwordResetToken.create({data:{userId:created.user.id,tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+1800000)}});
      const persistence={user:tx.user,$transaction:(work:(client:Prisma.TransactionClient)=>Promise<unknown>)=>work(tx)} as unknown as PrismaService;
      const recovery=new RecoveryService(persistence,new EmailService(new ConfigService({EMAIL_PROVIDER:'disabled'})));
      const replacement='replacement-isolated-password';await recovery.reset({token,password:replacement});
      await expect(recovery.reset({token,password:replacement})).rejects.toThrow();
      await expect(service.authenticate(created.token)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.login({email:created.user.email,password})).rejects.toBeInstanceOf(UnauthorizedException);
      expect((await service.login({email:created.user.email,password:replacement})).user.id).toBe(created.user.id);
      expect((await tx.passwordResetToken.findUniqueOrThrow({where:{tokenHash:tokenHash(token)}})).usedAt).not.toBeNull();
    });
  });

  it('does not cache revoked role permissions between requests', async () => {
    await inTransaction(async (service, tx) => {
      const created = await service.register(registration());
      const role = await tx.role.upsert({ where: { name: 'STAFF' }, update: {}, create: { name: 'STAFF' } });
      const permission = await tx.permission.upsert({ where: { code: 'products.read' }, update: {}, create: { code: 'products.read', description: 'Read catalog' } });
      await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
      await tx.userRole.create({ data: { userId: created.user.id, roleId: role.id } });
      expect((await service.authenticate(created.token)).user.permissions).toContain('products.read');
      await tx.userRole.delete({ where: { userId_roleId: { userId: created.user.id, roleId: role.id } } });
      expect((await service.authenticate(created.token)).user.permissions).not.toContain('products.read');
    });
  });
});
