import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { Cart, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { transaction } from '../../common/database/transaction.js';
import { csrfTokenFor, matchesCsrf, newSessionToken, tokenHash } from '../auth/auth.tokens.js';
import type { AuthRequest } from '../auth/auth.types.js';
import { productInclude, variantChoices } from '../catalog/catalog.policy.js';
import { CART_LINE_LIMIT, CART_QUANTITY_LIMIT, lineAmount, mergeQuantities } from './cart.policy.js';

type Tx = Prisma.TransactionClient;
export type CartOwner = { kind: 'user'; userId: string } | { kind: 'guest'; token: string };

const variantInclude = {
  ...productInclude.variants.include,
  product: { select: { id: true, slug: true, name: true, status: true, publishedAt: true,
    images: { orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 1 }, categories: { select: { categoryId: true }, take: 1 } } },
} satisfies Prisma.ProductVariantInclude;
type CartVariant = Prisma.ProductVariantGetPayload<{ include: typeof variantInclude }>;

function sellable(variant: CartVariant, now: Date): boolean {
  return variant.status === 'ACTIVE' && variant.product.status === 'PUBLISHED' &&
    variant.product.publishedAt !== null && variant.product.publishedAt <= now &&
    variant.product.images.length > 0 && variant.product.categories.length > 0 && variantChoices(variant) !== null;
}

function available(variant: CartVariant): number {
  return variant.balances.reduce((sum, balance) => Math.min(CART_QUANTITY_LIMIT, sum + balance.onHand - balance.reserved), 0);
}

@Injectable()
export class CartService {
  readonly cookieName: string;
  private readonly cookieOptions: CookieOptions;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(ConfigService) config: ConfigService) {
    const secure = config.get<string>('NODE_ENV') === 'production';
    this.cookieName = secure ? '__Host-zaryab_cart' : 'zaryab_cart';
    this.cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  }

  tokenFromRequest(req: Request): string | undefined {
    const cookies: unknown = req.cookies;
    if (!cookies || typeof cookies !== 'object') return undefined;
    const value = (cookies as Record<string, unknown>)[this.cookieName];
    return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
  }

  setCookie(res: Response, token: string, expiresAt: Date) { res.cookie(this.cookieName, token, { ...this.cookieOptions, expires: expiresAt }); }
  clearCookie(res: Response) { res.clearCookie(this.cookieName, this.cookieOptions); }

  private async now(tx: Tx) { return (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0].now; }

  private async lock(tx: Tx, id: string): Promise<Cart> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM carts WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new UnauthorizedException();
    return tx.cart.findUniqueOrThrow({ where: { id } });
  }

  private async touch(tx: Tx, id: string) {
    const now = await this.now(tx);
    return tx.cart.update({ where: { id }, data: { expiresAt: new Date(now.getTime() + 30 * 86400000), updatedAt: now } });
  }

  private async userCart(tx: Tx, userId: string): Promise<Cart> {
    await tx.$executeRaw`INSERT INTO carts (user_id, expires_at) VALUES (${userId}::uuid, clock_timestamp() + interval '30 days')
      ON CONFLICT (user_id) DO NOTHING`;
    const found = await tx.cart.findUniqueOrThrow({ where: { userId }, select: { id: true } });
    let cart = await this.lock(tx, found.id);
    if (cart.status !== 'ACTIVE' || cart.expiresAt <= await this.now(tx)) {
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { status: 'ACTIVE', mergedIntoId: null } });
      cart = await this.touch(tx, cart.id);
    }
    return cart;
  }

  async owned(tx: Tx, owner: CartOwner): Promise<Cart> {
    if (owner.kind === 'user') return this.userCart(tx, owner.userId);
    const found = await tx.cart.findUnique({ where: { guestTokenHash: tokenHash(owner.token) }, select: { id: true } });
    if (!found) throw new UnauthorizedException();
    const cart = await this.lock(tx, found.id);
    if (cart.userId || cart.status !== 'ACTIVE' || cart.expiresAt <= await this.now(tx)) throw new UnauthorizedException();
    return cart;
  }

  async snapshot(tx: Tx, cart: Cart) {
    const now = await this.now(tx);
    const stored = await tx.cartItem.findMany({ where: { cartId: cart.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: CART_LINE_LIMIT + 1,
      include: { variant: { include: variantInclude } } });
    if (stored.length > CART_LINE_LIMIT) throw new ConflictException();
    const items = stored.map((line) => {
      const variant = line.variant;
      const visible = sellable(variant, now);
      const quantityAvailable = visible ? available(variant) : 0;
      const choices = visible ? variantChoices(variant) : null;
      return {
        id: line.id, variantId: line.variantId, quantity: line.quantity,
        product: visible ? { id: variant.product.id, slug: variant.product.slug, name: variant.product.name, image: variant.product.images[0].url } : null,
        sku: visible ? variant.sku : null, size: choices?.size ?? null, color: choices?.color ?? null,
        unitPrice: visible ? variant.price : null, currency: 'USD' as const,
        lineTotal: visible ? lineAmount(variant.price, line.quantity) : null,
        availableQuantity: quantityAvailable, available: visible && quantityAvailable >= line.quantity,
        issue: !visible ? 'UNAVAILABLE' : quantityAvailable < line.quantity ? 'INSUFFICIENT_STOCK' : null,
      };
    });
    return { id: cart.id, items, currency: 'USD' as const,
      subtotal: items.some((item) => item.lineTotal === null) ? null : items.reduce((sum, item) => sum + item.lineTotal!, 0),
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0), canCheckout: items.length > 0 && items.every((item) => item.available),
      expiresAt: cart.expiresAt, requiresInitialization: false };
  }

  get(owner: CartOwner) { return transaction(this.prisma, async (tx) => this.snapshot(tx, await this.owned(tx, owner))); }

  ownerFromRequest(req: AuthRequest, mutation: boolean): CartOwner {
    if(req.auth) return {kind:'user',userId:req.auth.user.id};
    const token=this.tokenFromRequest(req);
    if(!token) throw new UnauthorizedException();
    if(mutation && !matchesCsrf(req.headers['x-csrf-token'],csrfTokenFor(token))) throw new ForbiddenException();
    return {kind:'guest',token};
  }

  async initialize(token?: string) {
    return transaction(this.prisma, async (tx) => {
      if (token) {
        const found = await tx.cart.findUnique({ where: { guestTokenHash: tokenHash(token) }, select: { id: true } });
        if (found) {
          const cart = await this.lock(tx, found.id);
          if (!cart.userId && cart.status === 'ACTIVE' && cart.expiresAt > await this.now(tx)) return { token, cart: await this.snapshot(tx, cart) };
        }
      }
      const credential = newSessionToken();
      const [created] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO carts (guest_token_hash, expires_at) VALUES (${tokenHash(credential)}, clock_timestamp() + interval '30 days') RETURNING id`;
      const cart = await tx.cart.findUniqueOrThrow({ where: { id: created.id } });
      return { token: credential, cart: await this.snapshot(tx, cart) };
    });
  }

  private async quantityAllowed(tx: Tx, variantId: string, quantity: number) {
    const variant = await tx.productVariant.findUnique({ where: { id: variantId }, include: variantInclude });
    if (!variant || !sellable(variant, await this.now(tx))) throw new NotFoundException();
    if (quantity > CART_QUANTITY_LIMIT || available(variant) < quantity) throw new ConflictException();
  }

  add(owner: CartOwner, variantId: string, quantity: number) {
    return transaction(this.prisma, async (tx) => {
      const cart = await this.owned(tx, owner);
      const prior = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId } } });
      const desired = (prior?.quantity ?? 0) + quantity;
      if (!prior && await tx.cartItem.count({ where: { cartId: cart.id } }) >= CART_LINE_LIMIT) throw new ConflictException();
      await this.quantityAllowed(tx, variantId, desired);
      await tx.cartItem.upsert({ where: { cartId_variantId: { cartId: cart.id, variantId } },
        create: { cartId: cart.id, variantId, quantity: desired }, update: { quantity: desired } });
      return this.snapshot(tx, await this.touch(tx, cart.id));
    });
  }

  update(owner: CartOwner, itemId: string, quantity: number) {
    return transaction(this.prisma, async (tx) => {
      const cart = await this.owned(tx, owner);
      const item = await tx.cartItem.findFirst({ where: { id: itemId, cartId: cart.id } });
      if (!item) throw new NotFoundException();
      if (quantity > item.quantity) await this.quantityAllowed(tx, item.variantId, quantity);
      await tx.cartItem.update({ where: { id: item.id }, data: { quantity } });
      return this.snapshot(tx, await this.touch(tx, cart.id));
    });
  }

  remove(owner: CartOwner, itemId: string) {
    return transaction(this.prisma, async (tx) => {
      const cart = await this.owned(tx, owner);
      const removed = await tx.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
      if (!removed.count) throw new NotFoundException();
      return this.snapshot(tx, await this.touch(tx, cart.id));
    });
  }

  clear(owner: CartOwner) {
    return transaction(this.prisma, async (tx) => {
      const cart = await this.owned(tx, owner);
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return this.snapshot(tx, await this.touch(tx, cart.id));
    });
  }

  async mergeOnLogin(userId: string, token?: string) {
    if (!token) return { status: 'none' as const };
    return transaction(this.prisma, async (tx) => {
      const found = await tx.cart.findUnique({ where: { guestTokenHash: tokenHash(token) }, select: { id: true } });
      if (!found) return { status: 'none' as const };
      // Guest rows are always locked before user rows; the owner domains are disjoint.
      const source = await this.lock(tx, found.id);
      if (source.status === 'MERGED') {
        const destination = await tx.cart.findUnique({ where: { userId }, select: { id: true } });
        return { status: destination?.id === source.mergedIntoId ? 'already_merged' as const : 'none' as const };
      }
      if (source.status !== 'ACTIVE' || source.expiresAt <= await this.now(tx)) return { status: 'expired' as const };
      const destination = await this.userCart(tx, userId);
      await tx.order.updateMany({ where:{ customerId:null,guestTokenHash:tokenHash(token),guestAccessExpiresAt:{gt:await this.now(tx)} },
        data:{customerId:userId,guestTokenHash:null,guestAccessExpiresAt:null} });
      await tx.couponRedemption.updateMany({where:{customerId:null,order:{customerId:userId}},data:{customerId:userId}});
      const guestItems = await tx.cartItem.findMany({ where: { cartId: source.id } });
      const userItems = await tx.cartItem.findMany({ where: { cartId: destination.id } });
      const combined = mergeQuantities(userItems, guestItems);
      if (!combined.quantities) return { status: 'deferred' as const, reason: combined.reason };
      for (const [variantId, quantity] of combined.quantities) {
        await tx.cartItem.upsert({ where: { cartId_variantId: { cartId: destination.id, variantId } },
          create: { cartId: destination.id, variantId, quantity }, update: { quantity } });
      }
      await tx.cartItem.deleteMany({ where: { cartId: source.id } });
      await tx.cart.update({ where: { id: source.id }, data: { status: 'MERGED', mergedIntoId: destination.id } });
      await this.touch(tx, destination.id);
      await tx.auditLog.create({ data: { actorId: userId, action: 'cart.merge', entityType: 'cart', entityId: destination.id,
        metadata: { sourceCartId: source.id, lineCount: guestItems.length } } });
      return { status: 'merged' as const };
    });
  }

  async expireBatch(limit = 100) {
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM carts WHERE status = 'ACTIVE'
      AND expires_at <= clock_timestamp() ORDER BY expires_at, id LIMIT ${limit}`;
    let expired = 0;
    for (const { id } of ids) {
      if (await transaction(this.prisma, async (tx) => {
        const cart = await this.lock(tx, id);
        if (cart.status !== 'ACTIVE' || cart.expiresAt > await this.now(tx)) return false;
        await tx.cartItem.deleteMany({ where: { cartId: id } });
        await tx.cart.update({ where: { id }, data: { status: 'EXPIRED' } });
        return true;
      })) expired++;
    }
    return { expired };
  }
}
