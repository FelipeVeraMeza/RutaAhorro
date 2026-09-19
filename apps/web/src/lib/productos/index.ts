'use client';

import { DEMO_ACTIVO } from '../demo';
import { repoLocal } from './repoLocal';
import { repoSupabase } from './repoSupabase';
import type { RepositorioProductos } from './tipos';
import { syncCatalog } from '../offline/catalog';

/**
 * Selector de implementación.
 *
 * Las pantallas llaman a `repoProductos()` y no saben —ni les importa— si
 * detrás hay Supabase o IndexedDB. Ese desacople es lo que permite que en modo
 * demo los flujos de alta, baja e importación funcionen de verdad, con datos
 * que persisten, en vez de estar incrustados en las pantallas.
 */
/**
 * Lo que cambia el catálogo. Después de cada una se sincroniza el catálogo del
 * navegador: antes se esperaba la sincronización periódica, 10 minutos, y un
 * producto recién creado no aparecía al buscarlo en el POS.
 */
const CAMBIAN_CATALOGO = new Set(['crear', 'actualizar', 'desactivar', 'reactivar', 'eliminar', 'importarLote']);

const repoSupabaseSincronizado = new Proxy(repoSupabase, {
  get(objetivo, clave, receptor) {
    const valor = Reflect.get(objetivo, clave, receptor);
    if (typeof valor !== 'function' || !CAMBIAN_CATALOGO.has(String(clave))) return valor;
    return async (...args: unknown[]) => {
      const resultado = await (valor as (...a: unknown[]) => Promise<unknown>).apply(objetivo, args);
      void syncCatalog().catch(() => {});
      return resultado;
    };
  },
});

export function repoProductos(): RepositorioProductos {
  return DEMO_ACTIVO ? repoLocal : repoSupabaseSincronizado;
}

export * from './tipos';
