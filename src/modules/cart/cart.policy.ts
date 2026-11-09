import { BadRequestException } from '@nestjs/common';

export const CART_LINE_LIMIT = 50;
export const CART_QUANTITY_LIMIT = 99;

export function lineAmount(unitPrice: number, quantity: number): number {
  if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || unitPrice > 1000000000 ||
    !Number.isInteger(quantity) || quantity < 1 || quantity > CART_QUANTITY_LIMIT) throw new BadRequestException();
  // Integer cents; even 50 maximum-size lines remain below Number.MAX_SAFE_INTEGER.
  return unitPrice * quantity;
}

export function mergeQuantities(destination: { variantId: string; quantity: number }[], source: { variantId: string; quantity: number }[]) {
  const combined = new Map(destination.map((line) => [line.variantId, line.quantity]));
  for (const line of source) combined.set(line.variantId, (combined.get(line.variantId) ?? 0) + line.quantity);
  if (combined.size > CART_LINE_LIMIT) return { reason: 'CART_LIMIT' as const, quantities: null };
  if ([...combined.values()].some((quantity) => quantity > CART_QUANTITY_LIMIT)) return { reason: 'QUANTITY_LIMIT' as const, quantities: null };
  return { reason: null, quantities: combined };
}

export function emptyCart() {
  return { id: null, items: [], currency: 'USD' as const, subtotal: 0, itemCount: 0, canCheckout: false,
    expiresAt: null, requiresInitialization: true };
}
