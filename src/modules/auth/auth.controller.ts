import { Body, Controller, Get, Header, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { CurrentAuth, Public, Roles } from './auth.metadata.js';
import { csrfTokenFor } from './auth.tokens.js';
import type { AuthContext } from './auth.types.js';
import { LoginDto, RegisterDto } from './dto/auth.dto.js';
import { AuthResponseDto, SessionResponseDto } from './dto/auth-response.dto.js';
import { CartService } from '../cart/cart.service.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(CartService) private readonly carts: CartService) {}

  private async completeLogin(result: Awaited<ReturnType<AuthService['login']>>, req: Request, res: Response) {
    const guestToken = this.carts.tokenFromRequest(req);
    const cartMerge = await this.carts.mergeOnLogin(result.user.id, guestToken);
    if (guestToken && cartMerge.status !== 'deferred') this.carts.clearCookie(res);
    this.auth.setCookie(res, result.token, result.expiresAt);
    return { user: result.user, csrfToken: csrfTokenFor(result.token), expiresAt: result.expiresAt, cartMerge };
  }

  @Public()
  @Post('register')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 900000 } })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiHeader({ name: 'Origin', required: true, description: 'An allowed storefront/admin origin.' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response, @Req() req: Request) {
    const result = await this.auth.register(dto);
    return this.completeLogin(result, req, res);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 900000 } })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiHeader({ name: 'Origin', required: true })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response, @Req() req: Request) {
    const result = await this.auth.login(dto);
    return this.completeLogin(result, req, res);
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOkResponse({ type: AuthResponseDto })
  me(@CurrentAuth() auth: AuthContext) {
    return { user: auth.user, csrfToken: auth.csrfToken, expiresAt: auth.expiresAt };
  }

  @Get('csrf')
  @ApiCookieAuth()
  @ApiOkResponse({ type: SessionResponseDto })
  csrf(@CurrentAuth() auth: AuthContext) { return { csrfToken: auth.csrfToken, expiresAt: auth.expiresAt }; }

  @Get('admin/me')
  @Roles('SUPER_ADMIN', 'ADMIN', 'STAFF')
  @ApiCookieAuth()
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiOperation({ summary: 'Current staff identity; returns 403 for customer-only accounts.' })
  adminMe(@CurrentAuth() auth: AuthContext) { return this.me(auth); }

  @Post('refresh')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOkResponse({ type: SessionResponseDto })
  async refresh(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const currentToken = this.auth.tokenFromRequest(req);
    if (!currentToken) throw new UnauthorizedException();
    const result = await this.auth.refresh(auth, currentToken);
    this.auth.setCookie(res, result.token, result.expiresAt);
    return { csrfToken: result.csrfToken, expiresAt: result.expiresAt };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiHeader({ name: 'Origin', required: true })
  @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiNoContentResponse()
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(auth);
    this.auth.clearCookie(res);
  }
}
