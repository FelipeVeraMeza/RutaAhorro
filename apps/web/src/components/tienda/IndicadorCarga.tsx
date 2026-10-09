'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * La barrita naranja arriba mientras carga otra pestaña o un filtro.
 *
 * Reemplaza a `tienda/loading.tsx` (2026-10-09): con ese archivo, Next manda
 * el contenido escondido y lo muestra con JavaScript, así que sin JavaScript
 * la tienda se quedaba para siempre en el esqueleto (RNF-T40). Esto solo
 * agrega una señal; si no hay JavaScript, no estorba.
 */
export function IndicadorCarga() {
  const path = usePathname();
  const params = useSearchParams();
  const [cargando, setCargando] = useState(false);

  // Llegó la página nueva: se apaga.
  useEffect(() => { setCargando(false); }, [path, params]);

  useEffect(() => {
    const alTocar = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest('a');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      setCargando(true);
    };
    const alEnviar = (e: SubmitEvent) => {
      if ((e.target as HTMLFormElement).method.toLowerCase() === 'get') setCargando(true);
    };
    document.addEventListener('click', alTocar);
    document.addEventListener('submit', alEnviar);
    return () => { document.removeEventListener('click', alTocar); document.removeEventListener('submit', alEnviar); };
  }, []);

  if (!cargando) return null;
  return (
    <div role="progressbar" aria-label="Cargando" className="fixed top-0 inset-x-0 z-50 h-1 overflow-hidden bg-acento-100">
      <div className="h-full w-1/3 bg-acento-500 animate-[carga_1s_ease-in-out_infinite]" />
    </div>
  );
}
