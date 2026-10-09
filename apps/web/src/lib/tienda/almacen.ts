'use client';

import { useSyncExternalStore } from 'react';

/**
 * Un valor de la tienda guardado en el navegador del cliente (carrito, sus
 * datos, sus pedidos): sobrevive a cerrar la pestaña, se ve igual en otra
 * pestaña abierta, y en el servidor es siempre el valor inicial (sin errores
 * de hidratación). Si el navegador no deja guardar (modo privado), queda en
 * memoria mientras la página esté abierta.
 */
export function crearAlmacen<T>(clave: string, inicial: T, valido: (x: unknown) => T | null) {
  let actual: T | null = null;
  const oyentes = new Set<() => void>();

  function leer(): T {
    if (actual !== null) return actual;
    try {
      const crudo = localStorage.getItem(clave);
      actual = (crudo == null ? null : valido(JSON.parse(crudo))) ?? inicial;
    } catch {
      actual = inicial;
    }
    return actual;
  }

  function guardar(valor: T) {
    actual = valor;
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* queda en memoria */ }
    oyentes.forEach((f) => f());
  }

  function suscribir(f: () => void) {
    oyentes.add(f);
    const otraPestana = (e: StorageEvent) => { if (e.key === clave) { actual = null; f(); } };
    window.addEventListener('storage', otraPestana);
    return () => { oyentes.delete(f); window.removeEventListener('storage', otraPestana); };
  }

  /** `listo` es false en el primer render (servidor e hidratación): todavía no se leyó el navegador. */
  function usar(): { valor: T; listo: boolean } {
    const valor = useSyncExternalStore(suscribir, leer, () => inicial);
    const listo = useSyncExternalStore(suscribir, () => true, () => false);
    return { valor, listo };
  }

  return { leer, guardar, usar };
}
