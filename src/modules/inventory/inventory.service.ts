import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { transaction } from '../../common/database/transaction.js';
import type { AdjustmentDto, InventoryLocationDto, InventoryQueryDto, ReservationDto, ReservationQueryDto } from './inventory.dto.js';

type Tx = Prisma.TransactionClient;
type BalanceRow = { variantId: string; locationId: string; onHand: number; reserved: number; available: number; lowStockThreshold: number; sku: string; productName: string; locationName: string; isActive: boolean; updatedAt: Date };

export function inventoryKey(key: unknown): string {
  if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) throw new BadRequestException();
  return key;
}

@Injectable()
export class InventoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async requestLock(tx: Tx, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private audit(tx: Tx, actorId: string | null, action: string, id: string, metadata: Prisma.InputJsonValue = {}) {
    return tx.auditLog.create({ data: { actorId, action, entityType: 'inventory', entityId: id, metadata } });
  }

  private async variant(tx: Tx, id: string, published: boolean, allowArchived = false) {
    // Match the catalog's parent-first locking order; re-read variant state after waiting.
    const [parent] = await tx.$queryRaw<{ id: string; status: string; published: boolean | null }[]>`
      SELECT id, status, published_at <= clock_timestamp() AS published FROM products
      WHERE id = (SELECT product_id FROM product_variants WHERE id = ${id}::uuid) FOR SHARE`;
    if (!parent) throw new NotFoundException();
    const variant = await tx.productVariant.findFirst({ where: { id, productId: parent.id }, select: { id: true, status: true } });
    if (!variant) throw new NotFoundException();
    if (!allowArchived && (parent.status === 'ARCHIVED' || variant.status !== 'ACTIVE')) throw new ConflictException();
    if (published && (parent.status !== 'PUBLISHED' || !parent.published)) throw new ConflictException();
  }

  private async location(tx: Tx, id: string) {
    const [location] = await tx.$queryRaw<{ is_active: boolean }[]>`SELECT is_active FROM inventory_locations WHERE id = ${id}::uuid FOR SHARE`;
    if (!location) throw new NotFoundException();
    if (!location.is_active) throw new ConflictException();
  }

  async adjust(dto: AdjustmentDto, key: unknown, actorId: string) {
    const requestKey = `inventory:adjust:${actorId}:${inventoryKey(key)}`;
    if (dto.type === 'RETURN' && dto.delta < 1) throw new BadRequestException();
    return transaction(this.prisma, async (tx) => {
      await this.requestLock(tx, requestKey);
      const prior = await tx.stockMovement.findUnique({ where: { idempotencyKey: requestKey } });
      if (prior) {
        if (prior.variantId !== dto.variantId || prior.locationId !== dto.locationId || prior.quantityDelta !== dto.delta || prior.reason !== dto.reason || prior.type !== dto.type || prior.actorId !== actorId) throw new ConflictException();
        return prior;
      }
      await this.variant(tx, dto.variantId, false, dto.type === 'RETURN');
      await this.location(tx, dto.locationId);
      await tx.$executeRaw`INSERT INTO inventory_balances (variant_id, location_id)
        VALUES (${dto.variantId}::uuid, ${dto.locationId}::uuid) ON CONFLICT (variant_id, location_id) DO NOTHING`;
      const changed = await tx.$executeRaw`
        UPDATE inventory_balances SET on_hand = (on_hand::bigint + ${dto.delta})::integer, updated_at = clock_timestamp()
        WHERE variant_id = ${dto.variantId}::uuid AND location_id = ${dto.locationId}::uuid
          AND on_hand::bigint + ${dto.delta} BETWEEN reserved AND 2147483647`;
      if (changed !== 1) throw new ConflictException();
      const movement = await tx.stockMovement.create({ data: {
        variantId: dto.variantId, locationId: dto.locationId, actorId, type: dto.type,
        quantityDelta: dto.delta, reservedDelta: 0, reason: dto.reason, idempotencyKey: requestKey,
      } });
      await this.audit(tx, actorId, dto.type === 'RETURN' ? 'inventory.return' : 'inventory.adjust', movement.id);
      return movement;
    });
  }

  async reserve(dto: ReservationDto, key: unknown, actorId: string) {
    const requestKey = `inventory:reserve:${actorId}:${inventoryKey(key)}`;
    return transaction(this.prisma, async (tx) => {
      await this.requestLock(tx, requestKey);
      const prior = await tx.stockReservation.findUnique({ where: { idempotencyKey: requestKey } });
      if (prior) {
        const movement = await tx.stockMovement.findUnique({ where: { idempotencyKey: requestKey } });
        if (!movement || prior.variantId !== dto.variantId || prior.locationId !== dto.locationId || prior.quantity !== dto.quantity ||
          prior.expiresAt.getTime() - prior.createdAt.getTime() !== dto.ttlSeconds * 1000 || movement.reason !== dto.reason || movement.actorId !== actorId) throw new ConflictException();
        return prior;
      }
      await this.variant(tx, dto.variantId, true);
      await this.location(tx, dto.locationId);
      const changed = await tx.$executeRaw`
        UPDATE inventory_balances SET reserved = reserved + ${dto.quantity}, updated_at = clock_timestamp()
        WHERE variant_id = ${dto.variantId}::uuid AND location_id = ${dto.locationId}::uuid
          AND on_hand - reserved >= ${dto.quantity}`;
      if (changed !== 1) throw new ConflictException();
      const [time] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const reservation = await tx.stockReservation.create({ data: {
        variantId: dto.variantId, locationId: dto.locationId, quantity: dto.quantity,
        idempotencyKey: requestKey, createdAt: time.now, updatedAt: time.now,
        expiresAt: new Date(time.now.getTime() + dto.ttlSeconds * 1000),
      } });
      await tx.stockMovement.create({ data: { variantId: dto.variantId, locationId: dto.locationId, actorId,
        type: 'RESERVATION', quantityDelta: 0, reservedDelta: dto.quantity, reason: dto.reason, idempotencyKey: requestKey } });
      await this.audit(tx, actorId, 'inventory.reserve', reservation.id);
      return reservation;
    });
  }

  private async transition(id: string, target: 'COMMITTED' | 'RELEASED' | 'EXPIRED', actorId: string | null) {
    return transaction(this.prisma, async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stock_reservations WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked.length) throw new NotFoundException();
      const reservation = await tx.stockReservation.findUniqueOrThrow({ where: { id } });
      const [time] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      if (target === 'EXPIRED' && (reservation.status !== 'ACTIVE' || reservation.expiresAt > time.now)) return { reservation, changed: false };
      if (reservation.status !== 'ACTIVE') {
        if (reservation.status === target || (target === 'RELEASED' && reservation.status === 'EXPIRED')) return { reservation, changed: false };
        throw new ConflictException();
      }
      const status = reservation.expiresAt <= time.now ? 'EXPIRED' : target;
      const committed = status === 'COMMITTED';
      const changed = await tx.$executeRaw`
        UPDATE inventory_balances SET reserved = reserved - ${reservation.quantity},
          on_hand = on_hand - ${committed ? reservation.quantity : 0}, updated_at = clock_timestamp()
        WHERE variant_id = ${reservation.variantId}::uuid AND location_id = ${reservation.locationId}::uuid
          AND reserved >= ${reservation.quantity}`;
      if (changed !== 1) throw new ConflictException();
      const updated = await tx.stockReservation.update({ where: { id }, data: { status } });
      await tx.stockMovement.create({ data: { variantId: reservation.variantId, locationId: reservation.locationId, actorId,
        type: committed ? 'COMMIT' : 'RELEASE', quantityDelta: committed ? -reservation.quantity : 0,
        reservedDelta: -reservation.quantity, reason: `Reservation ${status.toLowerCase()}`,
        idempotencyKey: `inventory:reservation:${id}:terminal` } });
      await this.audit(tx, actorId, `inventory.${status.toLowerCase()}`, id);
      return { reservation: updated, changed: true };
    });
  }

  async commit(id: string, actorId: string) {
    const result = await this.transition(id, 'COMMITTED', actorId);
    // Expiry/release must remain committed even though the attempted commitment fails.
    if (result.reservation.status !== 'COMMITTED') throw new ConflictException();
    return result.reservation;
  }

  async release(id: string, actorId: string) { return (await this.transition(id, 'RELEASED', actorId)).reservation; }

  async expireBatch(limit = 100) {
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM stock_reservations WHERE status = 'ACTIVE' AND expires_at <= clock_timestamp()
      ORDER BY expires_at, id LIMIT ${limit}`;
    let expired = 0;
    // Each transaction owns one reservation, avoiding cross-reservation balance lock cycles.
    for (const { id } of ids) if ((await this.transition(id, 'EXPIRED', null)).changed) expired++;
    return { expired };
  }

  async balances(query: InventoryQueryDto, lowStock = false) {
    const conditions: Prisma.Sql[] = [];
    if (query.variantId) conditions.push(Prisma.sql`b.variant_id = ${query.variantId}::uuid`);
    if (query.locationId) conditions.push(Prisma.sql`b.location_id = ${query.locationId}::uuid`);
    if (lowStock) conditions.push(Prisma.sql`l.is_active AND v.status = 'ACTIVE' AND p.status <> 'ARCHIVED' AND b.on_hand - b.reserved <= b.low_stock_threshold`);
    const selection = Prisma.sql`SELECT b.variant_id AS "variantId", b.location_id AS "locationId", b.on_hand AS "onHand",
      b.reserved, b.on_hand - b.reserved AS available, b.low_stock_threshold AS "lowStockThreshold", v.sku,
      p.name AS "productName", l.name AS "locationName", l.is_active AS "isActive", b.updated_at AS "updatedAt"
      FROM inventory_balances b JOIN product_variants v ON v.id = b.variant_id
      JOIN products p ON p.id = v.product_id JOIN inventory_locations l ON l.id = b.location_id
      ${conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty}`;
    return this.prisma.$transaction(async (tx) => {
      const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total FROM (${selection}) q`;
      const items = await tx.$queryRaw<BalanceRow[]>`SELECT * FROM (${selection}) q ORDER BY "variantId", "locationId"
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
      return { items, total: count.total };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async movements(query: InventoryQueryDto) {
    const where = { ...(query.variantId ? { variantId: query.variantId } : {}), ...(query.locationId ? { locationId: query.locationId } : {}) };
    return this.prisma.$transaction(async (tx) => ({
      items: await tx.stockMovement.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit, skip: (query.page - 1) * query.limit }),
      total: await tx.stockMovement.count({ where }),
    }), { isolationLevel: 'RepeatableRead' });
  }

  async reservation(id: string) {
    const value = await this.prisma.stockReservation.findUnique({ where: { id } });
    if (!value) throw new NotFoundException();
    return value;
  }

  async reservations(query: ReservationQueryDto) {
    const where = { ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}), ...(query.status ? { status: query.status } : {}) };
    return this.prisma.$transaction(async (tx) => ({
      items: await tx.stockReservation.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit, skip: (query.page - 1) * query.limit }),
      total: await tx.stockReservation.count({ where }),
    }), { isolationLevel: 'RepeatableRead' });
  }

  locations(query: InventoryQueryDto) {
    return this.prisma.inventoryLocation.findMany({ orderBy: { code: 'asc' }, take: query.limit, skip: (query.page - 1) * query.limit });
  }

  createLocation(dto: InventoryLocationDto, actorId: string) {
    return transaction(this.prisma, async (tx) => {
      const location = await tx.inventoryLocation.create({ data: { code: dto.code, name: dto.name } });
      await this.audit(tx, actorId, 'inventory.location_create', location.id);
      return location;
    });
  }

  threshold(variantId: string, locationId: string, value: number, actorId: string) {
    return transaction(this.prisma, async (tx) => {
      const changed = await tx.inventoryBalance.updateMany({ where: { variantId, locationId }, data: { lowStockThreshold: value } });
      if (!changed.count) throw new NotFoundException();
      await this.audit(tx, actorId, 'inventory.threshold', variantId, { locationId, lowStockThreshold: value });
      return tx.inventoryBalance.findUniqueOrThrow({ where: { variantId_locationId: { variantId, locationId } } });
    });
  }

  locationStatus(id: string, isActive: boolean, actorId: string) {
    return transaction(this.prisma, async (tx) => {
      const changed = await tx.inventoryLocation.updateMany({ where: { id }, data: { isActive } });
      if (!changed.count) throw new NotFoundException();
      await this.audit(tx, actorId, 'inventory.location_status', id, { isActive });
      return tx.inventoryLocation.findUniqueOrThrow({ where: { id } });
    });
  }
}
