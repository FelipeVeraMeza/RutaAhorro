'use client';

import { formatCLP, type LineaCarritoTienda, type ProductoTienda } from '@rutaahorro/core';
import { crearAlmacen } from './almacen';

/**
 * El carrito de la tienda (RT-20): vive en el navegador del cliente. No hay
 * cuenta ni base detrás todavía; cuando exista el pedido (RT-24), el servidor
 * recalcula todo con los precios del momento, así que lo que se guarde acá
 * nunca decide cuánto se cobra.
 */
const TOPE_UNIDADES = 99;
const VACIO: LineaCarritoTienda[] = [];

const almacen = crearAlmacen<LineaCarritoTienda[]>('tienda:carrito', VACIO, (x) =>
  Array.isArray(x)
    ? x.filter((l) => l && typeof l.id === 'string' && typeof l.precio === 'number' && l.cantidad > 0)
    : null);

export function useCarrito(): LineaCarritoTienda[] {
  return almacen.usar().valor;
}

/** El carrito y si ya se leyó del navegador (para no mostrar "vacío" un instante). */
export function useCarritoListo() {
  return almacen.usar();
}

export function agregarAlCarrito(p: Pick<ProductoTienda, 'id' | 'nombre' | 'precio' | 'tramos'>, cantidad = 1) {
  if (p.precio == null) return;
  const lineas = almacen.leer();
  const ya = lineas.find((l) => l.id === p.id);
  if (ya) return cambiarCantidad(p.id, ya.cantidad + cantidad);
  almacen.guardar([...lineas, { id: p.id, nombre: p.nombre, precio: p.precio, tramos: p.tramos, cantidad: Math.min(cantidad, TOPE_UNIDADES) }]);
}

export function cambiarCantidad(id: string, cantidad: number) {
  const n = Math.min(Math.max(0, Math.trunc(cantidad)), TOPE_UNIDADES);
  const lineas = almacen.leer();
  almacen.guardar(n === 0
    ? lineas.filter((l) => l.id !== id)
    : lineas.map((l) => (l.id === id ? { ...l, cantidad: n } : l)));
}

export interface ProductoAlDia {
  id: string; nombre: string; precio: number | null; tramos: LineaCarritoTienda['tramos']; disponible: boolean;
}

/**
 * Pone el carrito al día con los productos como están ahora (RT-23 en
 * chico): precio y ofertas nuevos, y fuera lo que ya no se vende o quedó sin
 * precio. Devuelve qué cambió, en palabras, para avisarle al cliente.
 */
export function sincronizarCarrito(frescos: ProductoAlDia[]): string[] {
  const porId = new Map(frescos.map((p) => [p.id, p]));
  const avisos: string[] = [];
  const lineas: LineaCarritoTienda[] = [];
  for (const l of almacen.leer()) {
    const p = porId.get(l.id);
    if (!p || p.precio == null) { avisos.push(`${l.nombre} ya no está a la venta y lo sacamos del carrito.`); continue; }
    if (!p.disponible) { avisos.push(`${p.nombre} se agotó y lo sacamos del carrito.`); continue; }
    if (p.precio !== l.precio) avisos.push(`${p.nombre} cambió de precio: ahora ${formatCLP(p.precio)}.`);
    lineas.push({ ...l, nombre: p.nombre, precio: p.precio, tramos: p.tramos });
  }
  if (JSON.stringify(lineas) !== JSON.stringify(almacen.leer())) almacen.guardar(lineas);
  return avisos;
}

export function vaciarCarrito() {
  almacen.guardar(VACIO);
}
