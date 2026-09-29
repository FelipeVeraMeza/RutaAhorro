'use client';

import type { CartLine } from '@rutaahorro/core';

/**
 * Lo que el POS guarda en la pestaña (sessionStorage).
 *
 * El carrito vivía solo en memoria: si el cajero salía a Caja o al
 * consultador a mitad de una venta, al volver estaba vacío y había que
 * escanear todo de nuevo con el cliente esperando (hallazgo del flujo
 * completo, 2026-09-28).
 *
 * sessionStorage y no IndexedDB: una venta a medio armar es de esta pestaña y
 * de este turno. Se borra sola al cerrar la pestaña, y no la ve otra pestaña
 * ni otro dispositivo. Igual lleva dueño (regla 18): si en este celular entra
 * otra persona, no hereda la venta a medias de la anterior.
 *
 * Todo va con try/catch: en modo privado, o con el almacenamiento bloqueado,
 * leer o escribir lanza, y eso no puede impedir vender.
 */

const CLAVE_CARRO = 'pos:carro';
const CLAVE_PEDIDO = 'pos:agregar';
/** Un pedido del consultador que nadie recogió en este tiempo ya no es de esta venta. */
const VIGENCIA_PEDIDO_MS = 10 * 60 * 1000;

interface CarroGuardado {
  usuario: string;
  lineas: CartLine[];
  clienteId: string | null;
}

export function guardarCarro(usuario: string, lineas: CartLine[], clienteId: string | null): void {
  try {
    if (lineas.length === 0 && !clienteId) sessionStorage.removeItem(CLAVE_CARRO);
    else sessionStorage.setItem(CLAVE_CARRO, JSON.stringify({ usuario, lineas, clienteId } satisfies CarroGuardado));
  } catch { /* sin almacenamiento, el carrito vive solo en memoria, como antes */ }
}

export function leerCarro(usuario: string): { lineas: CartLine[]; clienteId: string | null } | null {
  try {
    const crudo = sessionStorage.getItem(CLAVE_CARRO);
    if (!crudo) return null;
    const c = JSON.parse(crudo) as Partial<CarroGuardado>;
    if (c.usuario !== usuario || !Array.isArray(c.lineas)) {
      sessionStorage.removeItem(CLAVE_CARRO);
      return null;
    }
    const lineas = c.lineas.filter((l) => typeof l?.productId === 'string' && Number(l.quantity) > 0);
    return { lineas, clienteId: typeof c.clienteId === 'string' ? c.clienteId : null };
  } catch {
    return null;
  }
}

/** El consultador de precios deja el producto para que el POS lo agregue al abrir. */
export function pedirAgregarAlPos(usuario: string, productId: string, cantidad: number): void {
  try {
    sessionStorage.setItem(CLAVE_PEDIDO, JSON.stringify({ usuario, productId, cantidad, en: Date.now() }));
  } catch { /* el POS no lo va a recibir; el consultador lo dice si no puede navegar */ }
}

/** Lee y borra el pedido: se agrega una sola vez aunque el POS se abra dos. */
export function tomarPedidoPendiente(usuario: string): { productId: string; cantidad: number } | null {
  try {
    const crudo = sessionStorage.getItem(CLAVE_PEDIDO);
    if (!crudo) return null;
    sessionStorage.removeItem(CLAVE_PEDIDO);
    const p = JSON.parse(crudo) as { usuario?: string; productId?: string; cantidad?: number; en?: number };
    if (p.usuario !== usuario || typeof p.productId !== 'string') return null;
    if (!(Number(p.cantidad) > 0) || Date.now() - Number(p.en ?? 0) > VIGENCIA_PEDIDO_MS) return null;
    return { productId: p.productId, cantidad: Number(p.cantidad) };
  } catch {
    return null;
  }
}
