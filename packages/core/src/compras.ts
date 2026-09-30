/**
 * Orden de compra sugerida (RF-M3-11).
 *
 * Con los productos bajo su mínimo, cuánto pedir para quedar holgado: hasta
 * `cobertura` veces el mínimo (por omisión el doble). No es un pronóstico: es
 * la regla que el almacenero ya aplica a ojo, escrita para que no se olvide
 * nada al llamar al proveedor.
 */
import { admiteDecimales, formatCantidad } from './money.js';

export interface ProductoParaComprar {
  id: string;
  nombre: string;
  stock: number;
  minimo: number;
  unidad?: string | null;
  /** Costo unitario, si quien mira puede verlo. Sirve para estimar el total. */
  costo?: number | null;
}

export interface LineaSugerida extends ProductoParaComprar {
  pedir: number;
}

export function sugerirCompra(productos: readonly ProductoParaComprar[], cobertura = 2): LineaSugerida[] {
  return productos
    .filter((p) => p.minimo > 0 && p.stock <= p.minimo)
    .map((p) => {
      const falta = p.minimo * cobertura - Math.max(p.stock, 0);
      // Lo que se vende por unidad se pide entero; por kilo, con un decimal.
      const pedir = admiteDecimales(p.unidad) ? Math.ceil(falta * 10) / 10 : Math.ceil(falta);
      return { ...p, pedir: Math.max(pedir, 0) };
    })
    .filter((l) => l.pedir > 0)
    // Primero lo agotado, después lo que está más lejos de su mínimo.
    .sort((a, b) => (a.stock <= 0 ? 0 : 1) - (b.stock <= 0 ? 0 : 1) || a.stock / a.minimo - b.stock / b.minimo);
}

/** Costo estimado del pedido, solo con las líneas que tienen costo. */
export function costoEstimado(lineas: readonly LineaSugerida[]): number {
  return Math.round(lineas.reduce((s, l) => s + (l.costo ? l.costo * l.pedir : 0), 0));
}

/** El pedido como texto, para copiar o mandar por WhatsApp al proveedor. */
export function textoPedido(lineas: readonly LineaSugerida[], local: string): string {
  const cuerpo = lineas.map((l) => {
    const unidad = l.unidad && l.unidad !== 'unidad' ? ` ${l.unidad}` : '';
    return `• ${formatCantidad(l.pedir)}${unidad} · ${l.nombre}`;
  });
  return [`Pedido${local ? ` de ${local}` : ''}:`, ...cuerpo].join('\n');
}
