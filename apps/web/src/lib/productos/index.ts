'use client';

import { DEMO_ACTIVO } from '../demo';
import { repoLocal } from './repoLocal';
import { repoSupabase } from './repoSupabase';
import type { RepositorioProductos } from './tipos';

/**
 * Selector de implementación.
 *
 * Las pantallas llaman a `repoProductos()` y no saben —ni les importa— si
 * detrás hay Supabase o IndexedDB. Ese desacople es lo que permite que en modo
 * demo los flujos de alta, baja e importación funcionen de verdad, con datos
 * que persisten, en vez de estar incrustados en las pantallas.
 */
export function repoProductos(): RepositorioProductos {
  return DEMO_ACTIVO ? repoLocal : repoSupabase;
}

export * from './tipos';
