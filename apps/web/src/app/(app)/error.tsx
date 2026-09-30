'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { reportarError } from '@/lib/reportarError';
import { Icono } from '@/components/Icono';

/**
 * Cuando una pantalla se cae. Antes Next mostraba su página en inglés
 * ("Application error: a client-side exception has occurred") y el cajero no
 * tenía cómo seguir. Ahora dice qué hacer, deja reintentar sin perder la
 * sesión, y el error queda reportado.
 */
export default function ErrorDePantalla({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportarError(error, { tipo: 'pantalla' }); }, [error]);
  return (
    <div className="px-5 py-12 text-center max-w-md mx-auto">
      <span className="inline-grid place-items-center w-14 h-14 rounded-2xl bg-amber-50 text-[var(--color-aviso)] mb-3">
        <Icono nombre="alerta" tamano={28} />
      </span>
      <h1 className="text-lg font-bold mb-1">Esta pantalla tuvo un problema</h1>
      <p className="text-sm text-[var(--texto-suave)] mb-5">
        Lo que ya estaba guardado sigue guardado. Vuelve a intentarlo; si se repite, avísale al
        administrador{error.digest ? <> y dile este código: <span className="num font-medium">{error.digest}</span></> : null}.
      </p>
      <div className="flex flex-col gap-2">
        <button onClick={reset} className="btn btn-primario w-full">Intentar de nuevo</button>
        <Link href="/" className="btn btn-secundario w-full">Ir a mi pantalla de inicio</Link>
      </div>
    </div>
  );
}
