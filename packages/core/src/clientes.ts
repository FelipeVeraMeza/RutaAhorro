/**
 * Precio por cliente (0022, RQ-07 y RQ-21).
 *
 * Decisión de Felipe, 2026-09-27: cada cliente puede tener un % de rebaja
 * general (el mayorista, 8 %) y precios especiales en productos puntuales. Se
 * cobra el más barato entre la oferta del producto, el % del cliente y su
 * precio especial: no se suman.
 *
 * La misma regla está en la base (`fn_precio_cliente`) y es la que manda.
 */
import { clp } from './money.js';
import { precioDelTramo } from './precios.js';

export interface ClienteConPrecios {
  id: string;
  nombre: string;
  rut?: string | null;
  giro?: string | null;
  direccion?: string | null;
  /** Rebaja general, en % (8 = 8 % menos). 0 si no tiene. */
  descuentoPct: number;
  /** Precio especial de cada unidad, por id de producto. */
  precios: Record<string, number>;
}

/**
 * El precio de cada unidad de ese producto para ese cliente, o null si el
 * cliente no tiene nada mejor que el precio normal.
 */
export function precioParaCliente(
  productId: string,
  precioLista: number,
  cliente: ClienteConPrecios | null | undefined,
): number | null {
  if (!cliente) return null;
  const lista = clp(precioLista);
  const candidatos: number[] = [];
  const especial = cliente.precios[productId];
  if (especial != null && especial > 0) candidatos.push(clp(especial));
  if (cliente.descuentoPct > 0) candidatos.push(precioDelTramo({ desde: 1, descuentoPct: cliente.descuentoPct }, lista));
  if (candidatos.length === 0) return null;
  const precio = Math.min(...candidatos);
  return precio < lista ? precio : null;
}

/** Lo que tiene el cliente, en palabras: "8% menos · 3 precios especiales". */
export function describirCliente(c: ClienteConPrecios): string {
  const partes: string[] = [];
  if (c.descuentoPct > 0) partes.push(`${String(c.descuentoPct).replace('.', ',')}% menos`);
  const n = Object.keys(c.precios).length;
  if (n > 0) partes.push(`${n} ${n === 1 ? 'precio especial' : 'precios especiales'}`);
  return partes.join(' · ') || 'precio normal';
}
