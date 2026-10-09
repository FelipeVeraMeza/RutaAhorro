'use client';

import { useEffect, useState } from 'react';

const CADA_MS = 5 * 60_000;

/**
 * Instala el service worker (public/sw.js) en producción. En desarrollo no:
 * guardaría pantallas a medio compilar y confundiría más de lo que ayuda.
 *
 * También avisa cuando hay una versión nueva publicada (RNF-66): el celular
 * del mostrador pasa días con la misma pestaña abierta, y sin esto seguía con
 * el código viejo hasta que alguien recargaba por casualidad.
 */
export function RegistrarSW() {
  const [hayNueva, setHayNueva] = useState(false);

  useEffect(() => {
    // La tienda online (docs/30) no es el sistema: sin la pantalla "Sin
    // conexión… Ir a Vender" del service worker y sin el aviso de versión.
    const dominio = process.env.NEXT_PUBLIC_TIENDA_HOST?.trim().toLowerCase();
    const host = location.hostname.toLowerCase();
    if (location.pathname.startsWith('/tienda') || (dominio && (host === dominio || host === `www.${dominio}`))) return;

    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    }
    const mia = process.env.NEXT_PUBLIC_COMMIT;
    if (!mia) return;
    async function revisar() {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      try {
        const r = await fetch('/api/version', { cache: 'no-store' });
        if (!r.ok) return;
        const { commit } = (await r.json()) as { commit: string | null };
        if (commit && commit !== mia) setHayNueva(true);
      } catch { /* sin red: se revisa la próxima vez */ }
    }
    const t = window.setInterval(revisar, CADA_MS);
    document.addEventListener('visibilitychange', revisar);
    window.addEventListener('online', revisar);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', revisar);
      window.removeEventListener('online', revisar);
    };
  }, []);

  if (!hayNueva) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-20 lg:bottom-4 lg:left-auto lg:right-4 lg:max-w-sm z-[90]
      tarjeta shadow-lg p-3 flex items-center gap-3">
      <p className="text-sm flex-1">Hay una versión nueva del sistema.</p>
      <button type="button" className="btn btn-primario btn-chico" onClick={() => location.reload()}>Actualizar</button>
      <button type="button" className="btn btn-secundario btn-chico" onClick={() => setHayNueva(false)}
        aria-label="Más tarde">Más tarde</button>
    </div>
  );
}
