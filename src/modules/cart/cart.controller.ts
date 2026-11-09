import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { GuestAllowed } from '../auth/auth.metadata.js';
import { csrfTokenFor } from '../auth/auth.tokens.js';
import type { AuthRequest } from '../auth/auth.types.js';
import { CartService, type CartOwner } from './cart.service.js';
import { AddCartItemDto, CartQuantityDto } from './cart.dto.js';
import { emptyCart } from './cart.policy.js';
import { CartMergeResponseDto, CartResponseDto } from './cart-response.dto.js';

const uuid = new ParseUUIDPipe({ version: '4' });

@GuestAllowed()
@ApiCookieAuth()
@ApiTags('Customer and guest cart')
@Controller('customer/cart')
export class CartController {
  constructor(@Inject(CartService) private readonly carts: CartService) {}

  private owner(req: AuthRequest, mutation: boolean): CartOwner {
    return this.carts.ownerFromRequest(req,mutation);
  }

  private response(req: AuthRequest, owner: CartOwner, cart: Awaited<ReturnType<CartService['get']>>, res: Response, renew: boolean) {
    if (owner.kind === 'guest' && renew) this.carts.setCookie(res, owner.token, cart.expiresAt);
    return { ...cart, csrfToken: owner.kind === 'guest' ? csrfTokenFor(owner.token) : req.auth!.csrfToken };
  }

  @Get()
  @ApiOkResponse({ type: CartResponseDto })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read current prices/stock. An uninitialized guest receives requiresInitialization=true.' })
  async get(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    if (!req.auth && !this.carts.tokenFromRequest(req)) return { ...emptyCart(), csrfToken: null };
    const owner = this.owner(req, false);
    try { return this.response(req, owner, await this.carts.get(owner), res, false); }
    catch (error) {
      if (owner.kind !== 'guest' || !(error instanceof UnauthorizedException)) throw error;
      this.carts.clearCookie(res);
      return { ...emptyCart(), csrfToken: null };
    }
  }

  @Post('session')
  @ApiCreatedResponse({ type: CartResponseDto })
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 900000 } })
  @ApiHeader({ name: 'Origin', required: true })
  @ApiOperation({ summary: 'Initialize a guest cart and obtain its HttpOnly cookie and CSRF token.' })
  async initialize(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    if (req.auth) {
      const owner = this.owner(req, false);
      return this.response(req, owner, await this.carts.get(owner), res, false);
    }
    const initialized = await this.carts.initialize(this.carts.tokenFromRequest(req));
    this.carts.setCookie(res, initialized.token, initialized.cart.expiresAt);
    return { ...initialized.cart, csrfToken: csrfTokenFor(initialized.token) };
  }

  @Post('items')
  @ApiCreatedResponse({ type: CartResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  async add(@Body() dto: AddCartItemDto, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const owner = this.owner(req, true);
    return this.response(req, owner, await this.carts.add(owner, dto.variantId, dto.quantity), res, true);
  }

  @Patch('items/:id')
  @ApiOkResponse({ type: CartResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  async update(@Param('id', uuid) id: string, @Body() dto: CartQuantityDto, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const owner = this.owner(req, true);
    return this.response(req, owner, await this.carts.update(owner, id, dto.quantity), res, true);
  }

  @Delete('items/:id')
  @ApiOkResponse({ type: CartResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  async remove(@Param('id', uuid) id: string, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const owner = this.owner(req, true);
    return this.response(req, owner, await this.carts.remove(owner, id), res, true);
  }

  @Delete()
  @ApiOkResponse({ type: CartResponseDto })
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  async clear(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const owner = this.owner(req, true);
    return this.response(req, owner, await this.carts.clear(owner), res, true);
  }

  @Post('merge')
  @ApiOkResponse({ type: CartMergeResponseDto })
  @HttpCode(200)
  @ApiHeader({ name: 'Origin', required: true }) @ApiHeader({ name: 'X-CSRF-Token', required: true })
  @ApiOperation({ summary: 'Retry a deferred guest merge after reducing the customer cart.' })
  async merge(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    if (!req.auth) throw new UnauthorizedException();
    const token = this.carts.tokenFromRequest(req);
    const merge = await this.carts.mergeOnLogin(req.auth.user.id, token);
    if (token && merge.status !== 'deferred') this.carts.clearCookie(res);
    const owner: CartOwner = { kind: 'user', userId: req.auth.user.id };
    return { merge, cart: this.response(req, owner, await this.carts.get(owner), res, false) };
  }
}
