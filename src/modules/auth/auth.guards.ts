import { ForbiddenException, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { RoleName } from '../../generated/prisma/enums.js';
import { AuthService } from './auth.service.js';
import { OPTIONAL_AUTH_ROUTE, PUBLIC_ROUTE, REQUIRED_PERMISSIONS, REQUIRED_ROLES } from './auth.metadata.js';
import { matchesCsrf } from './auth.tokens.js';
import type { AuthRequest } from './auth.types.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()])) return true;
    const http = context.switchToHttp();
    const req = http.getRequest<AuthRequest>();
    const res = http.getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
    const token = this.auth.tokenFromRequest(req);
    if (!token) {
      const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_ROUTE, [context.getHandler(), context.getClass()]);
      const cookies: unknown = req.cookies;
      const hasCookie = cookies !== null && typeof cookies === 'object' && Object.hasOwn(cookies, this.auth.cookieName);
      if (optional && !hasCookie) return true;
      throw new UnauthorizedException();
    }
    req.auth = await this.auth.authenticate(token);
    return true;
  }
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<RoleName[]>(REQUIRED_ROLES, targets) ?? [];
    const permissions = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets) ?? [];
    if (!roles.length && !permissions.length) return true;
    const auth = context.switchToHttp().getRequest<AuthRequest>().auth;
    if (!auth) throw new UnauthorizedException();
    if (roles.length && !roles.some((role) => auth.user.roles.includes(role))) throw new ForbiddenException();
    if (!permissions.every((permission) => auth.user.permissions.includes(permission))) throw new ForbiddenException();
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    // Origin validation also protects public registration/login against login CSRF.
    const origin = req.headers.origin;
    if (!origin || !this.config.getOrThrow<string>('CORS_ORIGINS').split(',').includes(origin)) throw new ForbiddenException();
    if (req.auth && !matchesCsrf(req.headers['x-csrf-token'], req.auth.csrfToken)) throw new ForbiddenException();
    return true;
  }
}
