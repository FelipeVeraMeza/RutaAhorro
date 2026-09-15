/**
 * Dinero en pesos chilenos.
 *
 * Regla del proyecto (RNF-32): el CLP no tiene decimales y el dinero SIEMPRE se
 * representa como entero. Nunca `number` con decimales, nunca `float`.
 * Una diferencia de $1 por redondeo en un arqueo hace que el cajero deje de
 * confiar en el sistema completo.
 */

/** Redondeo al entero más cercano, con medio hacia arriba y simétrico en negativos. */
export function clp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

const formatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** "$12.990" — formato chileno, sin decimales (RNF-21). */
export function formatCLP(value: number): string {
  // El espacio duro que mete Intl entre "$" y el número se ve mal en pantallas
  // angostas de celular; lo eliminamos.
  return formatter.format(clp(value)).replace(/ /g, '');
}

/** "12.990" — sin símbolo, para campos de formulario. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(clp(value));
}

/** Lee "$12.990", "12990", "12.990" → 12990. Devuelve null si no es un monto. */
export function parseCLP(input: string): number | null {
  if (input == null) return null;
  const cleaned = String(input).replace(/[^\d-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** IVA contenido en un precio que YA lo incluye (S-9: precios con IVA incluido). */
export function taxIncluded(grossAmount: number, ivaPct = 19): number {
  return clp(grossAmount - grossAmount / (1 + ivaPct / 100));
}

/** Neto de un precio con IVA incluido. */
export function netAmount(grossAmount: number, ivaPct = 19): number {
  return clp(grossAmount) - taxIncluded(grossAmount, ivaPct);
}

/** Margen en pesos. */
export function margin(salePrice: number, cost: number): number {
  return clp(salePrice) - clp(cost);
}

/**
 * Margen como porcentaje del PRECIO DE VENTA, no del costo.
 * Es la convención de retail: "margen 30 %" significa que 30 centavos de cada
 * peso vendido son margen. Calcularlo sobre el costo daría un número más grande
 * y halagador, pero no es el que usa el negocio.
 */
export function marginPct(salePrice: number, cost: number): number {
  const price = clp(salePrice);
  if (price <= 0) return 0;
  return Math.round((margin(price, cost) / price) * 1000) / 10;
}

/** Vuelto. Nunca negativo: si pagó de menos, el vuelto es 0, no una deuda. */
export function change(received: number, total: number): number {
  return Math.max(clp(received) - clp(total), 0);
}
