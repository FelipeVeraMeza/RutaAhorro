/**
 * Carrito del POS: totales, descuentos y límites por rol.
 *
 * Todo esto se recalcula también en la base de datos (`fn_register_sale`).
 * La versión del cliente existe para que el cajero vea el total al instante,
 * no para ser la autoridad. Si ambas difieren, manda la base de datos.
 */
import { clp } from './money.js';

export type UserRole = 'admin' | 'supervisor' | 'vendedor' | 'bodega';

export interface CartLine {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  discountAmount?: number;
  unitCost?: number;
  tracksExpiry?: boolean;
  stockAvailable?: number;
}

export interface CartTotals {
  subtotal: number;
  discountTotal: number;
  total: number;
  itemCount: number;
  unitCount: number;
}

/** Subtotal de una línea, nunca negativo: un descuento mayor al precio no regala plata. */
export function lineSubtotal(line: CartLine): number {
  const gross = clp(line.unitPrice * line.quantity);
  const discount = clp(line.discountAmount ?? 0);
  return Math.max(gross - discount, 0);
}

export function cartTotals(lines: CartLine[], globalDiscount = 0): CartTotals {
  const gross = lines.reduce((sum, l) => sum + clp(l.unitPrice * l.quantity), 0);
  const lineDiscounts = lines.reduce((sum, l) => sum + clp(l.discountAmount ?? 0), 0);
  const discountTotal = clp(lineDiscounts + globalDiscount);
  return {
    subtotal: clp(gross),
    discountTotal,
    total: Math.max(clp(gross) - discountTotal, 0),
    itemCount: lines.length,
    unitCount: lines.reduce((sum, l) => sum + l.quantity, 0),
  };
}

/** Agrega un producto: si ya está, suma cantidad en vez de duplicar la línea (US-14). */
export function addToCart(lines: CartLine[], incoming: CartLine): CartLine[] {
  const idx = lines.findIndex((l) => l.productId === incoming.productId);
  if (idx === -1) return [...lines, incoming];
  const next = [...lines];
  next[idx] = { ...next[idx], quantity: next[idx].quantity + incoming.quantity };
  return next;
}

export function setQuantity(lines: CartLine[], productId: string, quantity: number): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.productId !== productId);
  return lines.map((l) => (l.productId === productId ? { ...l, quantity } : l));
}

export function removeFromCart(lines: CartLine[], productId: string): CartLine[] {
  return lines.filter((l) => l.productId !== productId);
}

/** Tope de descuento por rol. El valor real viene de tenants.settings. */
export const DEFAULT_MAX_DISCOUNT: Record<UserRole, number> = {
  admin: 100,
  supervisor: 10,
  vendedor: 0,
  bodega: 0,
};

export function maxDiscountFor(role: UserRole, overrides?: Partial<Record<UserRole, number>>): number {
  return overrides?.[role] ?? DEFAULT_MAX_DISCOUNT[role];
}

/** ¿El descuento cabe dentro del límite del usuario? */
export function isDiscountAllowed(
  discountAmount: number,
  grossAmount: number,
  role: UserRole,
  overrides?: Partial<Record<UserRole, number>>,
): boolean {
  if (discountAmount <= 0) return true;
  if (grossAmount <= 0) return false;
  const pct = (clp(discountAmount) / clp(grossAmount)) * 100;
  // Tolerancia por redondeo: un descuento de "10 %" sobre $1.999 da 10.005 %,
  // y rechazarlo sería incomprensible para el cajero.
  return pct <= maxDiscountFor(role, overrides) + 0.011;
}

/** Líneas cuyo stock no alcanza. No bloquea la venta: informa (ADR-005). */
export function insufficientStock(lines: CartLine[]): CartLine[] {
  return lines.filter(
    (l) => typeof l.stockAvailable === 'number' && l.stockAvailable < l.quantity,
  );
}

/** Utilidad bruta estimada del carrito. Solo se muestra a admin (RF-M2-10). */
export function estimatedProfit(lines: CartLine[]): number {
  return lines.reduce(
    (sum, l) => sum + lineSubtotal(l) - clp((l.unitCost ?? 0) * l.quantity),
    0,
  );
}
