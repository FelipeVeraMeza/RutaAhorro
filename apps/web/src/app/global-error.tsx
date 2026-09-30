'use client';

import { useEffect } from 'react';
import { reportarError } from '@/lib/reportarError';

/** Último recurso: se cayó hasta el marco de la app. Sin estilos de Tailwind a propósito. */
export default function ErrorGeneral({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportarError(error, { tipo: 'global' }); }, [error]);
  return (
    <html lang="es-CL">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center', color: '#0f172a' }}>
        <h1 style={{ fontSize: 20 }}>RutaAhorro tuvo un problema</h1>
        <p style={{ color: '#5b6577' }}>Lo guardado sigue guardado. Vuelve a intentarlo.</p>
        <button onClick={reset} style={{ minHeight: 44, padding: '0 20px', borderRadius: 12, border: 0, background: '#157a4c', color: '#fff', fontWeight: 600, fontSize: 16 }}>
          Intentar de nuevo
        </button>
      </body>
    </html>
  );
}
