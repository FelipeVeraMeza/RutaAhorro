/**
 * Carrito del POS: totales, descuentos y límites por rol.
 *
 * Todo esto se recalcula también en la base de datos (`fn_register_sale`).
 * La versión del cliente existe para que el cajero vea el total al instante,
 * no para ser la autoridad. Si ambas difieren, manda la base de datos.
 */
import { clp } from './money.js';
import { precioPorCantidad, type TramoPrecio } from './precios.js';
import { calcularCombos, type Combo } from './combos.js';

export type UserRole = 'admin' | 'supervisor' | 'vendedor' | 'bodega';

export interface CartLine {
  productId: string;
  name: string;
  /**
   * Qué es el producto, en palabras.
   *
   * Es lo que convierte "escaneé un código" en "esto es leche entera de 1
   * litro". No entra en ningún cálculo: viaja para que la caja y el
   * comprobante puedan mostrarla.
   */
  description?: string | null;
  unitPrice: number;
  /** Entera para lo que se cuenta; con decimales solo si `unidad` lo admite (kg, litro…). */
  quantity: number;
  /** Unidad de medida del producto: decide si la cantidad admite decimales (`admiteDecimales`). */
  unidad?: string;
  discountAmount?: number;
  unitCost?: number;
  tracksExpiry?: boolean;
  stockAvailable?: number;
  /**
   * Precio normal del producto. Si viene, `unitPrice` se recalcula con los
   * tramos cada vez que cambia la cantidad (`aplicarOfertas`). Si no, la
   * línea tiene un precio fijo.
   */
  precioLista?: number;
  /** Ofertas por cantidad del producto (0018). */
  tramos?: TramoPrecio[];
  /**
   * Precio de cada unidad para el cliente elegido (0022), o null. Se cobra el
   * menor entre este y el de la oferta por cantidad: no se suman.
   */
  precioCliente?: number | null;
  /**
   * Parte del ahorro de un combo que le toca a esta línea (0023), en pesos.
   * Se recalcula entero con cada cambio del carrito (`aplicarCombos`).
   */
  descuentoCombo?: number;
  /** El combo que le dio `descuentoCombo`, para decirlo en pantalla y en el papel. */
  comboNombre?: string | null;
  /** Tasa del impuesto adicional, en % (IABA 18 → 18). 0 o ausente si no tiene. */
  tasaAdicional?: number;
  nombreAdicional?: string | null;
}

export interface CartTotals {
  subtotal: number;
  discountTotal: number;
  total: number;
  itemCount: number;
  unitCount: number;
}

/** Todo lo que se le descuenta a la línea: el descuento declarado y el del combo. */
export function descuentoDeLinea(line: CartLine): number {
  return clp(line.discountAmount ?? 0) + clp(line.descuentoCombo ?? 0);
}

/** Subtotal de una línea, nunca negativo: un descuento mayor al precio no regala plata. */
export function lineSubtotal(line: CartLine): number {
  const gross = clp(line.unitPrice * line.quantity);
  return Math.max(gross - descuentoDeLinea(line), 0);
}

export function cartTotals(lines: CartLine[], globalDiscount = 0): CartTotals {
  const gross = lines.reduce((sum, l) => sum + clp(l.unitPrice * l.quantity), 0);
  // Cada línea aporta como mucho su propio bruto, igual que en la base
  // (fn_register_sale topa el subtotal de la línea en 0). Restar el descuento
  // entero rebajaba las OTRAS líneas: el total de la pantalla quedaba bajo el
  // de la base y la venta se rechazaba con PAGO_NO_CUADRA.
  const lineas = lines.reduce((sum, l) => sum + lineSubtotal(l), 0);
  const total = Math.max(lineas - clp(globalDiscount), 0);
  return {
    subtotal: clp(gross),
    discountTotal: clp(gross) - total,
    total,
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

/**
 * Utilidad bruta estimada del carrito. Solo se muestra a admin (RF-M2-10).
 *
 * El costo es neto desde 2026-10-01 (docs/26 N° 13) y el precio trae IVA (y
 * el impuesto adicional): se pasa cada línea a neto antes de restar. Restar
 * el costo neto del precio con IVA le sumaba a la utilidad lo que es del fisco.
 */
export function estimatedProfit(lines: CartLine[], ivaPct = 19): number {
  return lines.reduce((sum, l) => {
    const neto = clp(lineSubtotal(l) / (1 + ivaPct / 100 + (l.tasaAdicional ?? 0) / 100));
    return sum + neto - clp((l.unitCost ?? 0) * l.quantity);
  }, 0);
}

/**
 * Pone a cada línea el precio que le corresponde por su cantidad (ofertas por
 * tramo, 0018). Se llama después de cada cambio del carrito: con 2 unidades
 * la línea va a precio normal, al agregar la tercera baja a precio de oferta
 * y todas las unidades quedan a ese precio.
 *
 * `dia` es el día del local ('AAAA-MM-DD'), para las ofertas con fecha.
 */
export function aplicarOfertas(lines: CartLine[], dia?: string | null): CartLine[] {
  let cambio = false;
  const next = lines.map((l) => {
    if (l.precioLista == null) return l;
    const oferta = precioPorCantidad(l.precioLista, l.tramos, l.quantity, dia).precio;
    const precio = l.precioCliente != null ? Math.min(oferta, clp(l.precioCliente)) : oferta;
    if (precio === l.unitPrice) return l;
    cambio = true;
    return { ...l, unitPrice: precio };
  });
  return cambio ? next : lines;
}

/** Cuánto se ahorra la línea por la oferta, respecto del precio normal. */
export function ahorroPorOferta(line: CartLine): number {
  if (line.precioLista == null) return 0;
  return Math.max(clp(line.precioLista * line.quantity) - clp(line.unitPrice * line.quantity), 0);
}

/**
 * Pone a cada línea su parte del ahorro de los combos (0023). Se llama
 * después de `aplicarOfertas`: el combo se mide contra el precio que la línea
 * ya tiene (oferta o cliente), así nunca se suma a otra rebaja.
 */
export function aplicarCombos(lines: CartLine[], combos: readonly Combo[], dia?: string | null): CartLine[] {
  const aplicados = calcularCombos(
    lines.map((l) => ({ productId: l.productId, cantidad: l.quantity, precio: l.unitPrice })),
    combos, dia);
  const porProducto = new Map<string, { monto: number; nombre: string }>();
  for (const a of aplicados) {
    for (const [id, monto] of Object.entries(a.porProducto)) {
      const previo = porProducto.get(id);
      porProducto.set(id, { monto: (previo?.monto ?? 0) + monto, nombre: previo ? `${previo.nombre} + ${a.nombre}` : a.nombre });
    }
  }
  let cambio = false;
  const vistos = new Set<string>();
  const next = lines.map((l) => {
    // Si el producto está en dos líneas, el descuento va entero en la primera.
    const d = vistos.has(l.productId) ? undefined : porProducto.get(l.productId);
    vistos.add(l.productId);
    const monto = d?.monto ?? 0;
    const nombre = d?.nombre ?? null;
    if ((l.descuentoCombo ?? 0) === monto && (l.comboNombre ?? null) === nombre) return l;
    cambio = true;
    return { ...l, descuentoCombo: monto, comboNombre: nombre };
  });
  return cambio ? next : lines;
}
