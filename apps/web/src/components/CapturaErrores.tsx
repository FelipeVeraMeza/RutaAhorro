'use client';

import { useEffect } from 'react';
import { reportarError } from '@/lib/reportarError';

/** Errores que ninguna pantalla atrapó: también se reportan (RNF-40). */
export function CapturaErrores() {
  useEffect(() => {
    const alError = (e: ErrorEvent) => reportarError(e.error ?? e.message, { tipo: 'error' });
    const alRechazo = (e: PromiseRejectionEvent) => reportarError(e.reason, { tipo: 'promesa' });
    window.addEventListener('error', alError);
    window.addEventListener('unhandledrejection', alRechazo);
    return () => {
      window.removeEventListener('error', alError);
      window.removeEventListener('unhandledrejection', alRechazo);
    };
  }, []);
  return null;
}
