import {
  BadRequestException, ConflictException, Inject, Injectable,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { argon2id, hash, verify } from 'argon2';
import type { CookieOptions, Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { csrfTokenFor, newSessionToken, tokenHash } from './auth.tokens.js';
import type { AuthContext, UserProfile } from './auth.types.js';
import type { LoginDto, RegisterDto, UpdateProfileDto } from './dto/auth.dto.js';

const userSelect = {
  id: true, firstName: true, lastName: true, email: true, phone: true,
  emailVerifiedAt: true, status: true,
  roles: { select: { role: { select: {
    name: true, permissions: { select: { permission: { select: { code: true } } } },
  } } } },
} satisfies Prisma.UserSelect;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;
const passwordOptions = { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

function profile(user: SelectedUser): UserProfile {
  return {
    id: user.id, firstName: user.firstName, lastName: user.lastName,
    email: user.email, phone: user.phone, emailVerifiedAt: user.emailVerifiedAt,
    roles: user.roles.map(({ role }) => role.name).sort(),
    permissions: [...new Set(user.roles.flatMap(({ role }) =>
      role.permissions.map(({ permission }) => permission.code)))].sort(),
  };
}

@Injectable()
export class AuthService {
  private dummyHash: Promise<string> | undefined;
  readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    const secure = config.get<string>('NODE_ENV') === 'production';
    this.cookieName = secure ? '__Host-zaryab_session' : 'zaryab_session';
    this.cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  }

  tokenFromRequest(req: Request): string | undefined {
    const cookies: unknown = req.cookies;
    if (!cookies || typeof cookies !== 'object') return undefined;
    const token: unknown = (cookies as Record<string, unknown>)[this.cookieName];
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
  }

  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.cookieName, token, { ...this.cookieOptions, expires: expiresAt });
  }

  clearCookie(res: Response): void { res.clearCookie(this.cookieName, this.cookieOptions); }

  private sessionData(userId: string) {
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + this.config.getOrThrow<number>('SESSION_TTL_SECONDS') * 1000);
    return { token, data: { userId, refreshTokenHash: tokenHash(token), expiresAt } };
  }

  async register(dto: RegisterDto) {
    const role = await this.prisma.role.findUnique({ where: { name: 'CUSTOMER' }, select: { id: true } });
    if (!role) throw new ServiceUnavailableException();
    const passwordHash = await hash(dto.password, passwordOptions);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email.trim().toLowerCase(), firstName: dto.firstName, lastName: dto.lastName,
            passwordHash, roles: { create: { roleId: role.id } },
          },
          select: userSelect,
        });
        const session = this.sessionData(user.id);
        await tx.session.create({ data: session.data });
        await tx.auditLog.create({ data: { actorId: user.id, action: 'auth.register', entityType: 'user', entityId: user.id } });
        return { user: profile(user), token: session.token, expiresAt: session.data.expiresAt };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException();
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() }, select: { ...userSelect, passwordHash: true },
    });
    const passwordHash = user?.passwordHash ?? await (this.dummyHash ??= hash(newSessionToken(), passwordOptions));
    const valid = await verify(passwordHash, dto.password).catch(() => false);
    if (!valid || !user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    const session = this.sessionData(user.id);
    await this.prisma.$transaction(async (tx) => {
      // Recheck status under the transaction after the expensive password verification.
      await tx.$queryRaw`SELECT id FROM users WHERE id=${user.id}::uuid FOR UPDATE`;
      const eligible = await tx.user.findFirst({ where: { id: user.id, status: 'ACTIVE', passwordHash: user.passwordHash }, select: { id: true } });
      if (!eligible) throw new UnauthorizedException();
      await tx.session.create({ data: session.data });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id } });
    });
    return { user: profile(user), token: session.token, expiresAt: session.data.expiresAt };
  }

  async authenticate(token: string): Promise<AuthContext> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: tokenHash(token) },
      select: { id: true, revokedAt: true, expiresAt: true, user: { select: userSelect } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException();
    }
    return {
      sessionId: session.id, expiresAt: session.expiresAt,
      csrfToken: csrfTokenFor(token), user: profile(session.user),
    };
  }

  async refresh(auth: AuthContext, currentToken: string) {
    const token = newSessionToken();
    const result = await this.prisma.session.updateMany({
      where: {
        id: auth.sessionId, refreshTokenHash: tokenHash(currentToken),
        revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' },
      },
      data: { refreshTokenHash: tokenHash(token) },
    });
    if (result.count !== 1) throw new UnauthorizedException();
    // Rotation preserves absolute expiry; a stolen credential cannot extend its lifetime.
    return { token, expiresAt: auth.expiresAt, csrfToken: csrfTokenFor(token) };
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.updateMany({ where: { id: auth.sessionId, userId: auth.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: auth.user.id, action: 'auth.logout', entityType: 'session', entityId: auth.sessionId } });
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserProfile> {
    const data = {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
    };
    if (Object.keys(data).length === 0) throw new BadRequestException();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({ where: { id: userId, status: 'ACTIVE' }, data });
      if (updated.count !== 1) throw new UnauthorizedException();
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: userSelect });
      await tx.auditLog.create({ data: { actorId: userId, action: 'profile.update', entityType: 'user', entityId: userId, metadata: { fields: Object.keys(data) } } });
      return profile(user);
    });
  }
}
