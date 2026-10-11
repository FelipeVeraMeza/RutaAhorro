'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Si la base no responde, el cliente ve esto y no la pantalla de error del
 * sistema. RNF-T46 · el error va al buzón del servidor (sin datos del cliente).
 */
export default function TiendaError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void fetch('/api/errores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origen: 'tienda', mensaje: error.message.slice(0, 300), digest: error.digest ?? null, ruta: location.pathname }),
      keepalive: true,
    }).catch(() => {});
  }, [error]);
  return (
    <div className="text-center py-16 flex flex-col items-center gap-3">
      <h1 className="text-xl font-bold">No pudimos cargar la tienda</h1>
      <p className="text-[var(--texto-suave)]">Inténtalo de nuevo en un momento. Tu carrito sigue guardado en este celular.</p>
      <div className="flex gap-2 flex-wrap justify-center">
        <button type="button" className="btn btn-primario" onClick={reset}>Reintentar</button>
        <Link href="/tienda/contacto" className="btn btn-secundario">Contactar al local</Link>
      </div>
    </div>
  );
}
