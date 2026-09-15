'use client';

import { useEffect } from 'react';
import { syncCatalog } from '@/lib/offline/catalog';

/**
 * Replica el catálogo al dispositivo en segundo plano.
 *
 * Corre al entrar y cada 10 minutos. Si falla, no molesta al usuario: el
 * catálogo que ya está en el celular sigue sirviendo, y ese es justamente el
 * punto del modo offline.
 */
export function SyncCatalogo() {
  useEffect(() => {
    let cancelled = false;

    const run = () => {
      if (!navigator.onLine) return;
      void syncCatalog().catch(() => {
        // Silencioso a propósito: no hay nada que el cajero pueda hacer.
      });
    };

    if (!cancelled) run();
    const timer = window.setInterval(run, 10 * 60_000);
    window.addEventListener('online', run);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('online', run);
    };
  }, []);

  return null;
}
